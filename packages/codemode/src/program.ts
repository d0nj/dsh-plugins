import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'

import { buildCatalog, describeCatalogEntry, searchCatalog } from './catalog.js'
import type { CatalogEntry, CatalogTool } from './catalog.js'
import type { PluginConfig } from './config.js'
import { NestedDispatcher } from './dispatch.js'
import { AttemptBudget } from './limits.js'
import { readSandboxPolicy, readWorkingDirectory } from './ptc.js'
import type { PtcBindingFunction, PtcBindingNamespace, PtcJsonValue, PtcRunRequest, PtcRunResult, PtcRunSandbox, PtcRuntimePort } from './ptc.js'

export interface ProgramDeps {
  readonly ctx: Context
  readonly config: PluginConfig
  readonly runtime: PtcRuntimePort
  readonly pipeline: ToolExecutionPipeline
  readonly log: (message: string) => void
}

export interface RunCodeArgs {
  readonly code: string
  readonly description: string
  readonly timeoutMs?: number
}

export interface RunCodeOutput {
  readonly logs: string[]
  readonly result?: PtcJsonValue
  readonly sandbox?: PtcRunSandbox
}

export async function runProgram(deps: ProgramDeps, args: RunCodeArgs, exec: ToolRunContext): Promise<RunCodeOutput> {
  if (args.code.length > deps.config.maxProgramChars) {
    throw new Error(`program is ${args.code.length} characters, over the ${deps.config.maxProgramChars}-character limit`)
  }
  const definitions = deps.ctx.tools.definitions(exec.agent, exec.toolSet)
  const entries = buildCatalog(definitions.map(toCatalogTool), {
    pinned: deps.config.pinned,
    direct: deps.config.direct,
    exclude: deps.config.exclude,
  })
  const cwd = await resolveCwd(deps.ctx, exec)
  const sandboxPolicy = resolveSandboxPolicy(deps.ctx, exec)
  const request: PtcRunRequest = {
    program: args.code,
    bindings: [],
    signal: exec.signal,
    timeoutMs: args.timeoutMs ?? deps.config.timeoutMs,
    ...(cwd === undefined ? {} : { cwd }),
    ...(sandboxPolicy === undefined ? {} : { sandboxPolicy }),
    ...(exec.agent === undefined ? {} : { stateOwner: exec.agent }),
  }
  let spec
  try {
    spec = deps.runtime.resolve(request)
  } catch (error) {
    throw new Error(`code run could not start: ${messageOf(error)}`)
  }
  const dispatcher = new NestedDispatcher({
    ctx: deps.ctx,
    pipeline: deps.pipeline,
    budget: new AttemptBudget(deps.config.maxSubCallsPerMinute, spec.timeoutMs),
    maxParallel: deps.config.maxParallelSubCalls,
    parent: exec,
    log: deps.log,
  })
  const functions = Object.create(null) as Record<string, PtcBindingFunction>
  for (const entry of entries) functions[entry.name] = dispatcher.binding(entry.name)
  const bindings: PtcBindingNamespace[] = [
    { global: 'tools', functions, errorClass: { name: 'ToolCallError', memberNameProperty: 'toolName' } },
    { global: 'catalog', functions: catalogBindings(entries) },
  ]
  let result: PtcRunResult
  try {
    result = await deps.runtime.run({ ...spec, bindings })
  } finally {
    await dispatcher.drain()
  }
  return shapeOutput(result)
}

function catalogBindings(entries: readonly CatalogEntry[]): Record<string, PtcBindingFunction> {
  return {
    async search(rawArguments: unknown): Promise<PtcJsonValue> {
      const args = asRecord(rawArguments)
      const query = typeof args.query === 'string' ? args.query : ''
      const requested = typeof args.limit === 'number' && Number.isFinite(args.limit) ? Math.trunc(args.limit) : 8
      const limit = Math.max(1, Math.min(20, requested))
      return searchCatalog(entries, query, limit) as unknown as PtcJsonValue
    },
    async describe(rawArguments: unknown): Promise<PtcJsonValue> {
      const args = asRecord(rawArguments)
      const name = typeof args.name === 'string' ? args.name : ''
      const detail = describeCatalogEntry(entries, name)
      if (detail === undefined) throw new Error(`no tool named "${name}" is bound to this program`)
      return { name, detail }
    },
  }
}

async function resolveCwd(ctx: Context, exec: ToolRunContext): Promise<string | undefined> {
  const agent = exec.agent
  if (agent === undefined) return undefined
  const directory = readWorkingDirectory(ctx)
  if (directory === undefined) return undefined
  try {
    return await directory.ensure(agent, exec.signal)
  } catch {
    return undefined
  }
}

function resolveSandboxPolicy(ctx: Context, exec: ToolRunContext) {
  const policy = readSandboxPolicy(ctx)
  if (policy === undefined) return undefined
  const session = (exec.agent as unknown as { session?: unknown } | undefined)?.session
  try {
    return policy.resolve(session === undefined ? {} : { session })
  } catch {
    return undefined
  }
}

function shapeOutput(result: PtcRunResult): RunCodeOutput {
  if (result.error !== undefined) {
    const captured = result.logs.length === 0 ? '' : `\nCaptured output:\n${result.logs.join('\n')}`
    const sandbox = result.sandbox === undefined ? '' : `\nFile sandbox: ${describeSandbox(result.sandbox)}.`
    throw new Error(`code run failed (${result.error.kind}): ${result.error.message}${captured}${sandbox}`)
  }
  return {
    logs: result.logs,
    ...(result.value === undefined ? {} : { result: result.value }),
    ...(result.sandbox === undefined ? {} : { sandbox: result.sandbox }),
  }
}

export function describeSandbox(sandbox: PtcRunSandbox): string {
  const enforcement = sandbox.enforcement === undefined ? '' : `; enforcement: ${sandbox.enforcement}`
  const denied = sandbox.denied ? '; operation denied' : ''
  return `${sandbox.mode}${enforcement}${denied}`
}

export function toCatalogTool(definition: ToolDefinition): CatalogTool {
  return {
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    output: definition.output.schema,
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
