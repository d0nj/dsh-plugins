import type { Context } from '@deepseek-ai/cordis'

import { createAssistantNarration } from './assistant.js'
import type { AssistantNodeProps, ReactApi } from './assistant.js'
import { createToolNarration } from './tool.js'
import { CSS, STYLE_ELEMENT_ID } from './style.js'

export const inject = ['slots', 'configForms'] as const

export const CHAT_SLOT = 'conversation.chat.node'

export const ASSISTANT_KEY = 'assistant-step'

export const TOOL_KEY = 'tool-call'

export const SHADOW_PRIORITY = -1

let ReactImpl: ReactApi | undefined

export function useReact(react: ReactApi): void {
  ReactImpl = react
}

interface SlotOptions {
  readonly name: string
  readonly key?: string
  readonly id?: string
  readonly order?: number
  readonly priority?: number
}

interface SlotsService {
  inject(owner: string, callback: () => () => void): () => void
  register(options: SlotOptions, component: unknown): () => void
}

interface ConfigForm {
  getSnapshot(): { readonly value: unknown; readonly writable: boolean }
  subscribe(listener: () => void): () => void
}

interface ConfigFormsService {
  get(namespace: string): ConfigForm
}

export interface NarrationFlags {
  readonly liveReasoning: boolean
  readonly verboseTools: boolean
}

export function flagsOf(value: unknown): NarrationFlags {
  if (value === null || typeof value !== 'object') return { liveReasoning: true, verboseTools: true }
  const record = value as { liveReasoning?: unknown; verboseTools?: unknown }
  return {
    liveReasoning: record.liveReasoning !== false,
    verboseTools: record.verboseTools !== false,
  }
}

export function installStyles(doc: Document): () => void {
  const existing = doc.getElementById(STYLE_ELEMENT_ID)
  if (existing !== null) existing.remove()
  const element = doc.createElement('style')
  element.id = STYLE_ELEMENT_ID
  element.textContent = CSS
  doc.head.appendChild(element)
  return () => {
    element.remove()
  }
}

export function apply(ctx: Context): void {
  if (ReactImpl === undefined) return
  const slots = (ctx as unknown as { slots?: SlotsService }).slots
  if (slots === undefined) return
  const forms = (ctx as unknown as { configForms?: ConfigFormsService }).configForms
  const Assistant = createAssistantNarration(ReactImpl) as (props: AssistantNodeProps) => unknown
  const Tool = createToolNarration(ReactImpl) as (props: { readonly node?: unknown }) => unknown

  ctx.effect(() => installStyles(document))

  let assistantMount: (() => void) | undefined
  let toolMount: (() => void) | undefined

  const mount = (key: string, component: unknown): (() => void) =>
    slots.inject(CHAT_SLOT, () =>
      slots.register({ name: CHAT_SLOT, key, priority: SHADOW_PRIORITY }, component),
    )

  const sync = (value: unknown): void => {
    const flags = flagsOf(value)
    if (flags.liveReasoning && assistantMount === undefined) {
      assistantMount = mount(ASSISTANT_KEY, Assistant)
    } else if (!flags.liveReasoning && assistantMount !== undefined) {
      assistantMount()
      assistantMount = undefined
    }
    if (flags.verboseTools && toolMount === undefined) {
      toolMount = mount(TOOL_KEY, Tool)
    } else if (!flags.verboseTools && toolMount !== undefined) {
      toolMount()
      toolMount = undefined
    }
  }

  ctx.effect(() => () => {
    assistantMount?.()
    toolMount?.()
    assistantMount = undefined
    toolMount = undefined
  })

  if (forms === undefined) {
    sync(undefined)
    return
  }
  const form = forms.get('narration')
  ctx.effect(() => form.subscribe(() => sync(form.getSnapshot().value)))
  sync(form.getSnapshot().value)
}
