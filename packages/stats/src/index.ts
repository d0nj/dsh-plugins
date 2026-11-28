import type { Context } from '@deepseek-ai/cordis'
import type { WebResourceRoute } from '@deepseek-ai/dsh-host-webserver'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import z from '@deepseek-ai/schemastery'

import { buildPriceIndex, resolvePrice } from './pricing.js'
import type { PriceIndex, PriceMatch, PriceOverride } from './pricing.js'
import { dayOf, summarize } from './summary.js'
import type { StatsPayload, UsageEvent } from './summary.js'
import { addTokens, isRecord, tokensOfUsage } from './tokens.js'
import type { TokenTotals } from './tokens.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'stats'

/** The session corpus, its projection cache, and the route the page fetches. */
export const inject = ['sessionQuery', 'sessionProjectionCache', 'webServer'] as const

/** Exact path the browser half fetches. */
export const ROUTE = '/d0nj-stats/summary'

/** The catalog is public and versionless; this is the published endpoint. */
const DEFAULT_CATALOG_URL = 'https://models.dev/api.json'

/** One model's price, in USD per million tokens. */
const PriceConfig = z.object({
  input: z.number().min(0).description('USD per million uncached input tokens.'),
  cacheRead: z.number().min(0).description('USD per million cache-read tokens.'),
  cacheWrite: z.number().min(0).description('USD per million cache-write tokens.'),
  output: z.number().min(0).description('USD per million output tokens.'),
})

/**
 * Where prices come from and how the page presents them.
 *
 * `prices` exists because a deployment behind its own router bills at rates no
 * public catalog lists: the entry for a model id overrides every resolved price.
 */
export const Config: ReturnType<typeof z.object> = z.object({
  catalogUrl: z
    .string()
    .default(DEFAULT_CATALOG_URL)
    .description('models.dev catalog URL, or any JSON document of the same shape.'),
  catalogTtlMinutes: z
    .number()
    .step(1)
    .min(0)
    .default(360)
    .description('How long a fetched catalog stays usable. 0 refetches on every request.'),
  topSessions: z
    .number()
    .step(1)
    .min(1)
    .max(100)
    .default(12)
    .description('How many sessions the page lists individually.'),
  prices: z
    .dict(PriceConfig)
    .default({})
    .description('Per-model overrides, keyed by model id or its last path segment.'),
  scanSessions: z
    .number()
    .step(1)
    .min(0)
    .max(500)
    .default(40)
    .description('How many of the largest Sessions to replay for exact per-model and per-day attribution.'),
})

/** The parsed shape of this plugin's config. */
export interface PluginConfig {
  catalogUrl?: string
  catalogTtlMinutes?: number
  topSessions?: number
  prices?: Record<string, PriceOverride>
  scanSessions?: number
}

/** One stored Session event, narrowed to what attribution reads. */
interface RawEvent {
  readonly type: string
  readonly time?: number
  readonly data?: unknown
}

/** The projection-cache face this plugin reads. */
interface ProjectionView {
  readonly values: Record<string, unknown>
}

/**
 * The Host services this plugin uses.
 *
 * Declared structurally because the projection key set is a closed union owned by
 * other packages: `cachedSnapshot` takes the catalog's own key type, so reading
 * `tokenUsage`, `modelSelection` and `title` needs the string form.
 */
interface StatsHost {
  readonly sessionQuery: {
    listSessions(signal?: AbortSignal): Promise<readonly SessionRecord[]>
    readSession(id: string): Promise<{ readonly events: readonly RawEvent[] }>
  }
  readonly sessionProjectionCache: {
    cachedSnapshot(header: unknown, keys?: readonly string[]): ProjectionView | undefined
  }
  readonly webServer: { register(route: WebResourceRoute): () => void }
  effect(callback: () => () => void): () => void
  logger(name: string): { warn(message: string): void }
}

/**
 * Fetch and keep the price catalog.
 *
 * Activation never waits on the network: the first page request loads the
 * catalog and later requests reuse it until the TTL lapses. A failed fetch keeps
 * the previous catalog and reports the failure to the page instead of failing the
 * route, because token totals do not depend on prices.
 */
class PriceCatalog {
  #index: PriceIndex | undefined
  #fetchedAt: number | null = null
  #inflight: Promise<PriceIndex | undefined> | undefined
  readonly #url: string
  readonly #ttlMs: number
  readonly #warn: (message: string) => void

