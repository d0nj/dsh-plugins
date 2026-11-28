/** Compact token counts: `7.49B`, `84.5M`, `12.3K`, `864`. */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const absolute = Math.abs(value)
  if (absolute < 1_000) return String(Math.round(value))
  if (absolute < 1_000_000) return strip(value / 1_000) + 'K'
  if (absolute < 1_000_000_000) return strip(value / 1_000_000) + 'M'
  return strip(value / 1_000_000_000) + 'B'
}

function strip(value: number): string {
  const fixed = value >= 100 ? value.toFixed(0) : value.toFixed(2)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/u, '') : fixed
}

/** A dollar figure that stays readable from four decimals up to thousands. */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  if (Math.abs(value) < 0.01) return '<$0.01'
  if (Math.abs(value) < 1) return '$' + value.toFixed(3)
  return '$' + value.toFixed(2)
}

/** A short calendar date, with the year only when it is not the current one. */
export function formatDate(epochMs: number, now: number = Date.now()): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '—'
  const date = new Date(epochMs)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  const month = date.toLocaleString('en', { month: 'short' })
  return sameYear ? month + ' ' + date.getDate() : month + ' ' + date.getDate() + ', ' + date.getFullYear()
}

/** A date with the wall-clock time, for freshness stamps. */
export function formatMoment(epochMs: number): string {
  if (!Number.isFinite(epochMs) || epochMs <= 0) return '—'
  return new Date(epochMs).toLocaleString('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Where a resolved price came from, in the words the page shows. */
export function formatBasis(basis: string | null, sample: number): string {
  if (basis === null) return 'no price'
  if (basis === 'config') return 'config override'
  if (basis === 'median') return 'median of ' + sample + ' listings'
  if (basis === 'deepseek') return 'DeepSeek listing'
  return basis + ' listing'
}

/** `$per million` prices as one compact line. */
export function formatPrice(price: { input: number; cacheRead: number; output: number }): string {
  return [price.input, price.cacheRead, price.output].map((value) => '$' + String(value)).join(' / ')
}

/** A model identity with the router prefix kept, because it identifies the bill. */
export function formatModel(provider: string | null, model: string | null): string {
  if (model === null) return 'no model recorded'
  return provider === null ? model : provider + '/' + model
}

/** A share of a whole, precise enough to show that 99% is not 100%. */
export function formatPercent(fraction: number): string {
  if (!Number.isFinite(fraction) || fraction <= 0) return '0%'
  const value = fraction * 100
  if (value >= 100) return '100%'
  if (value >= 10) return (Math.round(value) >= 100 ? '99.9' : String(Math.round(value))) + '%'
  return value.toFixed(1).replace(/\.0$/u, '') + '%'
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** A `YYYY-MM-DD` bucket as a short axis label, read without a timezone shift. */
export function formatDayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date)
  if (match === null) return date
  const month = MONTHS[Number(match[2]) - 1]
  return (month ?? '') + ' ' + String(Number(match[3]))
}
