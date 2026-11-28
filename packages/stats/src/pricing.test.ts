import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildPriceIndex, costOf, median, normalizeModelId, resolvePrice } from './pricing.js'
import { makeTokens } from './tokens.js'

const catalog = {
  deepseek: {
    models: {
      'deepseek-v4-pro': { cost: { input: 0.66, output: 1.98, cache_read: 0.022 } },
    },
  },
  openrouter: {
    models: {
      'deepseek/deepseek-v4.1-flash': { cost: { input: 0.14, output: 0.42, cache_read: 0.0042 } },
    },
  },
  opencode: {
    models: {
      'deepseek-v4.1-flash': { cost: { input: 0.12, output: 0.48, cache_read: 0.0024 } },
    },
  },
  priced: {
    models: {
      'some-model': { cost: { input: 0.2, output: 0.4 } },
    },
  },
  unpriced: {
    models: {
      'free-model': { cost: null },
      'no-model': {},
    },
  },
}

const index = buildPriceIndex(catalog)

describe('normalizeModelId', () => {
  it('keeps only the last path segment, lowercased', () => {
    assert.equal(normalizeModelId('deepseek/deepseek-v4.1-flash'), 'deepseek-v4.1-flash')
    assert.equal(normalizeModelId('Meta/Muse-Spark-1.3'), 'muse-spark-1.3')
    assert.equal(normalizeModelId('plain'), 'plain')
  })

  it('falls back to the raw id when every segment is empty', () => {
    assert.equal(normalizeModelId('/'), '/')
  })
})

describe('buildPriceIndex', () => {
  it('indexes listings by normalized id and skips entries without a price', () => {
    assert.deepEqual([...(index.get('deepseek-v4.1-flash') ?? [])].map((entry) => entry.provider).sort(), ['opencode', 'openrouter'])
    assert.equal(index.get('free-model'), undefined)
    assert.equal(index.get('no-model'), undefined)
    assert.equal(buildPriceIndex(null).size, 0)
    assert.equal(buildPriceIndex({ broken: { models: 'nope' } }).size, 0)
  })
})

describe('resolvePrice', () => {
  it('lets a configured override win over every listing', () => {
    const match = resolvePrice(index, 'openrouter', 'deepseek-v4.1-flash', {
      'deepseek-v4.1-flash': { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.25 },
    })
    assert.equal(match?.basis, 'config')
    assert.deepEqual(match?.price, { input: 1, output: 2, cacheRead: 0.5, cacheWrite: 0.25 })
  })

  it('prefers the listing of the provider that actually served the call', () => {
    const match = resolvePrice(index, 'openrouter', 'deepseek-v4.1-flash')
    assert.equal(match?.basis, 'openrouter')
    assert.equal(match?.price.input, 0.14)
    assert.equal(match?.sample, 2)
  })

  it('prefers the official DeepSeek listing over a median of resellers', () => {
    const match = resolvePrice(index, 'my-router', 'deepseek-v4-pro')
    assert.equal(match?.basis, 'deepseek')
    assert.equal(match?.price.cacheRead, 0.022)
  })

  it('falls back to the median across listings', () => {
    const match = resolvePrice(index, 'my-router', 'deepseek-v4.1-flash')
    assert.equal(match?.basis, 'median')
    assert.ok(match !== undefined)
    assert.ok(Math.abs(match.price.input - 0.13) < 1e-9)
    assert.ok(Math.abs(match.price.cacheRead - 0.0033) < 1e-9)
    assert.ok(Math.abs(match.price.output - 0.45) < 1e-9)
  })

  it('charges an unpublished cache rate at the input rate', () => {
    const match = resolvePrice(index, 'priced', 'some-model')
    assert.deepEqual(match?.price, { input: 0.2, output: 0.4, cacheRead: 0.2, cacheWrite: 0.2 })
  })

  it('reports nothing when no listing prices the model', () => {
    assert.equal(resolvePrice(index, 'my-router', 'free-model'), undefined)
    assert.equal(resolvePrice(index, 'my-router', 'unknown-model'), undefined)
  })
})

describe('median', () => {
  it('handles odd and even populations', () => {
    assert.equal(median([3, 1, 2]), 2)
    assert.equal(median([4, 1, 3, 2]), 2.5)
    assert.equal(median([5]), 5)
  })
})

describe('costOf', () => {
  it('prices each class at its own rate', () => {
    const tokens = makeTokens({ uncachedInput: 1_000_000, cacheRead: 2_000_000, cacheWrite: 0, output: 500_000 })
    const cost = costOf(tokens, { input: 1, cacheRead: 0.1, cacheWrite: 2, output: 4 })
    assert.equal(cost, 1 + 0.2 + 2)
  })

  it('charges nothing for an empty count', () => {
    assert.equal(costOf(makeTokens({ uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: 0 }), { input: 9, cacheRead: 9, cacheWrite: 9, output: 9 }), 0)
  })
})
