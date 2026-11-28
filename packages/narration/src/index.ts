import z from '@deepseek-ai/schemastery'
import type { Context } from '@deepseek-ai/cordis'

import { SECTION_NAME, SECTION_ORDER, buildNarrationSection } from './narration.js'

export const name = 'narration'

export const inject = ['systemPrompt'] as const

export interface PluginConfig {
  intentLine: boolean
  parallelReads: boolean
  intentWords: number
  liveReasoning: boolean
  verboseTools: boolean
}

export const Config: z<PluginConfig> = z.object({
  liveReasoning: z
    .boolean()
    .default(true)
    .description(
      'Replace the assistant row with the live narration renderer. Off restores the shipped row, including its message actions and inline images.',
    ),
  verboseTools: z
    .boolean()
    .default(true)
    .description(
      'Render every tool call with its arguments and full output inline. Off restores the shipped tool rows and their per-tool views.',
    ),
  intentLine: z
    .boolean()
    .default(true)
    .description('Require one sentence of intent in the same message as every tool call.'),
  parallelReads: z
    .boolean()
    .default(true)
    .description('Ask for independent read-only calls to be batched into one message.'),
  intentWords: z
    .number()
    .step(1)
    .min(8)
    .max(60)
    .default(24)
    .description('Upper bound on the intent sentence, in words.'),
})

interface PromptSection {
  readonly name: string
  readonly order: number
  readonly text: string
}

interface PromptService {
  section(section: PromptSection): () => void
}

export function apply(ctx: Context, config: PluginConfig): () => void {
  const text = buildNarrationSection(config)
  if (text === null) return () => {}
  const prompt = (ctx as unknown as { systemPrompt?: PromptService }).systemPrompt
  if (prompt === undefined) return () => {}
  return prompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text })
}
