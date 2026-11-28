import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { diffLines, diffOps, diffRows, diffSummary } from './diff.js'

describe('diffOps', () => {
  it('marks an unchanged document as equal', () => {
    const ops = diffOps('a\nb', 'a\nb')
    assert.equal(ops.length, 2)
    assert.ok(ops.every((op) => op.kind === 'equal'))
  })

  it('marks a single changed line as remove plus add', () => {
    const ops = diffOps('a\nb\nc', 'a\nB\nc')
    const kinds = ops.map((op) => op.kind)
    assert.deepEqual(kinds, ['equal', 'remove', 'add', 'equal', 'equal'].slice(0, kinds.length))
    assert.ok(kinds.includes('remove'))
    assert.ok(kinds.includes('add'))
  })

  it('marks every line as an addition for an empty source', () => {
    const ops = diffOps('', 'one\ntwo')
    assert.deepEqual(ops.map((op) => op.kind), ['add', 'add'])
  })

  it('marks every line as a removal for an emptied source', () => {
    const ops = diffOps('one\ntwo', '')
    assert.deepEqual(ops.map((op) => op.kind), ['remove', 'remove'])
  })

  it('keeps a stable order for a large replacement', () => {
    const before = Array.from({ length: 2000 }, (_value, index) => 'old ' + String(index)).join('\n')
    const after = Array.from({ length: 2000 }, (_value, index) => 'new ' + String(index)).join('\n')
    const ops = diffOps(before, after)
    assert.ok(ops.length >= 4000)
    assert.equal(ops.filter((op) => op.kind === 'remove').length, 2000)
    assert.equal(ops.filter((op) => op.kind === 'add').length, 2000)
  })
})

describe('diffRows', () => {
  it('numbers each side of the change', () => {
    const { rows } = diffRows(diffLines('a\nb\nc', 'a\nB\nc', 5))
    const removed = rows.find((row) => row.kind === 'remove')
    const added = rows.find((row) => row.kind === 'add')
    assert.equal(removed?.sign, '\u2212')
    assert.equal(added?.sign, '+')
    assert.equal(removed?.number, '2')
    assert.equal(added?.number, '', 'a replacement repeats the number, so it is omitted')
  })

  it('reserves at least three digits for the gutter', () => {
    assert.equal(diffRows(diffLines('a', 'b', 5)).digits, 3)
  })

  it('carries the context sign and number', () => {
    const { rows } = diffRows(diffLines('a\nb\nc', 'a\nB\nc', 5))
    assert.equal(rows[0]?.sign, ' ')
    assert.equal(rows[0]?.number, '1')
  })
})

describe('diffLines', () => {
  it('keeps surrounding context and collapses the rest', () => {
    const before = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].join('\n')
    const after = ['one', 'two', 'three', 'four', 'FIVE', 'six', 'seven', 'eight'].join('\n')
    const lines = diffLines(before, after)
    const kinds = lines.map((line) => line.kind)
    assert.ok(kinds.includes('remove'))
    assert.ok(kinds.includes('add'))
    assert.ok(kinds.includes('equal'))
    assert.equal(lines.find((line) => line.kind === 'remove')?.text, 'five')
    assert.equal(lines.find((line) => line.kind === 'add')?.text, 'FIVE')
  })

  it('counts additions and removals for the header', () => {
    const lines = diffLines('a\nb\nc', 'a\nX\nY\nc')
    const summary = diffSummary(lines)
    assert.equal(summary.removed, 1)
    assert.equal(summary.added, 2)
  })

  it('reports the source line numbers', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc', 5)
    const removed = lines.find((line) => line.kind === 'remove')
    const added = lines.find((line) => line.kind === 'add')
    assert.equal(removed?.oldLine, 2)
    assert.equal(added?.newLine, 2)
  })

  it('truncates an enormous diff', () => {
    const before = Array.from({ length: 2000 }, (_value, index) => 'old ' + String(index)).join('\n')
    const after = Array.from({ length: 2000 }, (_value, index) => 'new ' + String(index)).join('\n')
    const lines = diffLines(before, after, 3, 50)
    assert.ok(lines.length <= 52)
    assert.equal(lines[lines.length - 1]?.kind, 'hunk')
  })

  it('produces no lines for two empty texts', () => {
    assert.deepEqual(diffLines('', ''), [])
  })
})
