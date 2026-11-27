import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, ToolCallId } from '@deepseek-ai/dsh-llm'
import { scopeTarget } from '@deepseek-ai/dsh-scope'
import type { ToolExecutionInput, ToolExecutionResult, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ScheduledToolDispatch, ToolExecutionPipeline } from '@deepseek-ai/dsh-tools/pipeline'

import type { AttemptBudget } from './limits.js'
import type { PtcBindingFunction, PtcJsonValue } from './ptc.js'

interface Deferred {
  readonly promise: Promise<PtcJsonValue>
  resolve(value: PtcJsonValue): void
  reject(error: unknown): void
}

interface ScheduledCall {
  readonly name: string
  readonly subCallId: string
  readonly durableArguments: unknown
  readonly input: ToolExecutionInput
  readonly deferred: Deferred
  settled: boolean
  result?: ToolExecutionResult
  failure?: unknown
  mode?: 'parallel' | 'exclusive'
}

export interface DispatchDeps {
  readonly ctx: Context
  readonly pipeline: ToolExecutionPipeline
  readonly budget: AttemptBudget
  readonly maxParallel: number
  readonly parent: ToolRunContext
  readonly log: (message: string) => void
}

type SessionAppender = { append(type: string, data: unknown): unknown }

export class NestedDispatcher {
  readonly #deps: DispatchDeps
  readonly #pending: ScheduledCall[] = []
  readonly #commitQueue: ScheduledCall[] = []
  readonly #inFlight = new Set<Promise<void>>()
  readonly #logWork = new Set<Promise<void>>()
  #exclusiveActive = false
  #driving = false
  #driver: Promise<void> = Promise.resolve()
  #resolveWake: (() => void) | undefined
  #closed = false

  constructor(deps: DispatchDeps) {
    this.#deps = deps
  }

  binding(name: string): PtcBindingFunction {
    return async (rawArguments: unknown): Promise<PtcJsonValue> => {
      const attempt = this.#deps.budget.next()
      const dispatched = toJsonValue(rawArguments === undefined ? {} : rawArguments)
      const durable = toJsonValue(dispatched)
      const call: ScheduledCall = {
        name,
        subCallId: `${String(this.#deps.parent.callId)}:ptc:${attempt}`,
        durableArguments: durable,
        deferred: defer(),
        settled: false,
        input: this.#executionInput(name, dispatched, attempt),
      }
      void call.deferred.promise.catch(() => {})
      if (this.#closed) throw new Error('the program has already finished; no further tool calls are accepted')
      this.#pending.push(call)
      this.#notify()
      void this.#drive()
      return await call.deferred.promise
    }
  }

  async drain(): Promise<void> {
    this.#closed = true
    await this.#drive()
    while (this.#logWork.size > 0) await Promise.allSettled([...this.#logWork])
  }

  #executionInput(name: string, dispatched: unknown, attempt: number): ToolExecutionInput {
    const parent = this.#deps.parent
    const agent = agentOf(parent)
    const toolSet = toolSetOf(parent)
    return {
      callId: `${String(parent.callId)}:ptc:${attempt}` as unknown as ToolCallId,
      rootCallId: parent.rootCallId,
      name,
      arguments: dispatched,
      parent: parent.token,
      signal: parent.signal,
      ...(agent === undefined ? {} : { agent }),
      ...(toolSet === undefined ? {} : { toolSet }),
    }
  }

  #notify(): void {
    const wake = this.#resolveWake
    this.#resolveWake = undefined
    wake?.()
  }

