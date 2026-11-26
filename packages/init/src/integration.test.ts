import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import type { CommandExecution } from '@deepseek-ai/dsh-commands'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

import { apply, inject, name, type InitConfig } from './index.js'

const DIRECTORY = join('/repo')
const SESSION = { id: 'session-1', append: () => undefined }

interface FakeAgent {
  readonly id: string
  readonly session: typeof SESSION
  readonly followup: (message: UserMessage) => void
}

async function mountRegistry(): Promise<Context> {
  const ctx = new Context()
  ctx.provide('workingDirectory', { get: () => DIRECTORY })
  await ctx.plugin(CommandRuntime)
  return ctx
}

function fakeAgent(queued: UserMessage[]): FakeAgent {
  return {
    id: 'session-1',
    session: SESSION,
    followup: message => { queued.push(message) },
  }
}

async function mount(config: Partial<InitConfig> = {}): Promise<{
  ctx: Context
  agent: FakeAgent
  queued: UserMessage[]
}> {
  const ctx = await mountRegistry()
  await ctx.plugin({
    name,
    inject,
    apply: (child: Context) => apply(child, { fileName: 'AGENTS.md', extraGuidance: '', ...config }),
  })
  const queued: UserMessage[] = []
  return { ctx, agent: fakeAgent(queued), queued }
}

function execute(ctx: Context, agent: FakeAgent, line: string): Promise<CommandExecution | undefined> {
  return ctx.commands.execute(agent as never, line, [], new AbortController().signal)
}

describe('/init through the command registry', () => {
  it('is discoverable with its summary and argument hint', async () => {
    const { ctx, agent } = await mount()
    const descriptor = ctx.commands.list(agent as never).find(command => command.name === 'init')
    assert.equal(descriptor?.description, 'Guided AGENTS.md setup')
    assert.equal(descriptor?.input?.hint, '[focus]')
  })

  it('accepts attachments so a user can hand the survey reference files', async () => {
    const { ctx, agent } = await mount()
    const descriptor = ctx.commands.list(agent as never).find(command => command.name === 'init')
    assert.equal(descriptor?.input?.attachments, true)
  })

  it('resolves the typed line and queues one survey turn', async () => {
    const { ctx, agent, queued } = await mount()
    const execution = await execute(ctx, agent, '/init focus on the release pipeline')

    assert.equal(execution?.result.kind, 'success')
    assert.equal(queued.length, 1)
    const block = queued[0]?.content.at(-1)
    assert.equal(block?.type, 'text')
    assert.ok(block?.type === 'text' && block.text.includes('focus on the release pipeline'))
  })

  it('leaves an unknown command line unclaimed', async () => {
    const { ctx, agent, queued } = await mount()
    assert.equal(await execute(ctx, agent, '/initiate'), undefined)
    assert.equal(queued.length, 0)
  })

  it('refuses a configured file name that escapes the session directory', async () => {
    const { ctx, agent, queued } = await mount({ fileName: '../outside/AGENTS.md' })
    await execute(ctx, agent, '/init')

    const block = queued[0]?.content.at(-1)
    assert.ok(block?.type === 'text' && block.text.includes(join(DIRECTORY, 'AGENTS.md')))
    assert.ok(block?.type === 'text' && !block.text.includes('..'))
  })

  it('unregisters the command when its disposer runs', async () => {
    const ctx = await mountRegistry()
    const agent = fakeAgent([])
    const dispose = apply(ctx, { fileName: 'AGENTS.md', extraGuidance: '' })
    assert.notEqual(ctx.commands.find(agent as never, 'init'), undefined)
    dispose()
    assert.equal(ctx.commands.find(agent as never, 'init'), undefined)
  })
})
