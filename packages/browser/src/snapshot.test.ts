import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { normalizeText, renderAccessibilityTree } from './snapshot.js'
import type { AxNode } from './snapshot.js'

function node(properties: Partial<AxNode> & { nodeId: string }): AxNode {
  return properties
}

const EXAMPLE_PAGE: AxNode[] = [
  node({ nodeId: '1', role: { value: 'RootWebArea' }, name: { value: 'Example Domain' }, childIds: ['2'], backendDOMNodeId: 1 }),
  node({ nodeId: '2', parentId: '1', role: { value: 'main' }, childIds: ['3', '4', '5'] }),
  node({
    nodeId: '3',
    parentId: '2',
    role: { value: 'heading' },
    name: { value: 'Example Domain' },
    properties: [{ name: 'level', value: { value: 1 } }],
    childIds: ['3a'],
  }),
  node({ nodeId: '3a', parentId: '3', role: { value: 'StaticText' }, name: { value: 'Example Domain' } }),
  node({ nodeId: '4', parentId: '2', role: { value: 'paragraph' }, childIds: ['4a'] }),
  node({ nodeId: '4a', parentId: '4', role: { value: 'StaticText' }, name: { value: 'This domain is for use in illustrative examples.' } }),
  node({
    nodeId: '5',
    parentId: '2',
    role: { value: 'link' },
    name: { value: 'More information...' },
    properties: [{ name: 'url', value: { value: 'https://www.iana.org/domains/example' } }],
    backendDOMNodeId: 42,
  }),
]

