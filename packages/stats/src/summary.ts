import type { ModelPrice, PriceMatch } from './pricing.js'
import { costOf } from './pricing.js'
import type { TokenTotals } from './tokens.js'
import { ZERO_TOKENS, addTokens } from './tokens.js'

/** One billed slice of usage: a model's tokens on one day of one session. */
export interface UsageEvent {
  sessionId: string
  provider?: string
  model?: string
  tokens: TokenTotals
  at: number
}

/** The Session fields the page shows beside its usage. */
export interface SessionMeta {
  id: string
  title?: string
  workspace?: string
  createdAt: number
}

/** One model's share of the spend. */
export interface ModelRow {
  provider: string | null
  model: string | null
  sessions: number
  tokens: TokenTotals
  costUsd: number
  price: ModelPrice | null
  basis: string | null
  sample: number
}

/** One session's share of the spend. */
export interface SessionRow {
  id: string
  title: string | null
  workspace: string | null
  createdAt: number
  tokens: TokenTotals
  costUsd: number
  basis: string | null
}

/** One day's share of the spend. */
export interface DayRow {
  date: string
  sessions: number
  tokens: TokenTotals
  costUsd: number
}

/** How the money figure was priced. */
export interface PriceStatus {
  fetchedAt: number | null
  available: boolean
}

/** How much of the model split came from the session logs themselves. */
export interface ScanStatus {
  scanned: number
  total: number
  running: boolean
}

/** The scan before it has read anything. */
export const IDLE_SCAN: ScanStatus = { scanned: 0, total: 0, running: false }

/** The whole page payload. */
export interface StatsPayload {
  generatedAt: number
  scannedSessions: number
  countedSessions: number
  totals: TokenTotals
  costUsd: number
  unpricedSessions: number
  price: PriceStatus
  scan: ScanStatus
  models: ModelRow[]
  top: SessionRow[]
  days: DayRow[]
}

/** How many sessions the page lists individually. */
export const TOP_SESSIONS = 12

/** How many days the time chart covers. */
export const CHART_DAYS = 30

interface ModelBucket {
  provider: string | null
  model: string | null
  sessions: Set<string>
  tokens: TokenTotals
  costUsd: number
  match: PriceMatch | undefined
}

interface SessionBucket {
  tokens: TokenTotals
  costUsd: number
  priced: boolean
  unpriced: boolean
  models: Set<string>
  match: PriceMatch | undefined
}

interface DayBucket {
  tokens: TokenTotals
  costUsd: number
  sessions: Set<string>
}

/**
 * Fold usage events into the payload the page renders.
 *
 * Events carry their own model and timestamp, so a session that switched models
 * or ran across days is priced and charted exactly rather than pinned to one
 * attribution. Sessions whose log was not scanned arrive as one event dated at
 * the session start, which is the best a cached projection can say.
 */
