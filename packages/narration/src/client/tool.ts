import { compactOutput, normalizeTerminalText, parseAnsi } from '../ansi.js'
import { stripEnvelope, splitReadRange } from '../envelope.js'
import { diffLines, diffRows, diffSummary } from '../diff.js'
import { TOOL_NARRATION, clip, formatElapsed, narrateCall, splitPath } from '../live.js'
import type { LiveCall } from '../live.js'
import type { ReactApi } from './assistant.js'

type Block = Record<string, unknown>

export interface EditView {
  readonly path: string
  readonly before: string
  readonly after: string
}

export interface OutputPreview {
  readonly shown: string
  readonly hidden: number
}

const PREVIEW_LINES = 12

interface RenderOptions {
  readonly expanded: boolean
  readonly onToggle: () => void
  readonly pin: { current: boolean }
}

function followProps(options: RenderOptions | undefined): Record<string, unknown> {
  if (options === undefined) return {}
  const pin = options.pin
  return {
    ref: (element: HTMLElement | null) => {
      if (element !== null && pin.current) element.scrollTop = element.scrollHeight
    },
    onScroll: (event: { currentTarget: HTMLElement }) => {
      const element = event.currentTarget
      pin.current = element.scrollHeight - element.scrollTop - element.clientHeight < 12
    },
  }
}

