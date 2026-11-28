import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { splitReadRange, stripEnvelope } from './envelope.js'

describe('stripEnvelope', () => {
  it('removes a wrapper that owns its own lines', () => {
    assert.equal(stripEnvelope('<content>\n1: a\n2: b\n</content>'), '1: a\n2: b')
  })

  it('removes a wrapper that shares a line with the body', () => {
    assert.equal(stripEnvelope('<content>hello</content>'), 'hello')
  })

  it('removes the path and type metadata lines', () => {
    const source = '<path>D:\\work\\README.md</path>\n<type>file</type>\n<content>\n1: # title\n</content>'
    assert.equal(stripEnvelope(source), '1: # title')
  })

  it('keeps inner angle brackets untouched', () => {
    assert.equal(stripEnvelope('const x = a < b ? 1 : 2\n<div>ok</div>'), 'const x = a < b ? 1 : 2\n<div>ok</div>')
  })

  it('leaves plain text alone', () => {
    assert.equal(stripEnvelope('just output'), 'just output')
  })

  it('handles an empty document', () => {
    assert.equal(stripEnvelope(''), '')
  })
})

describe('splitReadRange', () => {
  it('lifts the continuation notice out of the body', () => {
    const source = '1: a\n2: b\n(Showing lines 86-103 of 871. Use offset=104 to continue.)'
    const split = splitReadRange(source)
    assert.equal(split.range, 'lines 86\u2013103 of 871')
    assert.equal(split.text, '1: a\n2: b')
  })

  it('leaves a body without a notice alone', () => {
    assert.deepEqual(splitReadRange('1: a'), { text: '1: a', range: null })
  })

  it('only matches the notice at the very end', () => {
    const source = '(Showing lines 1-2 of 3. Use offset=3 to continue.)\nmore'
    assert.equal(splitReadRange(source).range, null)
  })
})
