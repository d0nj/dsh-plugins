import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { SECTION_NAME, SECTION_ORDER, buildNarrationSection } from './narration.js'
import type { NarrationOptions } from './narration.js'

function options(overrides: Partial<NarrationOptions> = {}): NarrationOptions {
  return { intentLine: true, parallelReads: true, intentWords: 24, ...overrides }
}

describe('buildNarrationSection', () => {
  it('contributes nothing when every rule is off', () => {
    assert.equal(buildNarrationSection(options({ intentLine: false, parallelReads: false })), null)
  })

  it('opens with a heading and states the intent rule', () => {
    const text = buildNarrationSection(options()) ?? ''
    assert.ok(text.startsWith('## Narration before action'))
    assert.ok(text.includes('one sentence of intent'))
    assert.ok(text.includes('Reading src/server.rs'))
  })

  it('carries the word budget it was given', () => {
    assert.ok((buildNarrationSection(options({ intentWords: 12 })) ?? '').includes('under 12 words'))
  })

  it('states the concurrency rule only when enabled', () => {
    const withRule = buildNarrationSection(options()) ?? ''
    const withoutRule = buildNarrationSection(options({ parallelReads: false })) ?? ''
    assert.ok(withRule.includes('run concurrently'))
    assert.ok(!withoutRule.includes('run concurrently'))
  })

  it('still contributes the concurrency rule alone', () => {
    const text = buildNarrationSection(options({ intentLine: false })) ?? ''
    assert.ok(text.includes('run concurrently'))
    assert.ok(!text.includes('one sentence of intent'))
  })
})

describe('section identity', () => {
  it('keeps a stable name and an order ahead of the tool sections', () => {
    assert.equal(SECTION_NAME, 'd0nj-narration')
    assert.ok(SECTION_ORDER > 0 && SECTION_ORDER < 1000)
  })
})
