/**
 * Git Bash executable resolution for Windows.
 *
 * The shipped bash executor spawns a bare `bash` and relies on PATH. A desktop
 * application does not necessarily inherit the PATH a developer's terminal has,
 * and Git for Windows is often installed outside `Program Files`, so the
 * executor probes the usual install shapes instead of trusting the first
 * `bash` that happens to resolve.
 *
 * Pure functions only: environment, platform, and the filesystem probe are
 * parameters, so every branch is testable without a Windows machine.
 *
 * @module @d0nj/dsh-git-bash/resolve
 */
import { lstatSync } from 'node:fs'
import { join } from 'node:path'

/** How the executable was chosen; surfaced in a diagnostic. */
export type BashOrigin = 'config' | 'environment' | 'install' | 'path'

/** One resolved bash executable and the rule that selected it. */
export interface ResolvedBash {
  /** Executable to spawn: an absolute path, or the bare name `bash`. */
  readonly executable: string
  readonly origin: BashOrigin
}

/** Relative locations of a Git for Windows shell below one install root. */
const BASH_SUFFIXES: readonly string[] = [
  join('Git', 'bin', 'bash.exe'),
  join('Git', 'usr', 'bin', 'bash.exe'),
  join('Git', 'usr', 'bin', 'sh.exe'),
]

/** A spawnable-filesystem probe; narrowed so tests can supply one. */
export type Exists = (path: string) => { isFile(): boolean; isSymbolicLink(): boolean }

/**
 * Roots worth probing for a Git for Windows installation, most specific first.
 *
 * `ProgramW6432` and `ProgramFiles(x86)` cover the 32-bit view some installers
 * target; `LOCALAPPDATA\Programs` covers a per-user install.
 *
 * @param env - the environment to read.
 * @returns candidate install roots, without duplicates.
 */
export function installRoots(env: NodeJS.ProcessEnv): string[] {
  const roots: string[] = []
  const add = (candidate: string | undefined): void => {
    if (candidate === undefined) return
    const trimmed = candidate.trim().replace(/^"+|"+$/g, '')
    if (trimmed.length > 0 && !roots.includes(trimmed)) roots.push(trimmed)
  }
  add(env.ProgramFiles)
  add(env.ProgramW6432)
  add(env['ProgramFiles(x86)'])
  add(env.LOCALAPPDATA === undefined ? undefined : join(env.LOCALAPPDATA, 'Programs'))
  return roots
}

/**
 * Whether a candidate can be spawned.
 *
 * `lstat` is used rather than `stat` so a reparse point resolves to itself: a
 * probe that followed a link could accept an entry whose target is missing.
 *
 * @param candidate - absolute path to test.
 * @param probe - filesystem probe, replaceable in tests.
 * @returns whether the candidate is a file or a symlink.
 */
export function candidateExists(candidate: string, probe: Exists = lstatSync): boolean {
  try {
    const stat = probe(candidate)
    return stat.isFile() || stat.isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Resolve the bash executable to spawn.
 *
 * Order, and why each rung exists:
 *
 * 1. `configured` — an operator naming the exact program always wins.
 * 2. `GITBASH_PATH` — an escape hatch for a portable install without editing config.
 * 3. Well-known install locations — the normal case, where the desktop process
 *    inherits a PATH without Git's `bin` directory on it.
 * 4. A bare `bash` — left to the subprocess seam's own PATH lookup.
 *
 * @param options - explicit override and probe inputs.
 * @returns the executable and the rule that selected it.
 */
export function resolveBash(options: {
  readonly configured?: string | undefined
  readonly env?: NodeJS.ProcessEnv | undefined
  readonly platform?: NodeJS.Platform | undefined
  readonly probe?: Exists | undefined
}): ResolvedBash {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const probe = options.probe ?? lstatSync

  const configured = options.configured?.trim()
  if (configured !== undefined && configured.length > 0) return { executable: configured, origin: 'config' }

  const fromEnvironment = env.GITBASH_PATH?.trim()
  if (fromEnvironment !== undefined && fromEnvironment.length > 0) return { executable: fromEnvironment, origin: 'environment' }

  if (platform === 'win32') {
    for (const root of installRoots(env)) {
      for (const suffix of BASH_SUFFIXES) {
        const candidate = join(root, suffix)
        if (candidateExists(candidate, probe)) return { executable: candidate, origin: 'install' }
      }
    }
  }

  return { executable: 'bash', origin: 'path' }
}

/**
 * Describe a resolution worth reporting once.
 * @param resolved - the executable chosen for this executor.
 * @returns a log message, or `undefined` when the choice needs no comment.
 */
export function diagnose(resolved: ResolvedBash): string | undefined {
  if (resolved.origin === 'install') return `using Git Bash at ${resolved.executable}`
  if (resolved.origin === 'path') return 'no Git for Windows installation found; using bash from PATH'
  return undefined
}