  #waitForChange(): Promise<void> {
    return new Promise<void>(resolve => {
      this.#resolveWake = resolve
    })
  }

  #capacity(mode: 'parallel' | 'exclusive'): boolean {
    if (this.#exclusiveActive) return false
    return mode === 'exclusive' ? this.#inFlight.size === 0 : this.#inFlight.size < this.#deps.maxParallel
  }

  #classify(call: ScheduledCall): 'parallel' | 'exclusive' {
    try {
      return this.#deps.pipeline.executionMode(call.input).kind
    } catch {
      return 'exclusive'
    }
  }

  #drive(): Promise<void> {
    if (this.#driving) return this.#driver
    this.#driving = true
    this.#driver = this.#runDriver()
    return this.#driver
  }

  async #runDriver(): Promise<void> {
    try {
      for (;;) {
        const signal = this.#waitForChange()
        const head = this.#commitQueue[0]
        if (head !== undefined && head.settled) {
          this.#commitQueue.shift()
          await this.#commit(head)
          if (head.mode === 'exclusive') this.#exclusiveActive = false
          continue
        }
        const next = this.#pending[0]
        if (next !== undefined) {
          if (this.#closed) {
            this.#pending.shift()
            this.#abandon(next)
            continue
          }
          const mode = this.#classify(next)
          if (this.#capacity(mode)) {
            this.#pending.shift()
            next.mode = mode
            if (mode === 'exclusive') this.#exclusiveActive = true
            this.#commitQueue.push(next)
            await this.#start(next)
            continue
          }
        }
        if (this.#pending.length === 0 && this.#commitQueue.length === 0 && this.#inFlight.size === 0 && this.#logWork.size === 0) return
        await signal
      }
    } finally {
      this.#driving = false
    }
  }

  async #start(call: ScheduledCall): Promise<void> {
    this.#appendStart(call)
    let prepared
    try {
      prepared = await this.#deps.pipeline.prepare(call.input)
    } catch (error) {
      call.failure = error
      call.settled = true
      this.#notify()
      return
    }
    const flight = (async () => {
      const outcome: ScheduledToolDispatch =
        prepared.kind === 'dispatch' ? await this.#deps.pipeline.dispatch(prepared.exec) : { kind: prepared.kind, result: prepared.result }
      const result = await this.#deps.pipeline.complete(prepared.exec, outcome)
      call.result = result
      call.settled = true
      this.#trackLog(this.#settle(call, result))
      this.#notify()
    })()
    this.#inFlight.add(flight)
    flight.then(
      () => {
        this.#inFlight.delete(flight)
        this.#notify()
      },
      () => {
        this.#inFlight.delete(flight)
        this.#notify()
      },
    )
  }

  async #commit(call: ScheduledCall): Promise<void> {
    while (this.#logWork.size > this.#deps.maxParallel) await Promise.race([...this.#logWork])
    if (call.failure !== undefined) {
      call.deferred.reject(call.failure)
      return
    }
    const result = call.result
    if (result === undefined) {
      call.deferred.reject(new Error(`tool "${call.name}" settled without a result`))
      return
    }
    if (result.isError) {
      call.deferred.reject(new Error(result.error.message))
      return
    }
    call.deferred.resolve(result.value)
  }

  #abandon(call: ScheduledCall): void {
    call.settled = true
    call.deferred.reject(new Error(`tool "${call.name}" was abandoned: the program finished before this call started`))
  }

  #appendStart(call: ScheduledCall): void {
    const session = sessionOf(this.#deps.parent)
    if (session === undefined) return
    try {
      session.append('tool/ptc-dispatch-start', {
        rootCallId: this.#deps.parent.rootCallId,
        parentCallId: this.#deps.parent.callId,
        subCallId: call.subCallId,
        name: call.name,
        arguments: call.durableArguments,
      })
    } catch (error) {
      this.#deps.log(`codemode: could not append tool/ptc-dispatch-start for ${call.name}: ${messageOf(error)}`)
    }
  }

  #settle(call: ScheduledCall, result: ToolExecutionResult): Promise<void> {
    const session = sessionOf(this.#deps.parent)
    if (session === undefined) return Promise.resolve()
    return (async () => {
      const content = await this.#shapeContent(call.name, result.content)
      try {
        session.append('tool/ptc-dispatch', {
          rootCallId: this.#deps.parent.rootCallId,
          parentCallId: this.#deps.parent.callId,
          subCallId: call.subCallId,
          name: call.name,
          arguments: call.durableArguments,
          isError: result.isError,
          ...(result.isError && result.error.info !== undefined ? { error: result.error.info } : {}),
          content,
          ...(result.meta === undefined ? {} : { meta: result.meta }),
        })
      } catch (error) {
        this.#deps.log(`codemode: could not append tool/ptc-dispatch for ${call.name}: ${messageOf(error)}`)
      }
    })()
  }

  async #shapeContent(name: string, content: ContentBlock[]): Promise<ContentBlock[]> {
    const dispatch = {
      name,
      content,
      ...(agentOf(this.#deps.parent) === undefined ? {} : { agent: agentOf(this.#deps.parent) }),
      ...(sessionOf(this.#deps.parent) === undefined ? {} : { session: sessionOf(this.#deps.parent) }),
    }
    try {
      const waterfall = waterfallOf(this.#deps.ctx)
      if (waterfall === undefined) return content
      const tools = this.#deps.ctx.tools
      const agent = agentOf(this.#deps.parent) as object | undefined
      return await waterfall.call(this.#deps.ctx, scopeTarget(tools as object, agent), 'tools/ptc-dispatch-log', dispatch, () => Promise.resolve(content))
    } catch (error) {
      this.#deps.log(`codemode: tools/ptc-dispatch-log listener failed for ${name}: ${messageOf(error)}; logging the original content`)
      return content
    }
  }

  #trackLog(work: Promise<void>): void {
    this.#logWork.add(work)
    work.then(
      () => {
        this.#logWork.delete(work)
        this.#notify()
      },
      () => {
        this.#logWork.delete(work)
        this.#notify()
      },
    )
  }
}

function defer(): Deferred {
  let resolvePromise!: (value: PtcJsonValue) => void
  let rejectPromise!: (error: unknown) => void
  const promise = new Promise<PtcJsonValue>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return { promise, resolve: resolvePromise, reject: rejectPromise }
}

function agentOf(exec: ToolRunContext): Agent | undefined {
  return exec.agent as Agent | undefined
}

function toolSetOf(exec: ToolRunContext): ToolRunContext['toolSet'] {
  return exec.toolSet
}

function sessionOf(exec: ToolRunContext): SessionAppender | undefined {
  const agent = agentOf(exec)
  if (agent === undefined) return undefined
  return (agent as unknown as { session?: SessionAppender }).session
}

function waterfallOf(ctx: Context): ((this: unknown, self: unknown, name: string, payload: unknown, next: () => Promise<ContentBlock[]>) => Promise<ContentBlock[]>) | undefined {
  const waterfall = (ctx as unknown as { waterfall?: unknown }).waterfall
  return typeof waterfall === 'function'
    ? (waterfall as (this: unknown, self: unknown, name: string, payload: unknown, next: () => Promise<ContentBlock[]>) => Promise<ContentBlock[]>)
    : undefined
}

export function toJsonValue(value: unknown): PtcJsonValue {
  if (value === null) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value as string | boolean
  if (type === 'number') {
    const number = value as number
    if (!Number.isFinite(number)) throw new Error('tool arguments must be lossless JSON: non-finite number')
    return number
  }
  if (Array.isArray(value)) return value.map(item => toJsonValue(item))
  if (type === 'object') {
    const source = value as Record<string, unknown>
    const result: Record<string, PtcJsonValue> = {}
    for (const [key, item] of Object.entries(source)) {
      if (item === undefined) throw new Error(`tool arguments must be lossless JSON: "${key}" is undefined`)
      result[key] = toJsonValue(item)
    }
    return result
  }
  throw new Error(`tool arguments must be lossless JSON (received ${type})`)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