  constructor(url: string, ttlMinutes: number, warn: (message: string) => void) {
    this.#url = url
    this.#ttlMs = Math.max(0, ttlMinutes) * 60_000
    this.#warn = warn
  }

  get fetchedAt(): number | null {
    return this.#fetchedAt
  }

  async index(): Promise<PriceIndex | undefined> {
    const fresh = this.#fetchedAt !== null && Date.now() - this.#fetchedAt < this.#ttlMs
    if (this.#index !== undefined && fresh) return this.#index
    this.#inflight ??= this.#fetch()
    const index = await this.#inflight
    this.#inflight = undefined
    return index
  }

  async #fetch(): Promise<PriceIndex | undefined> {
    try {
      const response = await fetch(this.#url, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      this.#index = buildPriceIndex((await response.json()) as unknown)
      this.#fetchedAt = Date.now()
      return this.#index
    } catch (error) {
      this.#warn('price catalog unavailable: ' + describe(error))
      return this.#index
    }
  }
}

/**
 * Serve token spend for every stored Session.
 *
 * Lifetime totals come from the projection cache, whose `tokenUsage` unit
 * already folds each log, so the page never replays 700 logs to answer "how
 * much". Exact per-model and per-day attribution needs the calls themselves, so
 * the largest Sessions are replayed once and kept for the life of this plugin.
 */
export function apply(ctx: Context, config: PluginConfig): () => void {
  const host = ctx as unknown as StatsHost
  const logger = host.logger('stats')
  const catalog = new PriceCatalog(
    config.catalogUrl ?? DEFAULT_CATALOG_URL,
    config.catalogTtlMinutes ?? 360,
    (message) => logger.warn(message),
  )
  const settings = {
    topSessions: config.topSessions ?? 12,
    scanSessions: config.scanSessions ?? 40,
  }
  const scans = new Map<string, readonly UsageEvent[]>()
  const run: ScanRun = { started: false, running: false, done: false, total: 0 }
  const overrides = config.prices ?? {}

  const route: WebResourceRoute = {
    kind: 'exact',
    path: ROUTE,
    resource: async () => {
      try {
        return jsonResponse(await buildPayload(host, catalog, overrides, settings, scans, run))
      } catch (error) {
        logger.warn('usage summary failed: ' + describe(error))
        return jsonResponse({ error: describe(error) }, 503)
      }
    },
  }

  return host.effect(() => {
    try {
      return host.webServer.register(route)
    } catch (error) {
      logger.warn('route not registered: ' + describe(error))
      return () => {}
    }
  })
}

async function buildPayload(
  host: StatsHost,
  catalog: PriceCatalog,
  overrides: Readonly<Record<string, PriceOverride>>,
  config: { topSessions: number; scanSessions: number },
  scans: Map<string, readonly UsageEvent[]>,
  run: ScanRun,
): Promise<StatsPayload> {
  const list = await host.sessionQuery.listSessions()
  const index = await catalog.index()
  const live = new Set<string>(list.filter((record) => record.live).map((record) => String(record.header.id)))
  const facts: SessionFact[] = []

  for (const record of list) {
    const fact = readFact(host.sessionProjectionCache, record)
    if (fact !== undefined) facts.push(fact)
  }

  const targets = [...facts]
    .sort((left, right) => right.tokens.total - left.tokens.total)
    .slice(0, Math.max(0, config.scanSessions))
  run.total = targets.length
  if (!run.started || (!run.done && !run.running)) {
    run.started = true
    run.running = true
    void scanAll(host, targets, scans, live).finally(() => {
      run.running = false
      run.done = true
    })
  }

  const events = facts.flatMap((fact): UsageEvent[] => {
    const exact = scans.get(fact.id)
    if (exact !== undefined) return [...exact]
    return [
      {
        sessionId: fact.id,
        tokens: fact.tokens,
        at: fact.createdAt,
        ...(fact.provider === undefined ? {} : { provider: fact.provider }),
        ...(fact.model === undefined ? {} : { model: fact.model }),
      },
    ]
  })

  const priceOf = (event: UsageEvent): PriceMatch | undefined => {
    if (index === undefined || event.provider === undefined || event.model === undefined) return undefined
    return resolvePrice(index, event.provider, event.model, overrides)
  }

  const payload = summarize(events, facts, priceOf, {
    topSessions: config.topSessions,
    scannedSessions: list.length,
    scan: { scanned: scans.size, total: run.total, running: !run.done },
  })
  return { ...payload, price: { fetchedAt: catalog.fetchedAt, available: index !== undefined } }
}

async function scanAll(
  host: StatsHost,
  targets: readonly SessionFact[],
  scans: Map<string, readonly UsageEvent[]>,
  live: ReadonlySet<string>,
): Promise<void> {
  for (const fact of targets) {
    if (live.has(fact.id) || scans.has(fact.id)) continue
    try {
      const events = await scanSession(host, fact.id)
      if (events.length > 0) scans.set(fact.id, events)
    } catch {
      continue
    }
  }
}

/**
 * Replay one Session log into per-model, per-day usage.
 *
 * The cached projections keep lifetime totals but only the model a Session last
 * used, so a Session that switched models would bill every token at that last
 * rate. Replaying the log is the only exact source, which is why the caller
 * bounds it to the Sessions that carry the spend.
 */
async function scanSession(host: StatsHost, id: string): Promise<UsageEvent[]> {
  const snapshot = await host.sessionQuery.readSession(id)
  const buckets = new Map<string, UsageEvent>()

  for (const event of snapshot.events) {
    if (event.type !== 'assistant/message' || !isRecord(event.data)) continue
    const tokens = tokensOfUsage(event.data.usage)
    if (tokens === undefined) continue
    const message = isRecord(event.data.message) ? event.data.message : undefined
    const source = message !== undefined && isRecord(message.source) ? message.source : undefined
    const provider = source === undefined ? undefined : readText(source.provider)
    const model = source === undefined ? undefined : readText(source.model)
    const at = typeof event.time === 'number' ? event.time : 0
    const key = (provider ?? '?') + '\u0000' + (model ?? '?') + '\u0000' + dayOf(at)
    const existing = buckets.get(key)
    if (existing === undefined) {
      buckets.set(key, {
        sessionId: id,
        tokens,
        at,
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
      })
    } else {
      existing.tokens = addTokens(existing.tokens, tokens)
    }
  }

  return [...buckets.values()]
}

function readFact(cache: StatsHost['sessionProjectionCache'], record: SessionRecord): SessionFact | undefined {
  const header = record.header
  const usage = cache.cachedSnapshot(header, ['tokenUsage'])
  const tokens = usage === undefined ? undefined : readUsage(usage.values.tokenUsage)
  if (tokens === undefined) return undefined

  const title = readText(cache.cachedSnapshot(header, ['title'])?.values.title)
  const model = readModel(cache.cachedSnapshot(header, ['modelSelection'])?.values.modelSelection)
  const workspace = workspaceOf(header.cwd)

  return {
    id: header.id,
    createdAt: header.createdAt,
    tokens,
    ...(title === undefined ? {} : { title }),
    ...(workspace === undefined ? {} : { workspace }),
    ...(model === undefined ? {} : { provider: model.provider, model: model.model }),
  }
}

/** Progress of the one background pass over the largest Session logs. */
interface ScanRun {
  started: boolean
  running: boolean
  done: boolean
  total: number
}

/** One Session's cached totals and the attribution the projections can offer. */
export interface SessionFact {
  id: string
  title?: string
  workspace?: string
  createdAt: number
  provider?: string
  model?: string
  tokens: TokenTotals
}

function readUsage(value: unknown): TokenTotals | undefined {
  if (!isRecord(value)) return undefined
  return tokensOfUsage(value.totals) ?? tokensOfUsage(value)
}

function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readModel(value: unknown): { provider: string; model: string } | undefined {
  if (!isRecord(value)) return undefined
  const lastUsed = value.lastUsed
  if (!isRecord(lastUsed)) return undefined
  const provider = readText(lastUsed.provider)
  const model = readText(lastUsed.model)
  if (provider === undefined || model === undefined) return undefined
  return { provider, model }
}

/** The last path segment of a working directory, used as the page's workspace label. */
export function workspaceOf(cwd: string | undefined): string | undefined {
  if (cwd === undefined) return undefined
  const segments = cwd.split(/[\\/]/u).filter((segment) => segment.length > 0)
  return segments[segments.length - 1]
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}