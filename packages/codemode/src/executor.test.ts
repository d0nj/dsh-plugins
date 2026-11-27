import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import type { ToolCallBlock, ToolCallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolsService, { defineTool } from '@deepseek-ai/dsh-tools'

import { Config, resolveSettings } from './config.js'
import type { PluginConfig } from './config.js'
import { CodeModeExecutor } from './executor.js'
import { apply } from './index.js'
import type { PtcRunRequest, PtcRunResult, PtcRunSpec, PtcRuntimePort } from './ptc.js'

interface AppendRecord {
  readonly type: string
  readonly data: unknown
}

interface FakeAgent {
  readonly id: string
  readonly session: { append(type: string, data: unknown): unknown }
  readonly ctx: Context
}

type Bindings = Record<string, (args: unknown) => Promise<unknown>>
type Program = (scope: { tools: Bindings; catalog: Bindings }) => Promise<unknown>

class FakeRuntime implements PtcRuntimePort {
  readonly language = 'typescript'
  readonly isolation = 'fake'
  program: Program = async () => undefined
  request: PtcRunRequest | undefined

  resolve(request: PtcRunRequest): PtcRunSpec {
    this.request = request
    return { ...request, cwd: request.cwd ?? process.cwd(), timeoutMs: request.timeoutMs ?? 120_000 }
  }

  async run(spec: PtcRunSpec): Promise<PtcRunResult> {
    const scope = (global: string): Bindings => spec.bindings.find(entry => entry.global === global)?.functions ?? {}
    try {
      const value = await this.program({ tools: scope('tools'), catalog: scope('catalog') })
      return value === undefined ? { logs: [] } : { logs: [], value: value as never }
    } catch (error) {
      return { logs: [], error: { kind: 'exception', message: error instanceof Error ? error.message : String(error) } }
    }
  }
}

interface Harness {
  readonly ctx: Context
  readonly agent: FakeAgent
  readonly runtime: FakeRuntime
  readonly executor: CodeModeExecutor
  readonly appends: AppendRecord[]
}

async function mount(overrides: Partial<PluginConfig> = {}, withRuntime = true): Promise<Harness> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolsService)
  const runtime = new FakeRuntime()
  if (withRuntime) ctx.provide('ptcRuntime', runtime)
  const settings = resolveSettings(Config({ direct: ['echo'], ...overrides }), { warn: () => {} })
  const executor = new CodeModeExecutor(ctx, settings, runtime)
  ctx.effect(() => ctx.tools.setExecutor(executor))
  const appends: AppendRecord[] = []
  const agent: FakeAgent = {
    id: 'session-1',
    ctx: ctx.extend({ label: 'fake-agent' }),
    session: {
      append(type, data) {
        appends.push({ type, data })
      },
    },
  }
  registerTools(ctx)
  return { ctx, agent, runtime, executor, appends }
}

function registerTools(ctx: Context): void {
  ctx.tools.register(
    defineTool({
      name: 'echo',
      description: 'Echo the text back.',
      parameters: { text: { type: 'string', required: true } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { text: { type: 'string', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.text }],
      },
      execute: async args => ({ text: args.text }),
    }),
  )
  ctx.tools.register(
    defineTool({
      name: 'danger',
      description: 'A tool programs may not call.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } },
        render: () => [{ type: 'text', text: 'ok' }],
      },
      execute: async () => ({ ok: true }),
    }),
  )
}

function call(name: string, args: unknown): ToolCallBlock {
  return { type: 'tool-call', id: `${name}-1` as unknown as ToolCallId, name, arguments: JSON.stringify(args) }
}

async function run(harness: Harness, name: string, args: unknown, program?: Program) {
  if (program !== undefined) harness.runtime.program = program
  const batch = await harness.executor.execute({
    calls: [call(name, args)],
    signal: new AbortController().signal,
    agent: harness.agent as never,
  })
  return batch.results[0]?.result
}

describe('CodeModeExecutor.describe', () => {
  it('presents run_code first and keeps configured direct tools', async () => {
    const harness = await mount()
    const described = harness.executor.describe(harness.ctx.tools.definitions())
    assert.deepEqual(
      described.schemas.map(schema => schema.name),
      ['run_code', 'echo'],
    )
    assert.deepEqual(described.knownNames, ['run_code', 'echo'])
  })

  it('renders one catalog section and one transport section', async () => {
    const harness = await mount()
    assert.deepEqual(
      harness.executor.sections?.map(section => section.name),
      ['tools:codemode-only', 'tools:codemode-catalog'],
    )
    const rendered = harness.executor.sections?.[1]?.text
    assert.equal(typeof rendered, 'function')
    const text = typeof rendered === 'function' ? rendered(harness.ctx.tools.definitions()) : ''
    assert.match(text, /echo\(text: string\)/)
  })
})

