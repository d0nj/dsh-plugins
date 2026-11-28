import type { Tokens } from './tokens.js'
import { isRecord } from './tokens.js'

/** USD per one million tokens, per billed class. */
export interface ModelPrice {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** A resolved price plus the evidence it came from. */
export interface PriceMatch {
  price: ModelPrice
  basis: string
  sample: number
}

/** One cost record as catalogs publish it; a class may be absent. */
interface CatalogCost {
  input?: number | undefined
  output?: number | undefined
  cache_read?: number | undefined
  cache_write?: number | undefined
}

/** One provider's catalog entry for a model id. */
interface CatalogEntry {
  provider: string
  cost: CatalogCost
}

/** Provider entries keyed by the normalized model id they advertise. */
export type PriceIndex = ReadonlyMap<string, readonly CatalogEntry[]>

/** One model's price override, as configured by the user. */
export interface PriceOverride {
  input?: number
  cacheRead?: number
  cacheWrite?: number
  output?: number
}

/** The model ids recorded by DSH sessions, which may carry a vendor prefix. */
export function normalizeModelId(id: string): string {
  const segments = id.toLowerCase().split('/').filter((segment) => segment.length > 0)
  return segments[segments.length - 1] ?? id.toLowerCase()
}

/**
 * Index a models.dev catalog by normalized model id.
 *
 * The catalog nests every model under the provider that resells it, so one model
 * id generally has many entries with different prices; resolving a price means
 * choosing among them at lookup time.
 */
export function buildPriceIndex(catalog: unknown): PriceIndex {
  const index = new Map<string, CatalogEntry[]>()
  if (!isRecord(catalog)) return index
  for (const [provider, value] of Object.entries(catalog)) {
    if (!isRecord(value) || !isRecord(value.models)) continue
    for (const [model, modelValue] of Object.entries(value.models)) {
      if (!isRecord(modelValue) || !isRecord(modelValue.cost)) continue
      const cost = modelValue.cost
      const entry: CatalogEntry = {
        provider,
        cost: {
          input: priced(cost.input),
          output: priced(cost.output),
          cache_read: priced(cost.cache_read),
          cache_write: priced(cost.cache_write),
        },
      }
      if (entry.cost.input === undefined || entry.cost.output === undefined) continue
      const key = normalizeModelId(model)
      const entries = index.get(key)
      if (entries === undefined) index.set(key, [entry])
      else entries.push(entry)
    }
  }
  return index
}

function priced(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** A non-empty price, with cache classes falling back to the input rate. */
function toPrice(entry: CatalogEntry): ModelPrice | undefined {
  const input = entry.cost.input
  const output = entry.cost.output
  if (input === undefined || output === undefined) return undefined
  return {
    input,
    output,
    cacheRead: entry.cost.cache_read ?? input,
    cacheWrite: entry.cost.cache_write ?? input,
  }
}

/**
 * Resolve one session's price from overrides, then an exact provider match, then
 * the official DeepSeek listing, then the median across every listing.
 *
 * Billing depends on the deployment's own contract, so no single listing is
 * authoritative: the median is a defensible default, the recorded basis names it,
 * and the config override exists for deployments that know their real rates.
 */
export function resolvePrice(
  index: PriceIndex,
  provider: string,
  model: string,
  overrides: Readonly<Record<string, PriceOverride>> = {},
): PriceMatch | undefined {
  const key = normalizeModelId(model)
  const override = overrides[key] ?? overrides[model.toLowerCase()]
  const overridePrice = override === undefined ? undefined : toPrice({ provider: 'config', cost: toCatalogCost(override) })
  if (overridePrice !== undefined) return { price: overridePrice, basis: 'config', sample: 1 }

  const entries = index.get(key)
  if (entries === undefined) return undefined

  const exact = entries.find((entry) => entry.provider.toLowerCase() === provider.toLowerCase())
  const exactPrice = exact === undefined ? undefined : toPrice(exact)
  if (exact !== undefined && exactPrice !== undefined) {
    return { price: exactPrice, basis: exact.provider, sample: entries.length }
  }

  const official = entries.find((entry) => entry.provider === 'deepseek')
  const officialPrice = official === undefined ? undefined : toPrice(official)
  if (official !== undefined && officialPrice !== undefined) {
    return { price: officialPrice, basis: official.provider, sample: entries.length }
  }

  const prices = entries.map(toPrice).filter((price): price is ModelPrice => price !== undefined)
  if (prices.length === 0) return undefined
  const price: ModelPrice = {
    input: median(prices.map((entry) => entry.input)),
    output: median(prices.map((entry) => entry.output)),
    cacheRead: median(prices.map((entry) => entry.cacheRead)),
    cacheWrite: median(prices.map((entry) => entry.cacheWrite)),
  }
  return { price, basis: 'median', sample: prices.length }
}

function toCatalogCost(override: PriceOverride): CatalogCost {
  return {
    input: override.input,
    output: override.output,
    cache_read: override.cacheRead,
    cache_write: override.cacheWrite,
  }
}

/** The middle value of a non-empty numeric list. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[middle] ?? 0
  return ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

/** What one token count costs at one price, in USD. */
export function costOf(tokens: Tokens, price: ModelPrice): number {
  return (
    tokens.uncachedInput * price.input +
    tokens.cacheRead * price.cacheRead +
    tokens.cacheWrite * price.cacheWrite +
    tokens.output * price.output
  ) / 1_000_000
}
