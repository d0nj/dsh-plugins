export type LivePhase = 'idle' | 'thinking' | 'writing' | 'calling' | 'holding'

export interface ArgTextReader {
  text(key: string): string | undefined
}

export interface LiveCall {
  readonly callId: string
  readonly name: string
  readonly phase: 'preparing' | 'start'
  readonly time: number
  readonly args: ArgTextReader
}

export interface CallNarration {
  readonly key: string
  readonly verb: string
  readonly argument: string
  readonly preparing: boolean
}

export interface LiveSummary {
  readonly phase: LivePhase
  readonly reasoning: string
  readonly answer: string
  readonly calls: readonly CallNarration[]
  readonly lead: string
}

interface ToolNarration {
  readonly verb: string
  readonly keys: readonly string[]
}

export const TOOL_NARRATION: Readonly<Record<string, ToolNarration>> = {
  apply_patch: { verb: 'Patching', keys: ['path'] },
  bash: { verb: 'Running', keys: ['command'] },
  edit: { verb: 'Editing', keys: ['file_path', 'path'] },
  glob: { verb: 'Globbing', keys: ['pattern'] },
  grep: { verb: 'Searching', keys: ['pattern'] },
  pwsh: { verb: 'Running', keys: ['command'] },
  read: { verb: 'Reading', keys: ['file_path', 'path'] },
  read_image: { verb: 'Opening', keys: ['file_path', 'path'] },
  subagent: { verb: 'Delegating', keys: ['description'] },
  subagent_fork: { verb: 'Forking', keys: ['description'] },
  web_fetch: { verb: 'Fetching', keys: ['url'] },
  web_search: { verb: 'Searching the web', keys: ['query'] },
  workflow: { verb: 'Orchestrating', keys: ['description'] },
  write: { verb: 'Writing', keys: ['file_path', 'path'] },
}

const FALLBACK_KEYS = ['command', 'path', 'file_path', 'pattern', 'url', 'query', 'description', 'prompt'] as const

export const PREPARING_LABEL = 'composing'

export function clip(text: string, limit: number): string {
  const single = text.replace(/\s+/gu, ' ').trim()
  if (single.length <= limit) return single
  return single.slice(0, Math.max(0, completedIndex(single, limit))) + '\u2026'
}

function completedIndex(text: string, limit: number): number {
  if (limit <= 0) return 0
  const code = text.charCodeAt(limit - 1)
  return code >= 0xd800 && code <= 0xdbff ? limit - 1 : limit
}

function readArgument(call: LiveCall, keys: readonly string[]): string {
  for (const key of keys) {
    const value = call.args.text(key)
    if (value !== undefined && value.length > 0) return value
  }
  return ''
}

export function narrateCall(call: LiveCall, limit = 96): CallNarration {
  const known = TOOL_NARRATION[call.name]
  const keys = known === undefined ? FALLBACK_KEYS : known.keys
  const raw = readArgument(call, keys)
  const preparing = call.phase === 'preparing'
  const argument = raw.length > 0 ? clip(raw, limit) : preparing ? PREPARING_LABEL + '\u2026' : ''
  const verb = known === undefined ? call.name.replaceAll('_', ' ') : known.verb
  return {
    key: call.callId,
    verb,
    argument,
    preparing,
  }
}

export function splitPath(value: string): { directory: string; base: string } {
  const at = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'))
  return at < 0
    ? { directory: '', base: value }
    : { directory: value.slice(0, at + 1), base: value.slice(at + 1) }
}

export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0.0s'
  const seconds = ms / 1000
  if (seconds < 10) return seconds.toFixed(1) + 's'
  if (seconds < 60) return Math.floor(seconds) + 's'
  const whole = Math.floor(seconds)
  return Math.floor(whole / 60) + 'm' + String(whole % 60).padStart(2, '0') + 's'
}

export function formatRate(charsPerSecond: number): string {
  if (!Number.isFinite(charsPerSecond) || charsPerSecond <= 0) return '\u2014'
  if (charsPerSecond < 10) return charsPerSecond.toFixed(1) + '/s'
  return Math.round(charsPerSecond) + '/s'
}

export function summarize(input: {
  readonly calls: readonly LiveCall[]
  readonly reasoning: string
  readonly answer: string
  readonly running: boolean
  readonly limit?: number
}): LiveSummary {
  const limit = input.limit ?? 96
  const calls = input.calls.map((call) => narrateCall(call, limit))
  const phase = resolvePhase(input.calls, input.answer, input.reasoning, input.running)
  return {
    phase,
    reasoning: input.reasoning,
    answer: input.answer,
    calls,
    lead: leadSentence(phase, calls, input.reasoning, input.answer, limit),
  }
}

function resolvePhase(
  calls: readonly LiveCall[],
  answer: string,
  reasoning: string,
  running: boolean,
): LivePhase {
  if (calls.length > 0) return 'calling'
  if (answer.length > 0) return 'writing'
  if (reasoning.length > 0) return 'thinking'
  return running ? 'holding' : 'idle'
}

const PHASE_LABEL: Readonly<Record<LivePhase, string>> = {
  idle: 'Ready',
  thinking: 'Thinking',
  writing: 'Writing',
  calling: 'Acting',
  holding: 'Working',
}

export function phaseLabel(phase: LivePhase): string {
  return PHASE_LABEL[phase]
}

function leadSentence(
  phase: LivePhase,
  calls: readonly CallNarration[],
  reasoning: string,
  answer: string,
  limit: number,
): string {
  const tail = lastLine(phase === 'writing' ? answer : reasoning, limit)
  if (tail.length > 0) return tail
  const head = calls[0]
  if (head === undefined) return ''
  const target = head.argument.length > 0 ? ' ' + head.argument : ''
  const more = calls.length > 1 ? ' +' + String(calls.length - 1) : ''
  return (head.preparing ? head.verb + ' \u2026' + target : head.verb + target) + more
}

function lastLine(text: string, limit: number): string {
  const trimmed = text.trimEnd()
  const breakAt = trimmed.lastIndexOf('\n')
  return clip(breakAt >= 0 ? trimmed.slice(breakAt + 1) : trimmed, limit)
}
