import { PacedText, RateMeter } from '../pacing.js'
import {
  formatElapsed,
  formatRate,
  narrateCall,
  phaseLabel,
  splitPath,
  summarize,
} from '../live.js'
import type { LiveCall } from '../live.js'
import { PHASE_COLOUR } from './style.js'

export interface ReactApi {
  createElement(
    type: unknown,
    props?: Record<string, unknown> | null,
    ...children: unknown[]
  ): unknown
  useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void]
  useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void
  useRef<T>(initial: T): { current: T }
}

interface ArgReader {
  text(key: string): string | undefined
}

interface LegacySlice {
  readonly runningCalls?: unknown
  readonly partial?: unknown
}

type Selector = (snapshot: unknown) => unknown

export interface AssistantNodeProps {
  readonly node?: unknown
  readonly groupPart?: string | undefined
  readonly renderFactorySlot?: ((id: string, input: unknown) => unknown) | undefined
  readonly useChat?: ((select: Selector) => unknown) | undefined
}

export type AssistantStatus = 'running' | 'settled' | 'interrupted'

const NO_SELECT: (select: Selector) => unknown = () => undefined

const MISSING_ARGS: ArgReader = { text: () => undefined }

export const REASONING_FACTORY = 'conversation.chat.reasoning.content'

function legacyOf(snapshot: unknown): LegacySlice | undefined {
  if (snapshot === null || typeof snapshot !== 'object') return undefined
  const legacy = (snapshot as { legacy?: unknown }).legacy
  return legacy !== null && typeof legacy === 'object' ? (legacy as LegacySlice) : undefined
}

export function toLiveCalls(raw: unknown): LiveCall[] {
  if (!Array.isArray(raw)) return []
  const calls: LiveCall[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const record = entry as { callId?: unknown; name?: unknown; phase?: unknown; time?: unknown; args?: unknown }
    if (typeof record.callId !== 'string' || typeof record.name !== 'string') continue
    const source = record.args
    const usable =
      source !== null && typeof source === 'object' && typeof (source as ArgReader).text === 'function'
    calls.push({
      callId: record.callId,
      name: record.name,
      phase: record.phase === 'start' ? 'start' : 'preparing',
      time: typeof record.time === 'number' ? record.time : 0,
      args: usable ? (source as ArgReader) : MISSING_ARGS,
    })
  }
  return calls
}

export function assistantStatus(node: unknown): AssistantStatus {
  if (node === null || typeof node !== 'object') return 'settled'
  const data = (node as { data?: unknown }).data
  if (data === null || typeof data !== 'object') return 'settled'
  const status = (data as { status?: unknown }).status
  return status === 'running' || status === 'interrupted' ? status : 'settled'
}

export function blocksOf(node: unknown): readonly unknown[] {
  if (node === null || typeof node !== 'object') return []
  const data = (node as { data?: unknown }).data
  if (data === null || typeof data !== 'object') return []
  const blocks = (data as { blocks?: unknown }).blocks
  return Array.isArray(blocks) ? blocks : []
}

export function textOfBlocks(blocks: readonly unknown[], kind: 'reasoning' | 'text'): string {
  let text = ''
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const entry = block as { kind?: unknown; text?: unknown }
    if (entry.kind !== kind || typeof entry.text !== 'string') continue
    text += entry.text
  }
  return text
}