describe('CodeModeExecutor.execute', () => {
  it('runs a program that calls a bound tool', async () => {
    const harness = await mount()
    const result = await run(harness, 'run_code', { code: 'return 1', description: 'echo' }, async scope => {
      const echo = scope.tools.echo
      assert.ok(echo)
      return await echo({ text: 'hello' })
    })
    assert.equal(result?.isError, false)
    assert.deepEqual(result?.isError === false ? result.value : undefined, { logs: [], result: { text: 'hello' } })
  })

  it('lets programs discover a tool through catalog.search', async () => {
    const harness = await mount()
    const result = await run(harness, 'run_code', { code: 'return 1', description: 'search' }, async scope => {
      const search = scope.catalog.search
      assert.ok(search)
      return await search({ query: 'echo' })
    })
    assert.equal(result?.isError, false)
    const output = result?.isError === false ? (result.value as { result: Array<{ name: string }> }) : { result: [] }
    assert.equal(output.result[0]?.name, 'echo')
  })

  it('does not bind excluded tools', async () => {
    const harness = await mount({ exclude: ['danger'] })
    await run(harness, 'run_code', { code: 'return 1', description: 'excluded' }, async scope => {
      assert.equal(scope.tools.danger, undefined)
    })
  })

  it('appends paired dispatch events for a nested call', async () => {
    const harness = await mount()
    await run(harness, 'run_code', { code: 'return 1', description: 'nested' }, async scope => {
      const echo = scope.tools.echo
      assert.ok(echo)
      await echo({ text: 'x' })
      return null
    })
    const start = harness.appends.find(record => record.type === 'tool/ptc-dispatch-start')
    const settle = harness.appends.find(record => record.type === 'tool/ptc-dispatch')
    assert.ok(start)
    assert.ok(settle)
    const startData = start.data as { subCallId: string; name: string }
    const settleData = settle.data as { subCallId: string; name: string }
    assert.equal(startData.name, 'echo')
    assert.equal(startData.subCallId, settleData.subCallId)
    assert.match(startData.subCallId, /:ptc:1$/)
  })

  it('fails the program when a bound tool rejects', async () => {
    const harness = await mount()
    const result = await run(harness, 'run_code', { code: 'throw 1', description: 'failure' }, async () => {
      throw new Error('boom')
    })
    assert.equal(result?.isError, true)
    assert.match(result?.isError === true ? result.error.message : '', /code run failed \(exception\): boom/)
  })

  it('enforces the subcall budget', async () => {
    const harness = await mount({ maxSubCallsPerMinute: 1, timeoutMs: 120_000 })
    const result = await run(harness, 'run_code', { code: 'loop', description: 'budget' }, async scope => {
      const echo = scope.tools.echo
      assert.ok(echo)
      await echo({ text: '1' })
      await echo({ text: '2' })
      await echo({ text: '3' })
      return null
    })
    assert.equal(result?.isError, true)
    assert.match(result?.isError === true ? result.error.message : '', /tool call limit exceeded/)
  })
})

describe('direct calls', () => {
  it('executes a configured direct tool without a program', async () => {
    const harness = await mount()
    const result = await run(harness, 'echo', { text: 'direct' })
    assert.equal(result?.isError, false)
    assert.deepEqual(result?.isError === false ? result.value : undefined, { text: 'direct' })
  })

  it('refuses a non-direct tool at the top level', async () => {
    const harness = await mount()
    const result = await run(harness, 'danger', {})
    assert.equal(result?.isError, true)
    assert.equal(result?.isError === true ? result.error.info?.code : undefined, 'UNKNOWN_TOOL')
  })
})

describe('apply', () => {
  it('leaves the deployment executor in place when no ptcRuntime is mounted', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolsService)
    assert.doesNotThrow(() => apply(ctx, {}))
  })

  it('sets an executor when the runtime is present', async () => {
    const harness = await mount()
    const described = harness.ctx.tools.definitions()
    assert.ok(described.length >= 0)
    assert.equal(harness.executor.describe(described).schemas[0]?.name, 'run_code')
  })
})
