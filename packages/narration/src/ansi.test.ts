import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { compactOutput, normalizeTerminalText, parseAnsi, stripAnsi } from './ansi.js'

describe('normalizeTerminalText', () => {
  it('expands tabs', () => {
    assert.equal(normalizeTerminalText('a\tb'), 'a    b')
  })

  it('keeps only the final state of a carriage-return line', () => {
    assert.equal(normalizeTerminalText('progress 10%\rprogress 100%'), 'progress 100%')
  })

  it('preserves real newlines', () => {
    assert.equal(normalizeTerminalText('one\ntwo'), 'one\ntwo')
  })

  it('drops an operating-system command', () => {
    assert.equal(normalizeTerminalText('a\u001b]0;title\u0007b'), 'ab')
  })
})

describe('compactOutput', () => {
  it('collapses a run of blank lines', () => {
    assert.equal(compactOutput('a\n\n\n\nb'), 'a\n\nb')
  })

  it('trims surrounding blank lines', () => {
    assert.equal(compactOutput('\n\na\n\n'), 'a')
  })

  it('strips trailing spaces on each line', () => {
    assert.equal(compactOutput('a   \nb\t\n'), 'a\nb')
  })
})

describe('stripAnsi', () => {
  it('removes colour codes', () => {
    assert.equal(stripAnsi('\u001b[31mred\u001b[0m plain'), 'red plain')
  })

  it('removes cursor movement', () => {
    assert.equal(stripAnsi('\u001b[2Kafter'), 'after')
  })
})

describe('parseAnsi', () => {
  it('returns one plain span for unstyled text', () => {
    assert.deepEqual(parseAnsi('hello'), [
      { text: 'hello', tone: 'default', bold: false, dim: false, underline: false },
    ])
  })

  it('maps the basic colours it can express with theme tokens', () => {
    const spans = parseAnsi('\u001b[31merr\u001b[32mok\u001b[33mwarn\u001b[0m')
    assert.equal(spans[0]?.tone, 'error')
    assert.equal(spans[1]?.tone, 'success')
    assert.equal(spans[2]?.tone, 'warn')
    assert.equal(spans[2]?.text, 'warn')
  })

  it('remembers bold, dim and underline until reset', () => {
    const spans = parseAnsi('\u001b[1mbold\u001b[22mplain\u001b[4munder\u001b[0m')
    assert.equal(spans[0]?.bold, true)
    assert.equal(spans[1]?.bold, false)
    assert.equal(spans[2]?.underline, true)
  })

  it('drops unknown foreground colours rather than leaking codes', () => {
    const spans = parseAnsi('\u001b[35mmagenta\u001b[0m')
    assert.equal(spans[0]?.tone, 'default')
    assert.equal(spans[0]?.text, 'magenta')
  })

  it('keeps the text when a code is unterminated', () => {
    const spans = parseAnsi('a\u001b[3')
    assert.equal(spans.map((span) => span.text).join(''), 'a\u001b[3')
  })

  it('returns nothing for empty input', () => {
    assert.deepEqual(parseAnsi(''), [])
  })
})