function asBlock(value: unknown): Block | undefined {
  return value !== null && typeof value === 'object' ? (value as Block) : undefined
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function maybeText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function list(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

export function toolRoot(node: unknown): Block | undefined {
  const data = asBlock(asBlock(node)?.data)
  return asBlock(data?.root)
}

export function toolName(block: unknown): string {
  return text(asBlock(block)?.name)
}

export function toolPhase(block: unknown): 'preparing' | 'start' | 'result' {
  const entry = asBlock(block)
  if (entry === undefined || entry.kind !== undefined) return 'result'
  return entry.phase === 'preparing' ? 'preparing' : 'start'
}

function argsReader(source: unknown): LiveCall['args'] {
  const args = asBlock(source)
  const read = args?.text
  if (typeof read !== 'function') return { text: () => undefined }
  return {
    text: (key: string) => {
      try {
        const value = (read as (this: unknown, name: string) => unknown).call(args, key)
        return typeof value === 'string' ? value : undefined
      } catch {
        return undefined
      }
    },
  }
}

function rawArgs(block: Block): string {
  const call = asBlock(block.call)
  const fromCall = text(call?.argsRaw)
  return fromCall.length > 0 ? fromCall : text(block.argsRaw)
}

export function parsedArgs(block: unknown): Record<string, unknown> | undefined {
  const entry = asBlock(block)
  if (entry === undefined) return undefined
  const raw = rawArgs(entry)
  if (raw.length > 0) {
    try {
      return asBlock(JSON.parse(raw))
    } catch {
      return undefined
    }
  }
  const args = entry.args
  const keys = asBlock(args)?.keys
  const names = typeof keys === 'function' ? (keys as (this: unknown) => unknown).call(args) : []
  const reader = argsReader(args)
  const out: Record<string, unknown> = {}
  let found = false
  for (const key of list(names)) {
    if (typeof key !== 'string') continue
    const value = reader.text(key)
    if (value === undefined) continue
    out[key] = value
    found = true
  }
  return found ? out : undefined
}

export function liveCallOf(block: unknown): LiveCall | undefined {
  const entry = asBlock(block)
  if (entry === undefined) return undefined
  const callId = text(entry.callId)
  const name = text(entry.name)
  if (callId.length === 0 || name.length === 0) return undefined
  return {
    callId,
    name,
    phase: toolPhase(entry) === 'preparing' ? 'preparing' : 'start',
    time: typeof entry.time === 'number' ? entry.time : 0,
    args: argsReader(entry.args),
  }
}

export function fileDiffOf(name: string, args: Record<string, unknown> | undefined): EditView | undefined {
  if (args === undefined) return undefined
  const path = maybeText(args.file_path) ?? maybeText(args.path) ?? ''
  if (name === 'edit') {
    const before = maybeText(args.old_string)
    const after = maybeText(args.new_string)
    if (before === undefined || after === undefined) return undefined
    return { path, before, after }
  }
  if (name === 'write') {
    const after = maybeText(args.content)
    if (after === undefined) return undefined
    return { path, before: '', after }
  }
  return undefined
}

export function patchTextOf(name: string, args: Record<string, unknown> | undefined): string | undefined {
  if (name !== 'apply_patch' || args === undefined) return undefined
  return maybeText(args.patch) ?? maybeText(args.input) ?? maybeText(args.diff)
}

export function commandOf(name: string, args: Record<string, unknown> | undefined): string | undefined {
  if ((name !== 'bash' && name !== 'pwsh') || args === undefined) return undefined
  return maybeText(args.command)
}

function prettyJson(raw: string): string {
  if (raw.length === 0) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function toolArgsText(block: unknown): string {
  const entry = asBlock(block)
  if (entry === undefined) return ''
  const raw = rawArgs(entry)
  if (raw.length > 0) return prettyJson(raw)
  const args = entry.args
  const keys = asBlock(args)?.keys
  const names = typeof keys === 'function' ? (keys as (this: unknown) => unknown).call(args) : []
  const reader = argsReader(args)
  const lines: string[] = []
  for (const key of list(names)) {
    if (typeof key !== 'string') continue
    const value = reader.text(key)
    if (value === undefined || value.length === 0) continue
    lines.push(key + ': ' + value)
  }
  return lines.join('\n')
}

export function toolOutputText(block: unknown): { output: string; isError: boolean } {
  const entry = asBlock(block)
  if (entry === undefined) return { output: '', isError: false }
  let output = ''
  for (const part of list(entry.content)) {
    const item = asBlock(part)
    if (item === undefined || item.type !== 'text') continue
    output += text(item.text)
  }
  const isError = entry.isError === true
  const error = asBlock(entry.error)
  const reason = text(error?.reason).length > 0 ? text(error?.reason) : text(error?.code)
  if (isError && reason.length > 0 && !output.includes(reason)) {
    output = output.length > 0 ? output + '\n' + reason : reason
  }
  return { output: output.trimEnd(), isError }
}

export function tailPreview(source: string, limit = PREVIEW_LINES): OutputPreview {
  if (source.length === 0) return { shown: '', hidden: 0 }
  const lines = source.split('\n')
  if (lines.length <= limit) return { shown: source, hidden: 0 }
  return { shown: lines.slice(lines.length - limit).join('\n'), hidden: lines.length - limit }
}

const HEADER_KEYS = new Set([
  'command', 'content', 'description', 'diff', 'file_path', 'input', 'name',
  'new_string', 'old_string', 'patch', 'path', 'pattern', 'prompt', 'query', 'url',
])

function describeValue(value: unknown): string {
  if (typeof value === 'string') return clip(value, 48)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return String(value.length) + ' items'
  if (value === null || value === undefined) return ''
  return clip(JSON.stringify(value), 48)
}

export function argsSummary(args: Record<string, unknown> | undefined, limit = 6): string {
  if (args === undefined) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(args)) {
    if (HEADER_KEYS.has(key)) continue
    const described = describeValue(value)
    if (described.length === 0) continue
    parts.push(key + ' ' + described)
    if (parts.length >= limit) break
  }
  return parts.join(' \u00b7 ')
}

export function toolDuration(block: unknown, now: number): number {
  const entry = asBlock(block)
  if (entry === undefined) return 0
  const finished = typeof entry.time === 'number' ? entry.time : 0
  const started = typeof entry.callTime === 'number' ? entry.callTime : 0
  if (toolPhase(entry) === 'result') return started > 0 && finished > started ? finished - started : 0
  return started > 0 ? Math.max(0, now - started) : 0
}

const STATE_LABEL: Readonly<Record<string, string>> = {
  preparing: 'preparing',
  start: 'running',
  result: 'done',
}

function renderDiffCard(
  React: ReactApi,
  before: string,
  after: string,
  options: RenderOptions | undefined,
): unknown {
  const h = React.createElement
  const lines = diffLines(before, after)
  const summary = diffSummary(lines)
  const { rows } = diffRows(lines)
  return h(
    'pre',
    {
      className: 'd0nj-diff',
      'data-added': String(summary.added),
      'data-removed': String(summary.removed),
      ...followProps(options),
    },
    rows.map((row, index) =>
      h(
        'span',
        { key: String(index), className: 'd0nj-diff-line', 'data-kind': row.kind },
        row.kind === 'hunk'
          ? row.text
          : [
              h('span', { key: 's', className: 'd0nj-diff-sign' }, row.sign),
              h('span', { key: 'n', className: 'd0nj-diff-no' }, row.number.padStart(row.digits)),
              h('span', { key: 'b', className: 'd0nj-diff-bar' }, '\u2502'),
              h('span', { key: 't', className: 'd0nj-diff-text' }, row.text),
            ],
      ),
    ),
  )
}

function renderPatchCard(React: ReactApi, patch: string, options: RenderOptions | undefined): unknown {
  const h = React.createElement
  return h(
    'pre',
    { className: 'd0nj-diff', ...followProps(options) },
    patch.split('\n').map((line, index) =>
      h(
        'span',
        {
          key: String(index),
          className: 'd0nj-diff-line',
          'data-kind': line.startsWith('+') ? 'add' : line.startsWith('-') ? 'remove' : 'equal',
        },
        line,
      ),
    ),
  )
}

function renderTerminal(React: ReactApi, text: string): unknown {
  const h = React.createElement
  return parseAnsi(text).map((span, index) =>
    h(
      'span',
      {
        key: String(index),
        className: 'd0nj-term',
        'data-tone': span.tone,
        'data-bold': span.bold ? 'true' : undefined,
        'data-dim': span.dim ? 'true' : undefined,
        'data-underline': span.underline ? 'true' : undefined,
      },
      span.text,
    ),
  )
}

function renderOutput(
  React: ReactApi,
  output: string,
  options: RenderOptions | undefined,
): unknown {
  const h = React.createElement
  if (output.length === 0) return null
  const follow = followProps(options)
  const preview = tailPreview(output, PREVIEW_LINES)
  if (options === undefined || preview.hidden === 0) {
    return h('pre', { className: 'd0nj-tool-output', ...follow }, renderTerminal(React, output))
  }
  return h(
    'div',
    { className: 'd0nj-tool-out-wrap' },
    h(
      'button',
      {
        type: 'button',
        className: 'd0nj-tool-more',
        'aria-expanded': options.expanded,
        onClick: options.onToggle,
      },
      options.expanded ? 'collapse' : '\u2026 ' + String(preview.hidden) + ' earlier lines',
    ),
    h('pre', { className: 'd0nj-tool-output', ...follow }, renderTerminal(React, options.expanded ? output : preview.shown)),
  )
}

export function cleanOutput(output: string): { body: string; range: string | null } {
  const cleaned = compactOutput(normalizeTerminalText(stripEnvelope(output)))
  const split = splitReadRange(cleaned)
  return { body: split.text, range: split.range }
}

function renderBlock(
  React: ReactApi,
  block: unknown,
  now: number,
  depth: number,
  options: RenderOptions | undefined,
): unknown {
  const h = React.createElement
  const entry = asBlock(block)
  if (entry === undefined || depth > 4) return null

  const phase = toolPhase(entry)
  const name = toolName(entry)
  const call = liveCallOf(entry)
  const narration = call === undefined ? undefined : narrateCall(call, 240)
  const args = parsedArgs(entry)
  const { output, isError } = toolOutputText(entry)
  const spent = toolDuration(entry, now)
  const state = phase === 'result' ? (isError ? 'failed' : 'done') : STATE_LABEL[phase] ?? ''
  const stateKey = isError ? 'failed' : phase === 'result' ? 'done' : phase
  const glyph =
    stateKey === 'failed'
      ? '\u2715'
      : stateKey === 'done'
        ? '\u2713'
        : stateKey === 'start'
          ? '\u25d0'
          : '\u25cb'
  const subCalls = list(entry.subCalls)

  const editView = fileDiffOf(name, args)
  const patch = patchTextOf(name, args)
  const hasFileView = editView !== undefined || patch !== undefined
  const command = commandOf(name, args)
  const parts = splitPath(command === undefined ? narration?.argument ?? '' : '')
  const known = TOOL_NARRATION[name] !== undefined
  const extras = known ? argsSummary(args) : ''
  const argsText = known ? '' : toolArgsText(entry)
  const cleaned = cleanOutput(output)
  const meta = [extras, cleaned.range ?? ''].filter((part) => part.length > 0).join(' \u00b7 ')
  const showOutput = cleaned.body.length > 0 && (!hasFileView || isError)

  const stat =
    editView === undefined
      ? ''
      : (() => {
          const summary = diffSummary(diffLines(editView.before, editView.after))
          return '+' + String(summary.added) + ' \u2212' + String(summary.removed)
        })()

  const body =
    editView !== undefined
      ? renderDiffCard(React, editView.before, editView.after, options)
      : patch !== undefined
        ? renderPatchCard(React, patch, options)
        : command !== undefined
          ? h('pre', { className: 'd0nj-tool-command' }, h('span', { className: 'd0nj-tool-prompt' }, '\u276f '), renderTerminal(React, command))
          : meta.length > 0
            ? h('div', { className: 'd0nj-tool-meta' }, meta)
            : argsText.length > 0
              ? h('pre', { className: 'd0nj-tool-args' }, argsText)
              : null

  return h(
    'div',
    { className: 'd0nj-tool', 'data-error': String(isError) },
    h(
      'div',
      { className: 'd0nj-tool-head' },
      h('span', { className: 'd0nj-tool-icon', 'data-state': stateKey }, glyph),
      h('span', { className: 'd0nj-tool-verb' }, narration?.verb ?? (name || 'Tool')),
      h(
        'span',
        { className: 'd0nj-tool-target' },
        parts.directory.length > 0 ? h('span', { className: 'd0nj-narr-dir' }, parts.directory) : null,
        h('span', { className: 'd0nj-narr-base' }, parts.base),
      ),
      stat.length > 0 ? h('span', { className: 'd0nj-tool-stat' }, stat) : null,
      h('span', { className: 'd0nj-tool-state' }, spent > 0 ? formatElapsed(spent) + ' \u00b7 ' + state : state),
    ),
    body,
    showOutput ? renderOutput(React, cleaned.body, options) : null,
    subCalls.length > 0
      ? h(
          'div',
          { className: 'd0nj-tool-sub' },
          subCalls.map((sub) => renderBlock(React, sub, now, depth + 1, undefined) ?? null),
        )
      : null,
  )
}

export function createToolNarration(React: ReactApi): (props: { readonly node?: unknown }) => unknown {
  return function ToolNarration(props: { readonly node?: unknown }): unknown {
    const [now, setNow] = React.useState(() => Date.now())
    const [expanded, setExpanded] = React.useState(false)
    const pin = React.useRef(true)
    const root = toolRoot(props.node)
    const phase = toolPhase(root)
    React.useEffect(() => {
      if (phase === 'result') return
      const tick = setInterval(() => setNow(Date.now()), 200)
      return () => clearInterval(tick)
    }, [phase])
    return renderBlock(React, root, now, 0, {
      expanded,
      pin,
      onToggle: () => {
        pin.current = true
        setExpanded((previous) => !previous)
      },
    })
  }
}
