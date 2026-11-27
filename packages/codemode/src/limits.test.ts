import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AttemptBudget, Semaphore, ToolCallLimitExceededError, truncateMiddle } from './limits.js'

describe('AttemptBudget', () => {
  it('scales the allowance with the resolved timeout', () => {
    const budget = new AttemptBudget(60, 120_000)
    for (let attempt = 1; attempt <= 120; attempt += 1) assert.equal(budget.next(), attempt)
    assert.throws(() => budget.next(), ToolCallLimitExceededError)
  })

  it('allows unbounded attempts without a timeout', () => {
    const budget = new AttemptBudget(1, null)
    for (let attempt = 0; attempt < 1_000; attempt += 1) budget.next()
  })

  it('refuses a call that exceeds a short-timeout budget', () => {
    const budget = new AttemptBudget(60, 1_000)
    assert.equal(budget.next(), 1)
    assert.throws(() => budget.next(), /tool call limit exceeded/)
  })
})

describe('Semaphore', () => {
  it('never exceeds the capacity', async () => {
    const semaphore = new Semaphore(2)
    let active = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 8 }, async () =>
        semaphore.run(async () => {
          active += 1
          peak = Math.max(peak, active)
          await new Promise(resolve => setTimeout(resolve, 1))
          active -= 1
        }),
      ),
    )
    assert.equal(peak, 2)
  })

  it('runs a single task to completion', async () => {
    assert.equal(await new Semaphore(1).run(async () => 42), 42)
  })
})

describe('truncateMiddle', () => {
  it('keeps short text unchanged', () => {
    assert.equal(truncateMiddle('short', 100), 'short')
  })

  it('marks the omitted middle', () => {
    const text = truncateMiddle('abcdefghij'.repeat(20), 80)
    assert.equal(text.length, 80)
    assert.match(text, /characters omitted/)
    assert.ok(text.startsWith('abcdefghij'))
    assert.ok(text.endsWith('abcdefghij'))
  })
})
