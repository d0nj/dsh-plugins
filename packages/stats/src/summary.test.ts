import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { PriceMatch } from './pricing.js'
import { summarize } from './summary.js'
import type { SessionMeta, UsageEvent } from './summary.js'
import { makeTokens } from './tokens.js'

const NOW = new Date(2026, 10, 27, 12).getTime()
const YESTERDAY = new Date(2026, 10, 26, 12).getTime()

const tokens = (output: number) => makeTokens({ uncachedInput: 1_000, cacheRead: 9_000, cacheWrite: 0, output })

const event = (sessionId: string, overrides: Partial<UsageEvent> = {}): UsageEvent => ({
  sessionId,
  tokens: tokens(500),
  at: NOW,
  ...overrides,
})

const meta = (id: string, overrides: Partial<SessionMeta> = {}): SessionMeta => ({
  id,
  createdAt: NOW,
  ...overrides,
})

const price: PriceMatch = {
  price: { input: 1, cacheRead: 0.1, cacheWrite: 1, output: 4 },
  basis: 'median',
  sample: 7,
}

const priced = (): PriceMatch => price
const unpriced = (): undefined => undefined

describe('summarize', () => {
  it('sums every event into the payload totals', () => {
    const payload = summarize([event('a'), event('b')], [meta('a'), meta('b')], priced, { now: NOW })
    assert.equal(payload.totals.uncachedInput, 2_000)
    assert.equal(payload.totals.cacheRead, 18_000)
    assert.equal(payload.totals.output, 1_000)
    assert.equal(payload.totals.total, 21_000)
  })

  it('prices input, cache reads and output at their own rates', () => {
    const payload = summarize([event('a')], [meta('a')], priced, { now: NOW })
    assert.equal(payload.costUsd, (1_000 * 1 + 9_000 * 0.1 + 500 * 4) / 1_000_000)
  })

  it('groups per provider and model, counting distinct sessions', () => {
    const payload = summarize(
      [
        event('a', { provider: 'router', model: 'big' }),
        event('a', { provider: 'router', model: 'big' }),
        event('b', { provider: 'router', model: 'small' }),
      ],
      [meta('a'), meta('b')],
      priced,
      { now: NOW },
    )
    assert.deepEqual(payload.models.map((row) => row.model), ['big', 'small'])
    assert.equal(payload.models[0]?.sessions, 1)
    assert.equal(payload.models[0]?.tokens.output, 1_000)
  })

  it('buckets days in local time and fills the gaps with zeroes', () => {
    const payload = summarize(
      [event('a', { at: NOW }), event('b', { at: YESTERDAY }), event('c', { at: YESTERDAY })],
      [meta('a'), meta('b'), meta('c')],
      priced,
      { days: 3, now: NOW },
    )
    assert.deepEqual(payload.days.map((day) => day.date), ['2026-11-25', '2026-11-26', '2026-11-27'])
    assert.equal(payload.days[0]?.sessions, 0)
    assert.equal(payload.days[1]?.sessions, 2)
    assert.equal(payload.days[2]?.sessions, 1)
    assert.equal(payload.days[1]?.tokens.total, 21_000)
  })

  it('drops days outside the charted window from the series but not from the totals', () => {
    const payload = summarize([event('a', { at: new Date(2020, 0, 1, 12).getTime() })], [meta('a')], priced, {
      days: 2,
      now: NOW,
    })
    assert.equal(payload.days.length, 2)
    assert.equal(payload.days[0]?.sessions, 0)
    assert.equal(payload.totals.total, 10_500)
  })

  it('keeps one session with two models in both model rows and leaves its basis open', () => {
    const payload = summarize(
      [event('a', { provider: 'router', model: 'first' }), event('a', { provider: 'router', model: 'second' })],
      [meta('a')],
      priced,
      { now: NOW },
    )
    assert.equal(payload.models.length, 2)
    assert.equal(payload.top[0]?.basis, null)
    assert.equal(payload.top[0]?.tokens.total, 21_000)
  })

  it('counts sessions it cannot price instead of hiding their tokens', () => {
    const payload = summarize([event('a'), event('b')], [meta('a'), meta('b')], unpriced, { now: NOW })
    assert.equal(payload.costUsd, 0)
    assert.equal(payload.unpricedSessions, 2)
    assert.equal(payload.totals.total, 21_000)
  })

  it('keeps only the requested number of session rows, largest first', () => {
    const events = [1, 2, 3, 4, 5].map((size) =>
      event('session-' + size, { tokens: makeTokens({ uncachedInput: 0, cacheRead: 0, cacheWrite: 0, output: size }) }),
    )
    const sessions = [1, 2, 3, 4, 5].map((size) => meta('session-' + size))
    const payload = summarize(events, sessions, priced, { topSessions: 2, now: NOW })
    assert.deepEqual(payload.top.map((row) => row.id), ['session-5', 'session-4'])
  })

  it('joins the session title and workspace onto the row', () => {
    const payload = summarize([event('a')], [meta('a', { title: 'Fix the build', workspace: 'repo' })], priced, { now: NOW })
    assert.equal(payload.top[0]?.title, 'Fix the build')
    assert.equal(payload.top[0]?.workspace, 'repo')
  })

  it('reports scan and listing counts for the page status line', () => {
    const payload = summarize([event('a')], [meta('a')], priced, {
      now: NOW,
      scannedSessions: 12,
      scan: { scanned: 3, total: 9, running: true },
    })
    assert.equal(payload.scannedSessions, 12)
    assert.deepEqual(payload.scan, { scanned: 3, total: 9, running: true })
    assert.deepEqual(payload.price, { fetchedAt: null, available: false })
  })

  it('produces an empty but well-formed payload', () => {
    const payload = summarize([], [], priced, { days: 2, now: NOW })
    assert.equal(payload.totals.total, 0)
    assert.deepEqual(payload.models, [])
    assert.deepEqual(payload.top, [])
    assert.equal(payload.days.length, 2)
  })
})
