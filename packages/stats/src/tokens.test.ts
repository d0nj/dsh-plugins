import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ZERO_TOKENS, addTokens, makeTokens, tokensOfUsage } from './tokens.js'

describe('tokensOfUsage', () => {
  it('keeps the four billed classes disjoint', () => {
    const totals = tokensOfUsage({
      inputTokens: 1_000,
      cacheReadTokens: 9_000,
      cacheWriteTokens: 500,
      outputTokens: 250,
      totalTokens: 10_750,
    })
    assert.deepEqual(totals, {
      uncachedInput: 1_000,
      cacheRead: 9_000,
      cacheWrite: 500,
      output: 250,
      total: 10_750,
    })
  })

  it('treats a missing cache class as zero rather than as unknown', () => {
    const totals = tokensOfUsage({ inputTokens: 12, outputTokens: 4 })
    assert.equal(totals?.cacheRead, 0)
    assert.equal(totals?.cacheWrite, 0)
    assert.equal(totals?.total, 16)
  })

  it('rejects an object without a usable input or output count', () => {
    assert.equal(tokensOfUsage({ inputTokens: 10 }), undefined)
    assert.equal(tokensOfUsage({ outputTokens: 10 }), undefined)
    assert.equal(tokensOfUsage({ inputTokens: -1, outputTokens: 2 }), undefined)
    assert.equal(tokensOfUsage({ inputTokens: Number.NaN, outputTokens: 2 }), undefined)
    assert.equal(tokensOfUsage(null), undefined)
    assert.equal(tokensOfUsage([]), undefined)
  })
})

describe('makeTokens', () => {
  it('derives the total from the classes', () => {
    assert.equal(makeTokens({ uncachedInput: 1, cacheRead: 2, cacheWrite: 3, output: 4 }).total, 10)
  })
})

describe('addTokens', () => {
  it('leaves a value unchanged when added to zero', () => {
    const totals = makeTokens({ uncachedInput: 5, cacheRead: 7, cacheWrite: 0, output: 3 })
    assert.deepEqual(addTokens(ZERO_TOKENS, totals), totals)
  })

  it('is associative over the class sums', () => {
    const left = makeTokens({ uncachedInput: 1, cacheRead: 2, cacheWrite: 3, output: 4 })
    const middle = makeTokens({ uncachedInput: 10, cacheRead: 20, cacheWrite: 30, output: 40 })
    const right = makeTokens({ uncachedInput: 100, cacheRead: 200, cacheWrite: 300, output: 400 })
    assert.deepEqual(
      addTokens(addTokens(left, middle), right),
      addTokens(left, addTokens(middle, right)),
    )
  })
})
