import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { escapeAttribute, formatConsole, formatEvaluated, formatTabs, imageReference, wrapPage } from './tool.js'

describe('escapeAttribute', () => {
  it('makes page text safe inside the envelope attribute', () => {
    assert.equal(escapeAttribute('a "quoted" & <tagged>\nline'), 'a &quot;quoted&quot; &amp; <tagged> line')
  })
})

describe('wrapPage', () => {
  it('marks page-derived text and names the tab', () => {
    assert.equal(wrapPage('main', { url: 'https://example.com/', title: 'Example' }, '- main'), '<page tab="main" url="https://example.com/" title="Example">\n- main\n</page>')
  })

  it('omits empty identity fields', () => {
    assert.equal(wrapPage('docs', { url: '', title: '' }, 'text'), '<page tab="docs">\ntext\n</page>')
  })
})

describe('formatConsole', () => {
  it('says so when nothing was captured', () => {
    assert.equal(formatConsole([]), '(no console output)')
  })

  it('keeps the newest lines and counts what it dropped', () => {
    const entries = Array.from({ length: 45 }, (_, index) => ({ level: 'log', text: `line ${index}`, time: index }))
    const text = formatConsole(entries, 40)
    const lines = text.split('\n')
    assert.equal(lines.length, 41)
    assert.equal(lines[0], '… 5 earlier lines omitted')
    assert.equal(lines.at(-1), '[log] line 44')
  })
})

describe('formatEvaluated', () => {
  it('renders a string result without quotes', () => {
    assert.equal(formatEvaluated('done'), 'done')
  })

  it('renders a structured result as JSON', () => {
    assert.equal(formatEvaluated({ count: 2 }), '{\n  "count": 2\n}')
  })

  it('names empty and undefined results', () => {
    assert.equal(formatEvaluated(undefined), 'undefined')
    assert.equal(formatEvaluated('   '), '(empty result)')
  })

  it('truncates a large result with the remaining size', () => {
    const text = formatEvaluated('y'.repeat(9_000), 100)
    assert.match(text, /^y{100}\n… \(8900 more characters; narrow the expression\)$/u)
  })
})

describe('formatTabs', () => {
  it('marks the addressed tab', () => {
    assert.equal(
      formatTabs(
        [
          { name: 'main', url: 'https://example.com/', title: 'Example' },
          { name: 'docs', url: 'https://docs.example.com/', title: 'Docs' },
        ],
        'main',
      ),
      ['* main — Example — https://example.com/', '  docs — Docs — https://docs.example.com/'].join('\n'),
    )
  })

  it('names an untitled and an unreachable tab', () => {
    assert.equal(formatTabs([{ name: 'main', url: '', title: '' }], 'main'), '* main — (untitled)')
  })

  it('says so when nothing is open', () => {
    assert.equal(formatTabs([], 'main'), '(no open tabs)')
  })
})

describe('imageReference', () => {
  it('rebuilds the branded attachment reference from the result value', () => {
    assert.deepEqual(imageReference({ attachmentId: 'abc', mediaType: 'image/png', bytes: 12, width: 4, height: 3 }), {
      attachmentId: 'abc',
      mediaType: 'image/png',
      bytes: 12,
      width: 4,
      height: 3,
    })
  })
})
