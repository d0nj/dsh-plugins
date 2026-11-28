import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { formatBasis, formatDate, formatDayLabel, formatModel, formatMoment, formatPercent, formatPrice, formatTokens, formatUsd } from './format.js'

describe('formatTokens', () => {
  it('keeps small counts exact', () => {
    assert.equal(formatTokens(0), '0')
    assert.equal(formatTokens(864), '864')
    assert.equal(formatTokens(999), '999')
  })

  it('compacts thousands, millions and billions to two significant decimals', () => {
    assert.equal(formatTokens(1_000), '1K')
    assert.equal(formatTokens(1_500), '1.5K')
    assert.equal(formatTokens(12_345), '12.35K')
    assert.equal(formatTokens(100_000), '100K')
    assert.equal(formatTokens(1_234_567), '1.23M')
    assert.equal(formatTokens(84_504_240), '84.5M')
    assert.equal(formatTokens(7_490_358_720), '7.49B')
  })

  it('reports a non-finite count as unknown', () => {
    assert.equal(formatTokens(Number.NaN), '—')
    assert.equal(formatTokens(Number.POSITIVE_INFINITY), '—')
  })
})

describe('formatUsd', () => {
  it('keeps cents for amounts people budget with', () => {
    assert.equal(formatUsd(128.194), '$128.19')
    assert.equal(formatUsd(1), '$1.00')
  })

  it('uses more precision below a dollar', () => {
    assert.equal(formatUsd(0.5), '$0.500')
    assert.equal(formatUsd(0.004), '<$0.01')
  })

  it('shows a true zero rather than a rounded one', () => {
    assert.equal(formatUsd(0), '$0')
  })
})

describe('formatDate', () => {
  it('omits the year for the current one and keeps it otherwise', () => {
    const june = new Date(2026, 5, 1, 12).getTime()
    assert.equal(formatDate(new Date(2026, 0, 15, 12).getTime(), june), 'Jan 15')
    assert.equal(formatDate(new Date(2025, 10, 3, 12).getTime(), june), 'Nov 3, 2025')
  })

  it('reports a missing timestamp as unknown', () => {
    assert.equal(formatDate(0), '—')
  })
})

describe('formatMoment', () => {
  it('reports a missing timestamp as unknown', () => {
    assert.equal(formatMoment(0), '—')
  })
})

describe('formatBasis', () => {
  it('names each kind of resolved price', () => {
    assert.equal(formatBasis('config', 1), 'config override')
    assert.equal(formatBasis('median', 93), 'median of 93 listings')
    assert.equal(formatBasis('deepseek', 4), 'DeepSeek listing')
    assert.equal(formatBasis('openrouter', 2), 'openrouter listing')
    assert.equal(formatBasis(null, 0), 'no price')
  })
})

describe('formatPrice', () => {
  it('lists input, cache-read and output rates in that order', () => {
    assert.equal(formatPrice({ input: 0.19, cacheRead: 0.006, output: 0.66 }), '$0.19 / $0.006 / $0.66')
  })
})

describe('formatModel', () => {
  it('keeps the provider prefix because it identifies the bill', () => {
    assert.equal(formatModel('router', 'deepseek-v4.1-flash'), 'router/deepseek-v4.1-flash')
    assert.equal(formatModel(null, 'deepseek-v4.1-flash'), 'deepseek-v4.1-flash')
    assert.equal(formatModel('router', null), 'no model recorded')
  })
})

describe('formatPercent', () => {
  it('keeps a decimal only where the digit changes the reading', () => {
    assert.equal(formatPercent(0.985), '99%')
    assert.equal(formatPercent(0.0532), '5.3%')
    assert.equal(formatPercent(0.001), '0.1%')
  })

  it('never rounds a partial share up to a whole', () => {
    assert.equal(formatPercent(0.99949), '99.9%')
    assert.equal(formatPercent(1), '100%')
  })

  it('reports nothing as zero', () => {
    assert.equal(formatPercent(0), '0%')
    assert.equal(formatPercent(Number.NaN), '0%')
  })
})

describe('formatDayLabel', () => {
  it('reads the bucket without a timezone shift', () => {
    assert.equal(formatDayLabel('2026-11-04'), 'Nov 4')
    assert.equal(formatDayLabel('2026-01-31'), 'Jan 31')
  })

  it('passes through anything that is not a day bucket', () => {
    assert.equal(formatDayLabel('yesterday'), 'yesterday')
  })
})
