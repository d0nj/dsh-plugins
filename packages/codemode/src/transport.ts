import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, RUN_CODE_NAME } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

import { truncateMiddle } from './limits.js'
import { describeSandbox, runProgram } from './program.js'
import type { ProgramDeps, RunCodeOutput } from './program.js'

export const RUN_CODE_DESCRIPTION = [
  'Run one TypeScript program that composes the tools of this agent.',
  'Takes `code`, the program body, and `description`, a short summary shown to the user.',
  'Call bound tools as `await tools.name(args)`, discover ones the catalog index only names with `await catalog.search({ query })`,',
  'and return the value you need. The program runs in an isolated Node process under the session sandbox.',
].join(' ')

const CODE_DESCRIPTION =
  'Program body. Call tools as `await tools.name(args)`; discover them with `await catalog.search({ query })`. Return the value you need.'

const DESCRIPTION_PARAMETER_DESCRIPTION = 'Short summary of what the program does, shown as the call title.'

export interface TransportDeps extends ProgramDeps {
  readonly maxResultChars: number
}

export function createRunCodeTransport(deps: TransportDeps): ToolDefinition {
  return defineTool({
    name: RUN_CODE_NAME,
    description: RUN_CODE_DESCRIPTION,
    parameters: {
      code: { type: 'string', required: true, description: CODE_DESCRIPTION },
      description: { type: 'string', required: true, description: DESCRIPTION_PARAMETER_DESCRIPTION },
      timeoutMs: { type: 'number', description: `Program timeout in milliseconds; defaults to ${deps.config.timeoutMs}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          logs: { type: 'array', required: true, items: { type: 'string' } },
          result: { type: 'json' },
          sandbox: {
            type: 'object',
            additionalProperties: false,
            properties: {
              mode: { type: 'string', required: true },
              denied: { type: 'boolean', required: true },
              enforcement: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => renderOutput(value, deps.maxResultChars),
    },
    presentCall: args => ({ card: 'generic', title: args.description, kind: 'execute', rawInput: args.code }),
    async execute(args, exec) {
      return await runProgram(
        deps,
        { code: args.code, description: args.description, ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }) },
        exec,
      )
    },
  })
}

function renderOutput(value: RunCodeOutput, maxResultChars: number): ContentBlock[] {
  const blocks: ContentBlock[] = []
  if (value.logs.length > 0) blocks.push({ type: 'text', text: value.logs.join('\n') })
  if (value.result !== undefined) blocks.push({ type: 'text', text: truncateMiddle(renderJson(value.result), maxResultChars) })
  if (blocks.length === 0) blocks.push({ type: 'text', text: '(the program produced no output)' })
  if (value.sandbox !== undefined) blocks.push({ type: 'text', text: `File sandbox: ${describeSandbox(value.sandbox)}.` })
  return blocks
}

function renderJson(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value)
}