export function summarize(
  events: readonly UsageEvent[],
  sessions: readonly SessionMeta[],
  priceOf: (event: UsageEvent) => PriceMatch | undefined,
  options: { topSessions?: number; scannedSessions?: number; days?: number; now?: number; scan?: ScanStatus } = {},
): StatsPayload {
  const topSessions = options.topSessions ?? TOP_SESSIONS
  const scannedSessions = options.scannedSessions ?? sessions.length
  const days = options.days ?? CHART_DAYS
  const now = options.now ?? Date.now()
  let totals = ZERO_TOKENS
  let costUsd = 0
  const models = new Map<string, ModelBucket>()
  const sessionBuckets = new Map<string, SessionBucket>()
  const daily = new Map<string, DayBucket>()

  for (const event of events) {
    const match = priceOf(event)
    const cost = match === undefined ? 0 : costOf(event.tokens, match.price)
    totals = addTokens(totals, event.tokens)
    costUsd += cost

    const modelKey = (event.provider ?? '?') + '/' + (event.model ?? '?')
    const modelBucket = models.get(modelKey)
    if (modelBucket === undefined) {
      models.set(modelKey, {
        provider: event.provider ?? null,
        model: event.model ?? null,
        sessions: new Set([event.sessionId]),
        tokens: event.tokens,
        costUsd: cost,
        match,
      })
    } else {
      modelBucket.sessions.add(event.sessionId)
      modelBucket.tokens = addTokens(modelBucket.tokens, event.tokens)
      modelBucket.costUsd += cost
    }

    const sessionBucket = sessionBuckets.get(event.sessionId)
    if (sessionBucket === undefined) {
      sessionBuckets.set(event.sessionId, {
        tokens: event.tokens,
        costUsd: cost,
        priced: match !== undefined,
        unpriced: match === undefined,
        models: new Set([modelKey]),
        match,
      })
    } else {
      sessionBucket.tokens = addTokens(sessionBucket.tokens, event.tokens)
      sessionBucket.costUsd += cost
      sessionBucket.priced ||= match !== undefined
      sessionBucket.unpriced ||= match === undefined
      sessionBucket.models.add(modelKey)
      if (match !== undefined && sessionBucket.match === undefined) sessionBucket.match = match
    }

    const dayKey = dayOf(event.at)
    const dayBucket = daily.get(dayKey)
    if (dayBucket === undefined) {
      daily.set(dayKey, { tokens: event.tokens, costUsd: cost, sessions: new Set([event.sessionId]) })
    } else {
      dayBucket.tokens = addTokens(dayBucket.tokens, event.tokens)
      dayBucket.costUsd += cost
      dayBucket.sessions.add(event.sessionId)
    }
  }

  const metaById = new Map(sessions.map((session) => [session.id, session]))
  const rows: SessionRow[] = []
  let unpricedSessions = 0
  for (const [id, bucket] of sessionBuckets) {
    if (bucket.unpriced && !bucket.priced) unpricedSessions++
    const meta = metaById.get(id)
    rows.push({
      id,
      title: meta?.title ?? null,
      workspace: meta?.workspace ?? null,
      createdAt: meta?.createdAt ?? 0,
      tokens: bucket.tokens,
      costUsd: bucket.costUsd,
      basis: bucket.models.size === 1 ? bucket.match?.basis ?? null : null,
    })
  }

  const modelRows = [...models.values()]
    .map((bucket): ModelRow => ({
      provider: bucket.provider,
      model: bucket.model,
      sessions: bucket.sessions.size,
      tokens: bucket.tokens,
      costUsd: bucket.costUsd,
      price: bucket.match?.price ?? null,
      basis: bucket.match?.basis ?? null,
      sample: bucket.match?.sample ?? 0,
    }))
    .sort((left, right) => right.tokens.total - left.tokens.total)

  rows.sort((left, right) => right.tokens.total - left.tokens.total)

  return {
    generatedAt: Date.now(),
    scannedSessions,
    countedSessions: rows.length,
    totals,
    costUsd,
    unpricedSessions,
    price: { fetchedAt: null, available: false },
    scan: options.scan ?? IDLE_SCAN,
    models: modelRows,
    top: rows.slice(0, topSessions),
    days: daySeries(daily, days, now),
  }
}

/** A calendar-day key in local time, the unit the time chart buckets by. */
export function dayOf(epochMs: number): string {
  const date = new Date(epochMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

function daySeries(daily: ReadonlyMap<string, DayBucket>, days: number, now: number): DayRow[] {
  const series: DayRow[] = []
  const today = new Date(now)
  today.setHours(12, 0, 0, 0)
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(today)
    date.setDate(today.getDate() - offset)
    const key = dayOf(date.getTime())
    const bucket = daily.get(key)
    series.push({
      date: key,
      sessions: bucket?.sessions.size ?? 0,
      tokens: bucket?.tokens ?? ZERO_TOKENS,
      costUsd: bucket?.costUsd ?? 0,
    })
  }
  return series
}
