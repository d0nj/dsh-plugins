import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  argsSummary,
  commandOf,
  createToolNarration,
  fileDiffOf,
  liveCallOf,
  patchTextOf,
  tailPreview,
  toolArgsText,
  toolDuration,
  toolOutputText,
  toolPhase,
  toolRoot,
} from './tool.js'
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

function nodeOf(root: unknown): unknown {
  return { data: { root } }
}

const preparing = {
  callId: 'call-1',
  name: 'edit',
  phase: 'preparing',
  time: 1000,
  args: {
    keys: () => ['file_path', 'old_string'],
    text: (key: string) => (key === 'file_path' ? 'packages/core/src/server.rs' : undefined),
  },
}

const started = {
  callId: 'call-2',
  name: 'pwsh',
  phase: 'start',
  time: 1000,
  callTime: 900,
  argsRaw: '{"command":"pnpm test --filter core"}',
  args: { keys: () => [], text: () => undefined },
}

const result = {
  kind: 'tool-result',
  callId: 'call-2',
  name: 'pwsh',
  time: 4200,
  callTime: 1000,
  call: { name: 'pwsh', argsRaw: '{"command":"pnpm test"}' },
  args: { keys: () => [], text: () => undefined },
  content: [
    { type: 'text', text: 'stdout line one\n' },
    { type: 'text', text: 'stdout line two' },
  ],
  isError: false,
  subCalls: [],
}

const failed = {
  kind: 'tool-result',
  callId: 'call-3',
  name: 'pwsh',
  time: 2000,
  callTime: 1000,
  call: null,
  args: { keys: () => [], text: () => undefined },
  content: [{ type: 'text', text: 'boom' }],
  isError: true,
  error: { name: 'Error', code: 'E_FAIL', reason: 'command exited 1' },
  subCalls: [],
}

const narration = createToolNarration(fakeReact())

describe('toolPhase', () => {
  it('distinguishes the three stages by shape', () => {
    assert.equal(toolPhase(preparing), 'preparing')
    assert.equal(toolPhase(started), 'start')
    assert.equal(toolPhase(result), 'result')
    assert.equal(toolPhase(undefined), 'result')
  })
})

describe('toolRoot', () => {
  it('reads the root block from the node payload', () => {
    assert.equal(toolRoot(nodeOf(result)), result)
    assert.equal(toolRoot({ data: {} }), undefined)
    assert.equal(toolRoot(null), undefined)
  })
})

describe('liveCallOf', () => {
  it('lets the narration read a partial argument while preparing', () => {
    const call = liveCallOf(preparing)
    assert.equal(call?.phase, 'preparing')
    assert.equal(call?.args.text('file_path'), 'packages/core/src/server.rs')
  })

  it('reports a result as dispatched so its arguments read as complete', () => {
    assert.equal(liveCallOf(result)?.phase, 'start')
  })

  it('refuses a block without identity', () => {
    assert.equal(liveCallOf({ name: 'read' }), undefined)
  })
})

describe('toolArgsText', () => {
  it('pretty prints the raw JSON of a dispatched call', () => {
    assert.equal(toolArgsText(started), '{\n  "command": "pnpm test --filter core"\n}')
  })

  it('falls back to the readable partial arguments', () => {
    assert.equal(toolArgsText(preparing), 'file_path: packages/core/src/server.rs')
  })

  it('keeps an unparseable raw string as it is', () => {
    assert.equal(toolArgsText({ phase: 'start', argsRaw: '{not json' }), '{not json')
  })
})

describe('toolOutputText', () => {
  it('joins every text block in order', () => {
    assert.equal(toolOutputText(result).output, 'stdout line one\nstdout line two')
  })

  it('keeps the failure reason and flags the error', () => {
    const read = toolOutputText(failed)
    assert.equal(read.isError, true)
    assert.ok(read.output.includes('boom'))
    assert.ok(read.output.includes('command exited 1'))
  })
})

describe('toolDuration', () => {
  it('measures a settled call between dispatch and result', () => {
    assert.equal(toolDuration(result, 99_999), 3200)
  })

  it('counts up while the call is still running', () => {
    assert.equal(toolDuration(started, 1500), 600)
  })
})

describe('fileDiffOf', () => {
  it('builds a diff for an edit call', () => {
    const view = fileDiffOf('edit', { file_path: 'a.ts', old_string: 'x', new_string: 'y' })
    assert.equal(view?.path, 'a.ts')
    assert.equal(view?.before, 'x')
    assert.equal(view?.after, 'y')
  })

  it('treats a write as a full addition', () => {
    const view = fileDiffOf('write', { file_path: 'new.ts', content: 'line' })
    assert.equal(view?.before, '')
    assert.equal(view?.after, 'line')
  })

  it('ignores a call without both sides', () => {
    assert.equal(fileDiffOf('edit', { file_path: 'a.ts' }), undefined)
    assert.equal(fileDiffOf('read', { file_path: 'a.ts' }), undefined)
    assert.equal(fileDiffOf('edit', undefined), undefined)
  })
})