function usePacedText(React: ReactApi, target: string, animating: boolean): string {
  const [shown, setShown] = React.useState(target)
  const stream = React.useRef({ seen: target, queue: new PacedText() })
  React.useEffect(() => {
    const state = stream.current
    const previouslySeen = state.seen
    state.seen = target
    if (!target.startsWith(previouslySeen)) {
      state.queue.reset()
      setShown(target)
      return
    }
    const delta = target.slice(previouslySeen.length)
    if (delta.length === 0) return
    if (!animating) {
      state.queue.reset()
      setShown(target)
      return
    }
    state.queue.push(delta)
    let frame = 0
    const step = (): void => {
      const chunk = state.queue.take()
      if (chunk.length > 0) setShown((previous) => previous + chunk)
      frame = state.queue.pending > 0 ? requestAnimationFrame(step) : 0
    }
    frame = requestAnimationFrame(step)
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [target, animating])
  return shown
}

function useClock(
  React: ReactApi,
  working: boolean,
  meter: { current: RateMeter },
  charsOf: () => number,
): { now: number; rate: number } {
  const [now, setNow] = React.useState(() => Date.now())
  const [rate, setRate] = React.useState(0)
  React.useEffect(() => {
    if (!working) {
      meter.current.reset()
      setRate(0)
      return
    }
    const tick = setInterval(() => {
      const at = Date.now()
      setNow(at)
      setRate(meter.current.sample(at, charsOf()))
    }, 100)
    return () => clearInterval(tick)
  }, [working])
  return { now, rate }
}

function callRow(React: ReactApi, call: LiveCall, now: number): unknown {
  const narration = narrateCall(call, 220)
  const parts = splitPath(narration.argument)
  const spent = call.time > 0 ? formatElapsed(Math.max(0, now - call.time)) : ''
  return React.createElement(
    'div',
    { key: call.callId, className: 'd0nj-narr-call', 'data-preparing': String(narration.preparing) },
    React.createElement('span', { className: 'd0nj-narr-verb' }, narration.verb),
    React.createElement(
      'span',
      { className: 'd0nj-narr-arg' },
      parts.directory.length > 0
        ? React.createElement('span', { className: 'd0nj-narr-dir' }, parts.directory)
        : null,
      React.createElement('span', { className: 'd0nj-narr-base' }, parts.base),
      React.createElement('span', { className: 'd0nj-narr-caret' }),
    ),
    spent.length > 0 ? React.createElement('span', { className: 'd0nj-narr-spent' }, spent) : null,
  )
}

export function createAssistantNarration(React: ReactApi): (props: AssistantNodeProps) => unknown {
  const h = React.createElement

  return function AssistantNarration(props: AssistantNodeProps): unknown {
    const useChat = props.useChat ?? NO_SELECT

    const status = assistantStatus(props.node)
    const streaming = status === 'running'
    const blocks = blocksOf(props.node)
    const reasoningTarget = textOfBlocks(blocks, 'reasoning')
    const answer = textOfBlocks(blocks, 'text')
    const part = typeof props.groupPart === 'string' ? props.groupPart : undefined
    const showReasoning = part !== 'response'
    const showAnswer = part !== 'reasoning'

    const rawCalls = useChat((snapshot) => legacyOf(snapshot)?.runningCalls)
    const calls = streaming ? toLiveCalls(rawCalls) : []

    const reasoning = usePacedText(React, reasoningTarget, streaming)
    const meter = React.useRef(new RateMeter())
    const charsRef = React.useRef(0)
    charsRef.current = reasoningTarget.length + answer.length
    const { now, rate } = useClock(React, streaming, meter, () => charsRef.current)

    const start = React.useRef(0)
    React.useEffect(() => {
      if (streaming && start.current === 0) start.current = Date.now()
      if (!streaming) start.current = 0
    }, [streaming])

    const [thinkingOpen, setThinkingOpen] = React.useState(true)
    const toggleThinking = (): void => {
      setThinkingOpen((previous) => !previous)
    }
    const pinned = React.useRef(true)

    const summary = summarize({ calls, reasoning, answer, running: streaming, limit: 120 })
    const elapsed = start.current === 0 ? 0 : Math.max(0, now - start.current)
    const countLabel = calls.length > 1 ? String(calls.length) : ''
    const hasReasoning = reasoningTarget.length > 0

    const header = streaming && showReasoning
      ? h(
          'button',
          {
            type: 'button',
            className: 'd0nj-narr-live',
            'data-working': 'true',
            'aria-expanded': hasReasoning ? thinkingOpen : undefined,
            onClick: hasReasoning ? toggleThinking : undefined,
          },
          h('span', { className: 'd0nj-narr-dot', style: { '--d0nj-narr-phase': PHASE_COLOUR[summary.phase] ?? PHASE_COLOUR.idle } }),
          h('span', { className: 'd0nj-narr-phase' }, phaseLabel(summary.phase)),
          countLabel.length > 0 ? h('span', { className: 'd0nj-narr-count' }, countLabel + ' calls') : null,
          h(
            'span',
            { className: 'd0nj-narr-metrics' },
            h('span', null, formatElapsed(elapsed)),
            rate > 0 ? h('span', null, formatRate(rate)) : null,
          ),
        )
      : null

    const roster =
      calls.length > 0 && showReasoning
        ? h('div', { className: 'd0nj-narr-calls' }, calls.map((call) => callRow(React, call, now)))
        : null

    const thinkingBody =
      showReasoning && thinkingOpen && hasReasoning
        ? h('pre', {
            className: 'd0nj-narr-think-body',
            ref: (element: HTMLElement | null) => {
              if (element !== null && pinned.current) element.scrollTop = element.scrollHeight
            },
            onScroll: (event: { currentTarget: HTMLElement }) => {
              const element = event.currentTarget
              pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 12
            },
          }, reasoning)
        : null

    const thinking =
      hasReasoning && showReasoning
        ? h(
            'div',
            { className: 'd0nj-narr-think' },
            streaming
              ? null
              : h(
                  'button',
                  {
                    type: 'button',
                    className: 'd0nj-narr-think-head',
                    'aria-expanded': thinkingOpen,
                    onClick: toggleThinking,
                  },
                  (thinkingOpen ? '\u25be ' : '\u25b8 ') + 'Thinking',
                ),
            thinkingBody,
          )
        : null

    const factory = props.renderFactorySlot
    const answerNode =
      answer.length > 0 && showAnswer
        ? h(
            'div',
            { className: 'd0nj-narr-answer' },
            typeof factory === 'function'
              ? factory(REASONING_FACTORY, { text: answer, running: streaming })
              : h('div', { className: 'd0nj-narr-plain' }, answer),
          )
        : null

    if (header === null && roster === null && thinking === null && answerNode === null) return null

    return h('div', { className: 'd0nj-narr' }, header, roster, thinking, answerNode)
  }
}
