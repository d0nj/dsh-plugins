import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import type { Context } from '@deepseek-ai/cordis'
import type { CommandInvocation } from '@deepseek-ai/dsh-commands'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

import {
  COMMAND_DESCRIPTION,
  Config,
  DEFAULT_FILE_NAME,
  executeInitCommand,
  type InitConfig,
} from './index.js'
import { buildInitPrompt } from './prompt.js'

const DIRECTORY = join('/repo')

function resolveConfig(options: Partial<InitConfig> = {}): InitConfig {
  return Config(options as InitConfig)
}

const context = { workingDirectory: { get: () => DIRECTORY } } as unknown as Context

function invocationOf(rawInput: string, recorded: UserMessage[]): CommandInvocation {
  return {
    commandId: 'cmd-test-1',
    rawInput,
    attachments: [],
    signal: new AbortController().signal,
    agent: {
      followup: (message: UserMessage) => { recorded.push(message) },
    },
  } as unknown as CommandInvocation
}

describe('executeInitCommand', () => {
  it('queues the brief as one user-role turn instead of answering the command itself', () => {
    const recorded: UserMessage[] = []
    const result = executeInitCommand(context, invocationOf('', recorded), resolveConfig())

    assert.equal(recorded.length, 1, 'exactly one follow-up turn is queued')
    assert.equal(recorded[0]?.role, 'user', 'the queued message is model-visible user input')
    assert.deepEqual(recorded[0]?.source, { kind: 'user' })
    assert.deepEqual(result.kind, 'success')
  })

  it('queues the same text the brief renders for that directory and file', () => {
    const recorded: UserMessage[] = []
    executeInitCommand(context, invocationOf('  the release pipeline ', recorded), resolveConfig())

    const expected = buildInitPrompt({
      directory: DIRECTORY,
      fileName: DEFAULT_FILE_NAME,
      focus: '  the release pipeline ',
      extraGuidance: '',
    })
    assert.deepEqual(recorded[0]?.content, [{ type: 'text', text: expected }])
  })

  it('acknowledges with the directory and the file it is about to write', () => {
    const recorded: UserMessage[] = []
    const result = executeInitCommand(context, invocationOf('', recorded), resolveConfig())

    assert.equal(result.kind, 'success')
    const text = result.kind === 'success' ? result.text : undefined
    assert.ok(text?.includes(DIRECTORY), 'acknowledgement names the surveyed directory')
    assert.ok(text?.includes(DEFAULT_FILE_NAME), 'acknowledgement names the target file')
  })

  it('appends operator guidance from the row to the queued turn', () => {
    const recorded: UserMessage[] = []
    executeInitCommand(context, invocationOf('', recorded), resolveConfig({ extraGuidance: 'Prefer node:test suites.' }))

    const block = recorded[0]?.content[0]
    assert.equal(block?.type, 'text')
    assert.ok(block?.type === 'text' && block.text.includes('Prefer node:test suites.'))
  })
})

describe('init Config', () => {
  it('targets AGENTS.md with no extra guidance by default', () => {
    assert.deepEqual(resolveConfig(), { fileName: 'AGENTS.md', extraGuidance: '' })
  })

  it('exposes the command summary the picker renders', () => {
    assert.equal(COMMAND_DESCRIPTION, 'Guided AGENTS.md setup')
  })
})
