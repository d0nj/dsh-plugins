import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildCatalog, describeCatalogEntry, jsonSchemaToTs, renderSignature, searchCatalog } from './catalog.js'

const ECHO = {
  name: 'echo',
  description: 'Echo the text back. Useful for checking the pipe.',
  parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  output: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
}

const EDIT = {
  name: 'edit',
  description: 'Replace one exact string in a file. Fails when the string is absent.',
  parameters: {
    type: 'object',
    properties: { path: { type: 'string' }, oldText: { type: 'string' }, newText: { type: 'string' } },
    required: ['path', 'oldText', 'newText'],
  },
  output: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
}

const PWSH = { name: 'pwsh', description: 'Run a PowerShell command.', parameters: { type: 'object', properties: {} } }

describe('buildCatalog', () => {
  it('sorts by name and skips excluded and transport names', () => {
    const entries = buildCatalog([PWSH, EDIT, ECHO, { ...ECHO, name: 'run_code' }], { pinned: [], direct: [], exclude: ['pwsh'] })
    assert.deepEqual(entries.map(entry => entry.name), ['echo', 'edit'])
  })

  it('marks pinned and direct entries', () => {
    const entries = buildCatalog([ECHO, EDIT], { pinned: ['edit'], direct: ['echo'], exclude: [] })
    assert.deepEqual(entries.map(entry => [entry.name, entry.pinned, entry.direct]), [
      ['echo', false, true],
      ['edit', true, false],
    ])
  })

  it('summarizes the first sentence of the description', () => {
    const [entry] = buildCatalog([EDIT], { pinned: [], direct: [], exclude: [] })
    assert.equal(entry?.summary, 'Replace one exact string in a file.')
  })
})

describe('renderSignature', () => {
  it('renders required parameters without optional markers', () => {
    const signature = renderSignature('echo', ECHO.parameters, ECHO.output)
    assert.equal(signature, 'echo(text: string) => { text: string }')
  })

  it('quotes exotic tool names and marks optional fields', () => {
    const signature = renderSignature('my-tool', { type: 'object', properties: { 'dry-run': { type: 'boolean' } } }, undefined)
    assert.equal(signature, '"my-tool"("dry-run"?: boolean) => JsonValue')
  })
})

describe('jsonSchemaToTs', () => {
  it('renders enums, consts and arrays', () => {
    assert.equal(jsonSchemaToTs({ type: 'string', enum: ['a', 'b'] }), '"a" | "b"')
    assert.equal(jsonSchemaToTs({ const: 3 }), '3')
    assert.equal(jsonSchemaToTs({ type: 'array', items: { type: 'string' } }), 'string[]')
    assert.equal(jsonSchemaToTs({ type: 'array', items: { oneOf: [{ type: 'string' }, { type: 'number' }] } }), '(string | number)[]')
  })

  it('falls back to JsonValue for unconstrained nodes', () => {
    assert.equal(jsonSchemaToTs({ type: 'json' }), 'JsonValue')
    assert.equal(jsonSchemaToTs(undefined), 'JsonValue')
  })

  it('renders object nodes with an index signature when open', () => {
    assert.equal(jsonSchemaToTs({ type: 'object', properties: { a: { type: 'boolean' } }, additionalProperties: true, required: ['a'] }), '{ a: boolean; [key: string]: JsonValue }')
  })
})

describe('searchCatalog', () => {
  const entries = buildCatalog([ECHO, EDIT, PWSH], { pinned: [], direct: [], exclude: [] })

  it('ranks an exact name match first and drops non-matches', () => {
    assert.deepEqual(
      searchCatalog(entries, 'edit', 3).map(hit => hit.name),
      ['edit'],
    )
  })

  it('matches on description tokens', () => {
    assert.deepEqual(
      searchCatalog(entries, 'powershell', 3).map(hit => hit.name),
      ['pwsh'],
    )
  })

  it('returns an empty list when nothing matches', () => {
    assert.deepEqual(searchCatalog(entries, 'kubernetes', 3), [])
  })

  it('bounds the result count', () => {
    assert.equal(searchCatalog(entries, '', 2).length, 2)
  })
})

describe('describeCatalogEntry', () => {
  it('expands one entry with its argument block', () => {
    const entries = buildCatalog([ECHO], { pinned: [], direct: [], exclude: [] })
    const detail = describeCatalogEntry(entries, 'echo')
    assert.match(detail ?? '', /^echo\(text: string\) => \{ text: string \}\n/)
    assert.match(detail ?? '', /^ {4}text: string$/m)
  })

  it('returns undefined for an unknown name', () => {
    assert.equal(describeCatalogEntry([], 'nope'), undefined)
  })
})
