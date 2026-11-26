import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-working-directory'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import { buildInitPrompt } from './prompt.js'

export const name = 'init'
export const inject = ['commands', 'workingDirectory']

export const DEFAULT_FILE_NAME = 'AGENTS.md'
export const COMMAND_DESCRIPTION = 'Guided AGENTS.md setup'

export interface InitConfig {
  readonly fileName: string
  readonly extraGuidance: string
}

export const Config: z<InitConfig> = z.object({
  fileName: z.string().default(DEFAULT_FILE_NAME)
    .description('Instruction file to create or update, relative to the session directory.'),
  extraGuidance: z.string().default('')
    .description('Extra guidance appended to the /init brief, for repository conventions this plugin cannot know.'),
})

function isAbsoluteLike(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:[\\/]/u.test(path)
}

function resolveFileName(ctx: Context, configured: string): string {
  const candidate = configured.trim()
  const escaped = candidate.startsWith('..') || candidate.split(/[\\/]/u).includes('..')
  if (candidate.length > 0 && !escaped && !isAbsoluteLike(candidate)) return candidate
  ctx.logger(name).warn(
    `${JSON.stringify(configured)} is not a relative path inside the session directory; using ${DEFAULT_FILE_NAME}`,
  )
  return DEFAULT_FILE_NAME
}

export function executeInitCommand(
  ctx: Context,
  invocation: CommandInvocation,
  config: InitConfig,
): CommandResult {
  const directory = ctx.workingDirectory.get(invocation.agent.session)
  const prompt = buildInitPrompt({
    directory,
    fileName: config.fileName,
    focus: invocation.rawInput,
    extraGuidance: config.extraGuidance,
  })
  invocation.agent.followup(createUserMessage({
    content: [...invocation.attachments, { type: 'text', text: prompt }],
    source: { kind: 'user' },
  }))
  return { kind: 'success', text: `Surveying ${directory} for ${config.fileName}.` }
}

export function apply(ctx: Context, config: InitConfig): () => void {
  const resolved: InitConfig = {
    fileName: resolveFileName(ctx, config.fileName),
    extraGuidance: config.extraGuidance,
  }
  return ctx.commands.register({
    name: 'init',
    description: COMMAND_DESCRIPTION,
    input: { hint: '[focus]', attachments: true },
    handler: invocation => executeInitCommand(ctx, invocation, resolved),
  })
}
