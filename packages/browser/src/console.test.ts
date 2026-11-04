import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ConsoleBuffer, describeRemoteObject } from './console.js'

describe('describeRemoteObject', () => {
  it('renders a string argument as itself', () => {
    assert.equal(describeRemoteObject({ type: 'string', value: 'Order saved' }), 'Order saved')
  })

  it('renders a structured argument as compact JSON', () => {
    assert.equal(describeRemoteObject({ type: 'object', value: { id: 3, ok: true } }), '{"id":3,"ok":true}')
  })

  it('falls back to the description for a live object', () => {
    assert.equal(describeRemoteObject({ type: 'object', className: 'Promise', description: 'Promise {<pending>}' }), 'Promise {<pending>}')
  })

  it('keeps an unserializable value', () => {
    assert.equal(describeRemoteObject({ type: 'number', unserializableValue: 'NaN' }), 'NaN')
  })

  it('caps one very long line', () => {
    const long = describeRemoteObject({ type: 'string', value: 'x'.repeat(2_000) })
    assert.equal(long.length, 600)
  })
})

describe('ConsoleBuffer', () => {
  it('keeps insertion order and reports errors separately', () => {
    const buffer = new ConsoleBuffer(10)
    buffer.push('log', 'started')
    buffer.push('error', 'boom')
    buffer.push('warning', 'careful')
    assert.deepEqual(buffer.entries().map((entry) => entry.level), ['log', 'error', 'warning'])
    assert.deepEqual(buffer.errors().map((entry) => entry.text), ['boom'])
  })

  it('drops the oldest line past the limit', () => {
    const buffer = new ConsoleBuffer(3)
    for (const line of ['one', 'two', 'three', 'four']) buffer.push('log', line)
    assert.deepEqual(buffer.entries().map((entry) => entry.text), ['two', 'three', 'four'])
  })

  it('ignores blank lines', () => {
    const buffer = new ConsoleBuffer()
    buffer.push('log', '   ')
    assert.equal(buffer.entries().length, 0)
  })

  it('clears on request', () => {
    const buffer = new ConsoleBuffer()
    buffer.push('log', 'x')
    buffer.clear()
    assert.equal(buffer.entries().length, 0)
  })
})
