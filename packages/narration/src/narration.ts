export interface NarrationOptions {
  readonly intentLine: boolean
  readonly parallelReads: boolean
  readonly intentWords: number
}

export const SECTION_NAME = 'd0nj-narration'

export const SECTION_ORDER = 700

const INTENT_RULE = [
  'Before every tool call, open the message with one sentence of intent that names the exact file, command or symbol you are about to touch, then make the call in that same message.',
  '',
  'Reading src/server.rs to trace how frames are dispatched.',
  '',
  '- One sentence, present tense, no preamble.',
  '- Never send a message that only announces work.',
  '- Never restate a call\u2019s own arguments in prose.',
].join('\n')

const PARALLEL_RULE = [
  'When calls are independent, put them in one message: read, grep, glob and read_image run concurrently, and the single intent sentence covers the batch.',
].join('\n')

export function buildNarrationSection(options: NarrationOptions): string | null {
  if (!options.intentLine && !options.parallelReads) return null
  const parts = ['## Narration before action']
  if (options.intentLine) {
    parts.push(INTENT_RULE)
    parts.push('Keep it under ' + String(options.intentWords) + ' words.')
  }
  if (options.parallelReads) parts.push(PARALLEL_RULE)
  return parts.join('\n\n')
}
