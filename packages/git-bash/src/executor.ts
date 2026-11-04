/**
 * Git Bash executor over the `ctx.shell` seam.
 *
 * The shipped Windows stack mounts a PowerShell executor, and its bash
 * counterpart hardcodes a bare `bash`. This executor keeps the shipped local
 * mechanics — deadlines, bounded output with spill files, kill escalation, and
 * the model-facing output merge — and replaces only the argv, so the `bash`
 * tool behaves exactly like the shipped one.
 *
 * It does not confine commands. The Windows sandbox runner cannot start Git
 * Bash at all: the restricted token denies the signal pipe MSYS needs, so a
 * confined call dies before the command runs. `sandboxMode` is therefore left
 * undefined, which makes the tool omit escalation fields instead of advertising
 * confinement it cannot provide.
 *
 * @module @d0nj/dsh-git-bash/executor
 */
import { LocalBashExecutor } from '@deepseek-ai/dsh-bash-local'
import type { Config as LocalConfig } from '@deepseek-ai/dsh-bash-local'
import type { ShellExecSpec } from '@deepseek-ai/dsh-shell'
import type { Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { diagnose, resolveBash } from './resolve.js'

/** The executor's configuration: the shipped local budgets plus an executable override. */
export interface GitBashConfig extends LocalConfig {
  /**
   * Explicit `bash.exe`. Omitted, the executor uses `GITBASH_PATH`, then the
   * Git for Windows install locations, then `bash` from PATH.
   */
  bashPath: Volatile<string | undefined>
}

/**
 * Git Bash executor.
 *
 * `inject` is inherited: the shipped local executor needs `ctx.subprocess` and
 * nothing else, so background jobs, timeouts, and output caps come from the
 * composition rather than from this plugin.
 */
export class GitBashExecutor extends LocalBashExecutor {
  static override Config = z.object({
    bashPath: z
      .string()
      .volatile()
      .description(
        'Explicit bash.exe. Omit to use GITBASH_PATH, then the Git for Windows install locations, then bash from PATH.',
      ),
    cwd: z.string().volatile(),
    timeoutMs: z.number().default(120000).volatile(),
    maxTimeoutMs: z.number().default(600000).volatile(),
    maxOutputBytes: z.number().default(64000).volatile(),
    maxSpillBytes: z.number().default(64 * 1024 * 1024).volatile(),
    graceMs: z.number().default(3000).volatile(),
  })

  declare readonly config: GitBashConfig

  /**
   * Resolve the executable for one command.
   *
   * A plain private method, not `#executable`: Cordis resolves a service through
   * a proxy whose receiver is not the instance, and an ECMAScript `#private`
   * member called through that proxy throws "Receiver must be an instance".
   * @returns the executable to spawn.
   */
  private executable(): string {
    const resolved = resolveBash({ configured: this.config.bashPath.get() })
    const note = diagnose(resolved)
    if (note !== undefined) this.ctx.logger('git-bash').info(note)
    return resolved.executable
  }

  /**
   * Run the command as `<bash> -c <command>`.
   * @param spec - a spec from {@link resolve}, never a raw request.
   * @returns the live execution handle.
   */
  override execute(spec: ShellExecSpec): ReturnType<LocalBashExecutor['execute']> {
    return this.executeArgv(spec, [this.executable(), '-c', spec.command])
  }
}

export default GitBashExecutor