describe('renderAccessibilityTree', () => {
  it('renders the visible structure as an indented outline', () => {
    const result = renderAccessibilityTree(EXAMPLE_PAGE)
    assert.equal(
      result.text,
      [
        '- main',
        '  - heading "Example Domain" [level=1]',
        '  - "This domain is for use in illustrative examples."',
        '  - link "More information..." [ref=e1] [url=https://www.iana.org/domains/example]',
      ].join('\n'),
    )
    assert.equal(result.lines, 4)
    assert.equal(result.truncated, false)
  })

  it('numbers refs from one and maps them to backend node ids', () => {
    const result = renderAccessibilityTree(EXAMPLE_PAGE)
    assert.deepEqual([...result.refs.entries()], [['e1', 42]])
  })

  it('walks through ignored and transparent nodes without emitting them', () => {
    const result = renderAccessibilityTree([
      node({ nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] }),
      node({ nodeId: '2', parentId: '1', ignored: true, childIds: ['3'] }),
      node({ nodeId: '3', parentId: '2', role: { value: 'button' }, name: { value: 'Save' }, backendDOMNodeId: 7 }),
    ])
    assert.equal(result.text, '- button "Save" [ref=e1]')
  })

  it('gives no ref to an interactive node without a backend node id', () => {
    const result = renderAccessibilityTree([
      node({ nodeId: '1', role: { value: 'button' }, name: { value: 'Ghost' } }),
    ])
    assert.equal(result.text, '- button "Ghost"')
    assert.equal(result.refs.size, 0)
  })

  it('renders state attributes a caller needs before acting', () => {
    const result = renderAccessibilityTree([
      node({ nodeId: '0', role: { value: 'main' }, childIds: ['1', '2'] }),
      node({
        nodeId: '1',
        parentId: '0',
        role: { value: 'checkbox' },
        name: { value: 'Remember me' },
        properties: [{ name: 'checked', value: { value: 'mixed' } }, { name: 'disabled', value: { value: true } }],
        backendDOMNodeId: 3,
      }),
      node({
        nodeId: '2',
        parentId: '0',
        role: { value: 'combobox' },
        name: { value: 'Country' },
        value: { value: 'Thailand' },
        backendDOMNodeId: 4,
      }),
    ])
    assert.equal(
      result.text,
      ['- main', '  - checkbox "Remember me" [ref=e1] [disabled] [checked=mixed]', '  - combobox "Country" [ref=e2] [value="Thailand"]'].join('\n'),
    )
  })

  it('keeps document order through an ignored wrapper', () => {
    const result = renderAccessibilityTree([
      node({ nodeId: '1', role: { value: 'RootWebArea' }, childIds: ['2'] }),
      node({ nodeId: '2', parentId: '1', role: { value: 'none' }, ignored: true, childIds: ['3', '4', '5'] }),
      node({ nodeId: '3', parentId: '2', role: { value: 'heading' }, name: { value: 'Title' }, properties: [{ name: 'level', value: { value: 1 } }] }),
      node({ nodeId: '4', parentId: '2', role: { value: 'StaticText' }, name: { value: 'Lead paragraph' } }),
      node({ nodeId: '5', parentId: '2', role: { value: 'button' }, name: { value: 'Go' }, backendDOMNodeId: 9 }),
    ])
    assert.equal(result.text, ['- heading "Title" [level=1]', '- "Lead paragraph"', '- button "Go" [ref=e1]'].join('\n'))
  })

  it('keeps document order through an unnamed structural wrapper', () => {
    const result = renderAccessibilityTree([
      node({ nodeId: '1', role: { value: 'main' }, childIds: ['2', '3'] }),
      node({ nodeId: '2', parentId: '1', role: { value: 'paragraph' }, childIds: ['4', '5'] }),
      node({ nodeId: '3', parentId: '1', role: { value: 'button' }, name: { value: 'Last' }, backendDOMNodeId: 3 }),
      node({ nodeId: '4', parentId: '2', role: { value: 'StaticText' }, name: { value: 'First' } }),
      node({ nodeId: '5', parentId: '2', role: { value: 'StaticText' }, name: { value: 'Second' } }),
    ])
    assert.equal(result.text, ['- main', '  - "First"', '  - "Second"', '  - button "Last" [ref=e1]'].join('\n'))
  })

  it('drops a text run that only repeats its parent label', () => {
    const result = renderAccessibilityTree([
      node({ nodeId: '1', role: { value: 'link' }, name: { value: 'Docs' }, childIds: ['2'], backendDOMNodeId: 9 }),
      node({ nodeId: '2', parentId: '1', role: { value: 'StaticText' }, name: { value: 'Docs' } }),
    ])
    assert.equal(result.text, '- link "Docs" [ref=e1]')
  })

  it('collapses duplicate adjacent text runs', () => {
    const result = renderAccessibilityTree([
      node({ nodeId: '1', role: { value: 'main' }, childIds: ['2', '3'] }),
      node({ nodeId: '2', parentId: '1', role: { value: 'StaticText' }, name: { value: 'Save changes' } }),
      node({ nodeId: '3', parentId: '1', role: { value: 'StaticText' }, name: { value: 'Save changes' } }),
    ])
    assert.equal(result.text, ['- main', '  - "Save changes"'].join('\n'))
  })

  it('reports an empty page instead of an empty string', () => {
    assert.equal(renderAccessibilityTree([]).text, '(no accessible content)')
    assert.equal(renderAccessibilityTree([node({ nodeId: '1', role: { value: 'WebArea' } })]).text, '(no accessible content)')
  })

  it('stops at the character budget and says so', () => {
    const result = renderAccessibilityTree(EXAMPLE_PAGE, { maxChars: 40 })
    assert.equal(result.truncated, true)
    assert.match(result.text, /outline truncated/u)
    assert.ok(result.text.length < 140, `expected a short outline, got ${result.lines} lines`)
  })

  it('stops at the node budget', () => {
    const many = [node({ nodeId: '1', role: { value: 'main' }, childIds: ['2', '3', '4', '5', '6', '7'] })]
    for (let index = 2; index <= 7; index++) {
      many.push(node({ nodeId: String(index), parentId: '1', role: { value: 'button' }, name: { value: `Button ${index}` }, backendDOMNodeId: index }))
    }
    const result = renderAccessibilityTree(many, { maxNodes: 3 })
    assert.equal(result.truncated, true)
    assert.equal(result.lines, 4)
  })

  it('roots the outline at a scoped backend node', () => {
    const result = renderAccessibilityTree(EXAMPLE_PAGE, { rootBackendNodeId: 42 })
    assert.match(result.text, /^- link "More information\.\.\." \[ref=e1\]/u)
  })

  it('falls back to the first node when the scope node is absent', () => {
    const result = renderAccessibilityTree(EXAMPLE_PAGE, { rootBackendNodeId: 999 })
    assert.match(result.text, /- main/u)
  })
})

describe('normalizeText', () => {
  it('collapses whitespace and caps long runs', () => {
    assert.equal(normalizeText('  Sign\n  in\tnow '), 'Sign in now')
    assert.equal(normalizeText('x'.repeat(300)).length, 160)
    assert.ok(normalizeText('x'.repeat(300)).endsWith('…'))
  })
})
