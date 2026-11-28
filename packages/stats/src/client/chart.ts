/** One slice of a chart, before layout. */
export interface SeriesItem {
  key: string
  value: number
}

/** A slice resolved to its share of a whole. */
export interface Segment {
  key: string
  value: number
  from: number
  to: number
}

/** One donut arc, in the units an SVG stroke uses. */
export interface Arc {
  key: string
  length: number
  offset: number
  circumference: number
}

/** A slice widened to a usable pointer target. */
export interface HitZone {
  key: string
  value: number
  from: number
  to: number
}

const usable = (value: number): boolean => Number.isFinite(value) && value > 0

/**
 * Resolve items into cumulative shares of their total.
 *
 * The last boundary is pinned to 1 so adjacent strokes meet exactly instead of
 * leaving the sub-pixel seam that repeated float addition produces.
 */
export function fractions(items: readonly SeriesItem[]): Segment[] {
  const positive = items.filter((item) => usable(item.value))
  const total = positive.reduce((sum, item) => sum + item.value, 0)
  if (total <= 0) return []
  const segments: Segment[] = []
  let cursor = 0
  for (const item of positive) {
    const from = cursor
    cursor += item.value / total
    segments.push({ key: item.key, value: item.value, from, to: cursor })
  }
  const last = segments[segments.length - 1]
  if (last !== undefined) last.to = 1
  return segments
}

/**
 * Keep the largest `most - 1` items and fold the rest into one tail slice.
 *
 * A donut stops being readable past a handful of slices, and the tail is still
 * represented, so nothing is silently dropped from the picture.
 */
export function groupSmall(items: readonly SeriesItem[], most: number): SeriesItem[] {
  const positive = items.filter((item) => usable(item.value))
  if (most <= 0 || positive.length <= most) return positive
  const sorted = [...positive].sort((left, right) => right.value - left.value)
  const kept = sorted.slice(0, most - 1)
  const rest = sorted.slice(most - 1).reduce((sum, item) => sum + item.value, 0)
  return [...kept, { key: 'other', value: rest }]
}

/** Lay segments out as donut strokes for a circle of the given radius. */
export function donutArcs(segments: readonly Segment[], radius: number): Arc[] {
  const circumference = 2 * Math.PI * Math.max(0, radius)
  return segments.map((segment) => ({
    key: segment.key,
    length: Math.max(0, segment.to - segment.from) * circumference,
    offset: segment.from * circumference,
    circumference,
  }))
}

/** Scale values to column heights, keeping their relative sizes. */
export function columnHeights(values: readonly number[], height: number): number[] {
  const largest = values.reduce((max, value) => (usable(value) && value > max ? value : max), 0)
  if (largest <= 0 || height <= 0) return values.map(() => 0)
  return values.map((value) => (usable(value) ? (value / largest) * height : 0))
}

/**
 * Widen each slice into a pointer target of at least `minWidth`, keeping it
 * centred on the slice it stands for.
 *
 * A share of three tokens can be a two-pixel band, impossible to hit on purpose.
 * Zones may overlap, so they are returned widest-first: painted in that order, the
 * narrowest target sits on top and wins the overlap.
 */
export function hitZones(segments: readonly Segment[], minWidth: number): HitZone[] {
  if (segments.length === 0) return []
  const limit = Math.min(Math.max(minWidth, 0), 1 / segments.length)
  const zones = segments.map((segment) => {
    const width = Math.max(segment.to - segment.from, limit)
    const center = (segment.from + segment.to) / 2
    const from = Math.min(1 - width, Math.max(0, center - width / 2))
    return { key: segment.key, value: segment.value, from, to: from + width, width }
  })
  return zones
    .sort((left, right) => right.width - left.width)
    .map((zone) => ({ key: zone.key, value: zone.value, from: zone.from, to: zone.to }))
}
