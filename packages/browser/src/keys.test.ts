import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { KeyChordError, MODIFIER, parseKeyChord } from './keys.js'

describe('parseKeyChord', () => {
  it('maps a named key to the fields Chrome needs', () => {
    const enter = parseKeyChord('Enter')
    assert.equal(enter.key, 'Enter')
    assert.equal(enter.code, 'Enter')
    assert.equal(enter.keyCode, 13)
    assert.equal(enter.text, '\r')
    assert.equal(enter.modifiers, 0)
  })

  it('accepts a single letter and its shift form', () => {
    assert.deepEqual(parseKeyChord('a'), { key: 'a', code: 'KeyA', keyCode: 65, modifiers: 0, text: 'a' })
    assert.deepEqual(parseKeyChord('Shift+A'), { key: 'A', code: 'KeyA', keyCode: 65, modifiers: MODIFIER.Shift, text: 'A' })
  })

  it('drops the text of a chord that holds a command modifier', () => {
    const chord = parseKeyChord('Control+A')
    assert.equal(chord.modifiers, MODIFIER.Control)
    assert.equal(chord.text, undefined)
    assert.equal(chord.key, 'a')
  })

  it('accepts platform-friendly modifier aliases', () => {
    assert.equal(parseKeyChord('Cmd+Shift+P').modifiers, MODIFIER.Meta | MODIFIER.Shift)
    assert.equal(parseKeyChord('option+ArrowLeft').modifiers, MODIFIER.Alt)
  })

  it('maps arrow and function keys', () => {
    assert.equal(parseKeyChord('ArrowDown').keyCode, 40)
    assert.equal(parseKeyChord('down').key, 'ArrowDown')
    assert.equal(parseKeyChord('F5').keyCode, 116)
    assert.equal(parseKeyChord('PageDown').keyCode, 34)
  })

  it('maps punctuation to its physical key', () => {
    assert.deepEqual(parseKeyChord('/'), { key: '/', code: 'Slash', keyCode: 191, modifiers: 0, text: '/' })
  })

  it('rejects an unknown key name by naming what is accepted', () => {
    assert.throws(() => parseKeyChord('HyperKey'), (error: unknown) => {
      assert.ok(error instanceof KeyChordError)
      assert.match(error.message, /unknown key "HyperKey"/u)
      return true
    })
  })

  it('rejects a chord without a key or with a bad modifier', () => {
    assert.throws(() => parseKeyChord(''), KeyChordError)
    assert.throws(() => parseKeyChord('Control+'), KeyChordError)
    assert.throws(() => parseKeyChord('Fn+A'), /not a modifier/u)
  })
})
