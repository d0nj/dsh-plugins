import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  REASONING_FACTORY,
  assistantStatus,
  blocksOf,
  createAssistantNarration,
  textOfBlocks,
  toLiveCalls,
} from './assistant.js'
import type { ReactApi } from './assistant.js'

interface Element {
  readonly type: unknown
  readonly props: Record<string, unknown>
  readonly children: readonly unknown[]
}

function fakeReact(): ReactApi {
  const createElement = (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]): unknown => ({
    type,
    props: props ?? {},
    children,
  })
  return {
    createElement,
    useState: <T,>(initial: T | (() => T)) => {
      const value = typeof initial === 'function' ? (initial as () => T)() : initial
      return [value, () => {}] as [T, (next: T | ((prev: T) => T)) => void]
    },
    useEffect: () => {},
    useRef: <T,>(initial: T) => ({ current: initial }),
  } as ReactApi
}

function isElement(value: unknown): value is Element {
  return value !== null && typeof value === 'object' && 'type' in value && 'children' in value
}

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (!isElement(node)) return ''
  return node.children.map(textOf).join('')
}

function classesOf(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(classesOf)
  if (!isElement(node)) return []
  const own = typeof node.props.className === 'string' ? [node.props.className] : []
  return own.concat(...node.children.map(classesOf))
}

function countClass(node: unknown, name: string): number {
  return classesOf(node).filter((value) => value.split(' ').includes(name)).length
}

function findClass(node: unknown, name: string): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findClass(child, name)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (!isElement(node)) return undefined
  const own = typeof node.props.className === 'string' ? node.props.className.split(' ') : []
  if (own.includes(name)) return node
  for (const child of node.children) {
    const found = findClass(child, name)
    if (found !== undefined) return found
  }
  return undefined
}

function argReader(values: Record<string, string>): { text(key: string): string | undefined } {
  return { text: (key: string) => values[key] }
}

function node(blocks: readonly unknown[], status: string): unknown {
  return { data: { status, blocks } }
}

const narration = createAssistantNarration(fakeReact())

function render(props: Parameters<typeof narration>[0]): unknown {
  return narration(props)
}

const emptyChat = (select: (snapshot: unknown) => unknown): unknown =>
  select({ legacy: { runningCalls: [] } })

const idle = {
  node: node([], 'settled'),
  useChat: emptyChat,
}

function running(calls: readonly unknown[] = []): Pick<Parameters<typeof narration>[0], 'useChat'> {
  return { useChat: (select) => select({ legacy: { runningCalls: calls } }) }
}

describe('assistantStatus', () => {
  it('reads the Chat node status and defaults to settled', () => {
    assert.equal(assistantStatus(node([], 'running')), 'running')
    assert.equal(assistantStatus(node([], 'interrupted')), 'interrupted')
    assert.equal(assistantStatus(node([], 'settled')), 'settled')
    assert.equal(assistantStatus(undefined), 'settled')
    assert.equal(assistantStatus({ data: null }), 'settled')
  })
})

describe('blocksOf / textOfBlocks', () => {
  it('joins the blocks of one kind and ignores the rest', () => {
    const blocks = blocksOf(node([
      { kind: 'reasoning', text: 'a' },
      { kind: 'text', text: 'b' },
      { kind: 'reasoning', text: 'c' },
      { kind: 'tool-call', callId: 'x' },
    ], 'running'))
    assert.equal(textOfBlocks(blocks, 'reasoning'), 'ac')
    assert.equal(textOfBlocks(blocks, 'text'), 'b')
  })

  it('tolerates a node without blocks', () => {
    assert.deepEqual(blocksOf({ data: {} }), [])
    assert.deepEqual(blocksOf(null), [])
  })
})

describe('toLiveCalls', () => {
  it('keeps preparing and dispatched calls and drops malformed rows', () => {
    const calls = toLiveCalls([
      { callId: 'a', name: 'read', phase: 'preparing', time: 7, args: argReader({ file_path: 'a.ts' }) },
      { callId: 'b', name: 'bash', phase: 'start', time: 8, args: argReader({}) },
      { callId: 'c' },
      null,
    ])
    assert.equal(calls.length, 2)
    assert.equal(calls[0]?.phase, 'preparing')
    assert.equal(calls[1]?.phase, 'start')
  })
})

