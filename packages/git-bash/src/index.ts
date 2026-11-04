/**
 * Plugin entry: registers the Git Bash executor as `ctx.shell`.
 *
 * The export shape is the shipped executor's shape — a service class as the
 * default export, no `apply` — because `ctx.shell` is a single-implementation
 * service: subclassing `ShellExecutor` *is* the registration, and the host's
 * `bash` tool resolves whatever implementation occupies that slot.
 *
 * @module @d0nj/dsh-git-bash
 */
export { GitBashExecutor, GitBashExecutor as default } from './executor.js'
export type { GitBashConfig } from './executor.js'
export { candidateExists, diagnose, installRoots, resolveBash } from './resolve.js'
export type { BashOrigin, ResolvedBash } from './resolve.js'
