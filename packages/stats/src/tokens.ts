/** Token counts split the way providers bill them. */
export interface Tokens {
  uncachedInput: number
  cacheRead: number
  cacheWrite: number
  output: number
}

/** Totals including the derived sum of all four classes. */
export interface TokenTotals extends Tokens {
  total: number
}

/** A count that contributes nothing; the identity of {@link addTokens}. */
export const ZERO_TOKENS: TokenTotals = {
  uncachedInput: 0,
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  total: 0,
}

/** Add two token counts. */
export function addTokens(left: TokenTotals, right: TokenTotals): TokenTotals {
  const uncachedInput = left.uncachedInput + right.uncachedInput
  const cacheRead = left.cacheRead + right.cacheRead
  const cacheWrite = left.cacheWrite + right.cacheWrite
  const output = left.output + right.output
  return { uncachedInput, cacheRead, cacheWrite, output, total: uncachedInput + cacheRead + cacheWrite + output }
}

/** Build totals from the four classes, deriving the sum. */
export function makeTokens(tokens: Tokens): TokenTotals {
  const total = tokens.uncachedInput + tokens.cacheRead + tokens.cacheWrite + tokens.output
  return { ...tokens, total }
}

/**
 * Read a provider usage object.
 *
 * `inputTokens` is the uncached part only, so the four classes are disjoint and
 * the sum matches the provider's billed total.
 */
export function tokensOfUsage(value: unknown): TokenTotals | undefined {
  if (!isRecord(value)) return undefined
  const uncachedInput = countOf(value.uncachedInputTokens) ?? countOf(value.inputTokens)
  const output = countOf(value.outputTokens)
  if (uncachedInput === undefined || output === undefined) return undefined
  return makeTokens({
    uncachedInput,
    cacheRead: countOf(value.cacheReadTokens) ?? 0,
    cacheWrite: countOf(value.cacheWriteTokens) ?? 0,
    output,
  })
}

/** A finite, non-negative token count. */
export function countOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** A plain object, as opposed to an array or null. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