describe('tailPreview', () => {
  it('keeps a short output whole', () => {
    assert.deepEqual(tailPreview('a\nb', 5), { shown: 'a\nb', hidden: 0 })
  })

  it('keeps the tail and counts what it hid', () => {
    const preview = tailPreview('a\nb\nc\nd', 2)
    assert.equal(preview.shown, 'c\nd')
    assert.equal(preview.hidden, 2)
  })

  it('reports an empty output', () => {
    assert.deepEqual(tailPreview(''), { shown: '', hidden: 0 })
  })
})

describe('commandOf / patchTextOf', () => {
  it('extracts a shell command for the shell tools only', () => {
    assert.equal(commandOf('pwsh', { command: 'ls' }), 'ls')
    assert.equal(commandOf('bash', { command: 'ls' }), 'ls')
    assert.equal(commandOf('read', { command: 'ls' }), undefined)
  })

  it('extracts a unified patch', () => {
    assert.equal(patchTextOf('apply_patch', { patch: '*** Begin Patch' }), '*** Begin Patch')
    assert.equal(patchTextOf('edit', { patch: 'x' }), undefined)
  })
})

describe('argsSummary', () => {
  it('keeps the secondary arguments and drops the ones the header shows', () => {
    const summary = argsSummary({ file_path: 'a.ts', limit: 18, offset: 86 })
    assert.equal(summary, 'limit 18 \u00b7 offset 86')
  })

  it('describes arrays and objects without dumping them', () => {
    assert.equal(argsSummary({ paths: ['a', 'b'], options: { deep: true } }), 'paths 2 items \u00b7 options {"deep":true}')
  })

  it('is empty when every argument is already in the header', () => {
    assert.equal(argsSummary({ command: 'ls', description: 'list' }), '')
  })

  it('is empty without arguments', () => {
    assert.equal(argsSummary(undefined), '')
  })
})

