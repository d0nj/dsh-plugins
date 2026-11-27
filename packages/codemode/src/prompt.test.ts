import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildCatalog } from './catalog.js'
import { ONLY_INSTRUCTION, directInstruction, renderCatalog, renderSections } from './prompt.js'

const TOOLS = [
  { name: 'alpha', description: 'Alpha tool. Second sentence here.', parameters: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } },
  { name: 'beta', description: 'Beta tool.', parameters: { type: 'object', properties: { b: { type: 'number' } } } },
  { name: 'gamma', description: 'Gamma tool.', parameters: { type: 'object', properties: {} } },
]

const ENTRIES = buildCatalog(TOOLS, { pinned: ['beta'], direct: [], exclude: [] })

describe('renderCatalog', () => {
  it('inlines pinned signatures and lists the rest in hybrid mode', () => {
    const text = renderCatalog(ENTRIES, 'hybrid', 24_000)
    assert.match(text, /beta\(b\?: number\) => JsonValue/)
    assert.match(text, /- alpha\(a: string\) => JsonValue — Alpha tool\./)
    assert.match(text, /- gamma\(\) => JsonValue — Gamma tool\./)
  })

  it('inlines nothing but the index in search mode', () => {
    const text = renderCatalog(ENTRIES, 'search', 24_000)
    assert.doesNotMatch(text, /^beta\(b\?: number\)/m)
    assert.match(text, /- beta\(b\?: number\) => JsonValue — Beta tool\./)
  })

  it('renders every signature in full mode', () => {
    const text = renderCatalog(ENTRIES, 'full', 1)
    assert.match(text, /alpha\(a: string\) => JsonValue/)
    assert.match(text, /beta\(b\?: number\) => JsonValue/)
  })

  it('stops inlining pinned entries at the byte budget', () => {
    const text = renderCatalog(ENTRIES, 'hybrid', 4)
    assert.doesNotMatch(text, /^beta\(b\?: number\)/m)
  })

  it('states the empty case', () => {
    assert.equal(renderCatalog([], 'hybrid', 100), 'No tools are bound to this program.')
  })
})

describe('renderSections', () => {
  it('prefixes the program rules and the catalog', () => {
    const text = renderSections(ENTRIES, 'hybrid', 24_000)
    assert.match(text, /## Writing code for run_code/)
    assert.match(text, /await catalog\.search\(\{ query \}\)/)
    assert.match(text, /### Catalog/)
  })
})

describe('directInstruction', () => {
  it('names the tools that stay direct', () => {
    assert.match(directInstruction(['skill', 'ask_user_question']), /Call `skill`, `ask_user_question` directly/)
  })

  it('falls back to the bare rule without direct tools', () => {
    assert.equal(directInstruction([]), ONLY_INSTRUCTION)
  })
})