describe('AssistantNarration', () => {
  it('renders nothing for an empty settled step', () => {
    assert.equal(render(idle), null)
  })

  it('keeps the answer Markdown by delegating to the reasoning content factory', () => {
    const calls: { id: string; input: unknown }[] = []
    const tree = render({
      ...idle,
      node: node([{ kind: 'text', text: 'Here is the fix.' }], 'settled'),
      renderFactorySlot: (id: string, input: unknown) => {
        calls.push({ id, input })
        return { type: 'markdown', props: {}, children: ['Here is the fix.'] }
      },
    })
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.id, REASONING_FACTORY)
    assert.deepEqual(calls[0]?.input, { text: 'Here is the fix.', running: false })
    assert.ok(textOf(tree).includes('Here is the fix.'))
    assert.equal(countClass(tree, 'd0nj-narr-answer'), 1)
  })

  it('falls back to plain text when no factory is supplied', () => {
    const tree = render({
      ...idle,
      node: node([{ kind: 'text', text: 'plain answer' }], 'settled'),
    })
    assert.equal(countClass(tree, 'd0nj-narr-plain'), 1)
    assert.ok(textOf(tree).includes('plain answer'))
  })

  it('shows the live phase and the calls only while this step streams', () => {
    const tree = render({
      node: node([{ kind: 'reasoning', text: 'Checking the router.' }], 'running'),
      ...running([
        { callId: 'a', name: 'read', phase: 'preparing', time: Date.now(), args: argReader({ file_path: 'packages/core/src/server.rs' }) },
        { callId: 'b', name: 'grep', phase: 'start', time: Date.now(), args: argReader({ pattern: 'dispatch' }) },
      ]),
    })
    const text = textOf(tree)
    assert.ok(text.includes('Acting'), 'expected the acting phase, got: ' + text)
    assert.ok(text.includes('2 calls'), 'expected the parallel count, got: ' + text)
    assert.ok(text.includes('Reading'), 'expected the first call verb, got: ' + text)
    assert.ok(text.includes('server.rs'), 'expected the prepared target, got: ' + text)
    assert.ok(text.includes('Checking the router.'), 'expected the live reasoning, got: ' + text)
  })

  it('never repeats the live header or the roster on a settled step', () => {
    const tree = render({
      ...idle,
      node: node([{ kind: 'reasoning', text: 'Old thought.' }], 'settled'),
      ...running([
        { callId: 'a', name: 'read', phase: 'start', time: Date.now(), args: argReader({ file_path: 'a.ts' }) },
      ]),
    })
    assert.equal(countClass(tree, 'd0nj-narr-live'), 0, 'a settled step has no live header')
    assert.equal(countClass(tree, 'd0nj-narr-calls'), 0, 'a settled step has no roster')
  })

  it('keeps reasoning expanded by default in both states', () => {
    const streaming = render({
      node: node([{ kind: 'reasoning', text: 'Live thought.' }], 'running'),
      ...running(),
    })
    assert.ok(textOf(streaming).includes('Live thought.'), 'streaming reasoning must be visible')

    const settled = render({
      ...idle,
      node: node([{ kind: 'reasoning', text: 'Old thought.' }], 'settled'),
    })
    assert.ok(textOf(settled).includes('Old thought.'), 'settled reasoning stays open by default')
  })

  it('renders only its own part when the grouping splits one node into two rows', () => {
    const split = node([
      { kind: 'reasoning', text: 'private thought' },
      { kind: 'text', text: 'public answer' },
    ], 'settled')

    const reasoningPart = render({ ...idle, node: split, groupPart: 'reasoning' })
    assert.ok(textOf(reasoningPart).includes('private thought'))
    assert.ok(!textOf(reasoningPart).includes('public answer'), 'the reasoning row must not repeat the reply')

    const responsePart = render({ ...idle, node: split, groupPart: 'response' })
    assert.ok(textOf(responsePart).includes('public answer'))
    assert.ok(!textOf(responsePart).includes('private thought'), 'the reply row must not repeat the reasoning')
  })

  it('renders the whole step when no grouping is applied', () => {
    const tree = render({
      ...idle,
      node: node([
        { kind: 'reasoning', text: 'private thought' },
        { kind: 'text', text: 'public answer' },
      ], 'settled'),
    })
    assert.ok(textOf(tree).includes('private thought'))
    assert.ok(textOf(tree).includes('public answer'))
  })

  it('offers a collapse control in both states', () => {
    const streaming = render({
      node: node([{ kind: 'reasoning', text: 'Live thought.' }], 'running'),
      ...running(),
    })
    const header = findClass(streaming, 'd0nj-narr-live')
    assert.equal(header?.type, 'button')
    assert.equal(header?.props['aria-expanded'], true)

    const settled = render({
      ...idle,
      node: node([{ kind: 'reasoning', text: 'Old thought.' }], 'settled'),
    })
    const head = findClass(settled, 'd0nj-narr-think-head')
    assert.equal(head?.type, 'button')
    assert.equal(head?.props['aria-expanded'], true)
  })

  it('keeps telemetry coming before the first token', () => {
    const tree = render({ node: node([], 'running'), ...running() })
    const text = textOf(tree)
    assert.ok(text.includes('Working'), 'expected the pre-token phase, got: ' + text)
    assert.ok(text.includes('0.0s'), 'expected an elapsed clock, got: ' + text)
  })

  it('names an empty preparing argument instead of leaving a floating caret', () => {
    const tree = render({
      node: node([], 'running'),
      ...running([
        { callId: 'a', name: 'read', phase: 'preparing', time: Date.now(), args: argReader({}) },
      ]),
    })
    assert.ok(textOf(tree).includes('composing'), 'expected the placeholder, got: ' + textOf(tree))
  })

  it('survives a node with no data at all', () => {
    const tree = render({ node: { data: { status: 'running' } }, ...running() })
    assert.ok(textOf(tree).includes('Working'))
  })
})