describe('ToolNarration', () => {
  it('shows the target as the arguments are still being written', () => {
    const tree = narration({ node: nodeOf(preparing) })
    const text = textOf(tree)
    assert.ok(text.includes('Editing'), 'expected the verb, got: ' + text)
    assert.ok(text.includes('server.rs'), 'expected the target, got: ' + text)
    assert.ok(text.includes('preparing'), 'expected the stage, got: ' + text)
  })

  it('renders a shell command as a command line, not as JSON', () => {
    const tree = narration({ node: nodeOf(result) })
    const text = textOf(tree)
    assert.ok(text.includes('pnpm test'), 'expected the command, got: ' + text)
    assert.ok(text.includes('stdout line one'), 'expected the output, got: ' + text)
    assert.equal(countClass(tree, 'd0nj-tool-args'), 0, 'a shell call must not dump its JSON arguments')
  })

  it('renders an edit as a diff instead of raw arguments', () => {
    const edit = {
      kind: 'tool-result',
      callId: 'call-9',
      name: 'edit',
      time: 2000,
      callTime: 1000,
      call: {
        name: 'edit',
        argsRaw: JSON.stringify({
          file_path: 'packages/core/src/server.rs',
          old_string: 'let a = 1;\nlet b = 2;',
          new_string: 'let a = 1;\nlet b = 3;',
        }),
      },
      args: { keys: () => [], text: () => undefined },
      content: [],
      isError: false,
      subCalls: [],
    }
    const tree = narration({ node: nodeOf(edit) })
    const text = textOf(tree)
    assert.equal(countClass(tree, 'd0nj-diff'), 1, 'expected a diff block')
    assert.equal(countClass(tree, 'd0nj-tool-args'), 0, 'the diff replaces the JSON arguments')
    assert.ok(text.includes('let b = 2;'), 'expected the removed line, got: ' + text)
    assert.ok(text.includes('let b = 3;'), 'expected the added line, got: ' + text)
    assert.ok(text.includes('+1 \u22121'), 'expected the change stat, got: ' + text)
  })

  it('drops the redundant success message of a file edit', () => {
    const edit = {
      kind: 'tool-result',
      callId: 'call-10',
      name: 'edit',
      time: 2000,
      callTime: 1000,
      call: {
        name: 'edit',
        argsRaw: JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'y' }),
      },
      args: { keys: () => [], text: () => undefined },
      content: [{ type: 'text', text: 'The file a.ts has been updated successfully.' }],
      isError: false,
      subCalls: [],
    }
    const tree = narration({ node: nodeOf(edit) })
    assert.ok(!textOf(tree).includes('has been updated successfully'), 'the diff already says it worked')
    assert.equal(countClass(tree, 'd0nj-tool-output'), 0)
    assert.equal(countClass(tree, 'd0nj-diff'), 1)
  })

  it('still shows the output text when a file edit fails', () => {
    const edit = {
      kind: 'tool-result',
      callId: 'call-11',
      name: 'edit',
      time: 2000,
      callTime: 1000,
      call: {
        name: 'edit',
        argsRaw: JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'y' }),
      },
      args: { keys: () => [], text: () => undefined },
      content: [{ type: 'text', text: 'old_string was not found' }],
      isError: true,
      subCalls: [],
    }
    const tree = narration({ node: nodeOf(edit) })
    assert.ok(textOf(tree).includes('old_string was not found'))
    assert.equal(countClass(tree, 'd0nj-tool-output'), 1)
  })

  it('numbers the diff gutter like a patch viewer', () => {
    const lines = narration({ node: nodeOf({
      kind: 'tool-result',
      callId: 'call-12',
      name: 'edit',
      time: 2000,
      callTime: 1000,
      call: {
        name: 'edit',
        argsRaw: JSON.stringify({
          file_path: 'a.ts',
          old_string: 'one\ntwo\nthree',
          new_string: 'one\nTWO\nthree',
        }),
      },
      args: { keys: () => [], text: () => undefined },
      content: [],
      isError: false,
      subCalls: [],
    }) })
    assert.equal(countClass(lines, 'd0nj-diff-no') > 0, true, 'expected a line-number gutter')
    assert.equal(countClass(lines, 'd0nj-diff-bar') > 0, true, 'expected the gutter separator')
    assert.ok(textOf(lines).includes('\u2502'), 'expected the gutter bar')
  })

  it('keeps a long output to its tail until expanded', () => {
    const body = Array.from({ length: 40 }, (_value, index) => 'line ' + String(index)).join('\n')
    const run = {
      kind: 'tool-result',
      callId: 'call-13',
      name: 'pwsh',
      time: 2000,
      callTime: 1000,
      call: { name: 'pwsh', argsRaw: JSON.stringify({ command: 'run' }) },
      args: { keys: () => [], text: () => undefined },
      content: [{ type: 'text', text: body }],
      isError: false,
      subCalls: [],
    }
    const tree = narration({ node: nodeOf(run) })
    const text = textOf(tree)
    assert.ok(text.includes('\u2026 28 earlier lines'), 'expected the hidden-line marker, got: ' + text.slice(0, 200))
    assert.ok(!text.includes('line 0'), 'the head of the output stays hidden')
    assert.ok(text.includes('line 39'), 'the tail of the output is visible')
    assert.equal(countClass(tree, 'd0nj-tool-more'), 1)
  })

  it('prints a shell command once, in the command block only', () => {
    const tree = narration({ node: nodeOf(result) })
    const text = textOf(tree)
    const occurrences = text.split('pnpm test').length - 1
    assert.equal(occurrences, 1, 'the header must not repeat the command')
  })

  it('collapses blank runs so the tail is never an empty block', () => {
    const body = ['first', '', '', '', 'second', '', '', '', 'third'].join('\n')
    const run = {
      kind: 'tool-result',
      callId: 'call-14',
      name: 'pwsh',
      time: 2000,
      callTime: 1000,
      call: { name: 'pwsh', argsRaw: JSON.stringify({ command: 'git diff' }) },
      args: { keys: () => [], text: () => undefined },
      content: [{ type: 'text', text: body }],
      isError: false,
      subCalls: [],
    }
    const text = textOf(narration({ node: nodeOf(run) }))
    assert.ok(!text.includes('\n\n\n'), 'consecutive blank lines must be collapsed')
    assert.ok(text.includes('first'))
    assert.ok(text.includes('third'))
  })

  it('shows a read as one metadata line plus clean content', () => {
    const read = {
      kind: 'tool-result',
      callId: 'call-15',
      name: 'read',
      time: 2000,
      callTime: 1000,
      call: {
        name: 'read',
        argsRaw: JSON.stringify({ file_path: 'packages/ui-custom/src/client/panel.ts', limit: 18, offset: 86 }),
      },
      args: { keys: () => [], text: () => undefined },
      content: [{ type: 'text', text: '<content>\n95:\n96: /** Shared inline styles. */\n</content>' }],
      isError: false,
      subCalls: [],
    }
    const tree = narration({ node: nodeOf(read) })
    const text = textOf(tree)
    assert.equal(countClass(tree, 'd0nj-tool-meta'), 1, 'expected the one-line argument summary')
    assert.equal(countClass(tree, 'd0nj-tool-args'), 0, 'no JSON argument block')
    assert.ok(!text.includes('"file_path"'), 'the path is not repeated as JSON')
    assert.ok(text.includes('offset 86'), 'the secondary arguments survive')
    assert.ok(!text.includes('</content>'), 'the model-facing envelope is stripped')
    assert.ok(text.includes('96: /** Shared inline styles. */'), 'the content is untouched')
  })

  it('marks a failed call', () => {
    const tree = narration({ node: nodeOf(failed) })
    assert.equal(countClass(tree, 'd0nj-tool'), 1)
    assert.ok(textOf(tree).includes('failed'))
  })

  it('renders nested calls', () => {
    const tree = narration({ node: nodeOf({ ...result, subCalls: [preparing] }) })
    assert.ok(textOf(tree).includes('Editing'))
    assert.equal(countClass(tree, 'd0nj-tool-sub'), 1)
  })

  it('renders nothing without a root block', () => {
    assert.equal(narration({ node: { data: {} } }), null)
  })
})
