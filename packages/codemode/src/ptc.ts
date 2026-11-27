import type { Context } from '@deepseek-ai/cordis'

export type PtcJsonValue = null | boolean | number | string | PtcJsonValue[] | { [key: string]: PtcJsonValue }

export interface PtcRunSandbox {
  readonly mode: string
  readonly denied: boolean
  readonly enforcement?: string
}

export interface PtcRunFailure {
  readonly kind: string
  readonly message: string
}

export interface PtcRunResult {
  readonly sandbox?: PtcRunSandbox
  readonly value?: PtcJsonValue
  readonly logs: string[]
  readonly error?: PtcRunFailure
}

export type PtcBindingFunction = (args: unknown) => Promise<PtcJsonValue>

export interface PtcBindingNamespace {
  readonly global: string
  readonly functions: Record<string, PtcBindingFunction>
  readonly errorClass?: { readonly name: string; readonly memberNameProperty: string }
}

export interface PtcRunRequest {
  readonly program: string
  readonly stateOwner?: object
  readonly bindings: PtcBindingNamespace[]
  readonly cwd?: string
  readonly timeoutMs?: number | null
  readonly sandboxPolicy?: SandboxExecutionPolicy
  readonly signal?: AbortSignal
}

export interface PtcRunSpec extends PtcRunRequest {
  readonly cwd: string
  readonly timeoutMs: number | null
}

export interface PtcRuntimePort {
  readonly language: string
  readonly isolation: string
  readonly retainsState?: boolean
  release?(owner: object): Promise<void>
  resolve(request: PtcRunRequest): PtcRunSpec
  run(spec: PtcRunSpec): Promise<PtcRunResult>
}

export interface SandboxExecutionPolicy {
  readonly mode: 'read-only' | 'workspace-write' | 'danger-full-access'
  readonly workspaceRoot: string
  readonly additionalWritableRoots?: readonly string[]
  readonly sessionId?: string
}

export interface SandboxPolicyPort {
  resolve(request?: { session?: unknown; mode?: SandboxExecutionPolicy['mode'] }): SandboxExecutionPolicy
}

export interface WorkingDirectoryPort {
  get(session: unknown): string
  ensure(agent: unknown, signal?: AbortSignal): Promise<string>
}

export function readPtcRuntime(ctx: Context): PtcRuntimePort | undefined {
  const runtime = getService(ctx, 'ptcRuntime')
  if (runtime === undefined) return undefined
  const candidate = runtime as Partial<PtcRuntimePort>
  if (typeof candidate.resolve !== 'function' || typeof candidate.run !== 'function') return undefined
  return candidate as PtcRuntimePort
}

export function readSandboxPolicy(ctx: Context): SandboxPolicyPort | undefined {
  const policy = getService(ctx, 'sandboxPolicy') as Partial<SandboxPolicyPort> | undefined
  return policy !== undefined && typeof policy.resolve === 'function' ? (policy as SandboxPolicyPort) : undefined
}

export function readWorkingDirectory(ctx: Context): WorkingDirectoryPort | undefined {
  const directory = getService(ctx, 'workingDirectory') as Partial<WorkingDirectoryPort> | undefined
  return directory !== undefined && typeof directory.ensure === 'function' ? (directory as WorkingDirectoryPort) : undefined
}

export function getService(ctx: Context, name: string): unknown {
  return (ctx as unknown as { get(key: string): unknown }).get(name)
}

export function isPtcRuntimeError(value: unknown): value is PtcRunFailure {
  return typeof value === 'object' && value !== null && typeof (value as PtcRunFailure).kind === 'string' && typeof (value as PtcRunFailure).message === 'string'
}
