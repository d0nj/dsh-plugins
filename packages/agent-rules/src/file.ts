/**
 * Resolve and read the user-global rules file.
 *
 * `~/.dsh/AGENTS.md` reaches an agent today only through
 * `@deepseek-ai/dsh-agent-instructions`, which delivers it as a **user-role
 * system-reminder** introduced with "may be relevant to your work… use them as
 * guidance when applicable. More specific instructions take precedence". That
 * framing is what lets a model drop a rule it dislikes: the file is presented
 * as advisory context that any more specific sentence may outrank.
 *
 * This module supplies the same bytes for a system-prompt section instead, so
 * the rules carry the authority of a system instruction.
 *
 * The read is synchronous and runs once per activation. The file is operator
 * configuration of a few kilobytes, and doing it synchronously lets `apply`
 * register the section before the first prompt is assembled, with no window in
 * which a session could start without its rules.
 *
 * @module @d0nj/dsh-agent-rules/file
 */
import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Environment variable that relocates the harness home, matching `dsh-home-paths`. */
const DSH_HOME_ENV = 'DSH_HOME'

/** File name read from the harness home. */
const RULES_FILE = 'AGENTS.md'

/**
 * Resolve the harness home the same way the rest of the Harness does.
 *
 * Precedence is `$DSH_HOME` then `~/.dsh`; an empty or whitespace-only override
 * is treated as unset so a blank variable never resolves to the process cwd.
 * @param env - environment mapping to read.
 * @returns the absolute harness home.
 */
export function resolveDshHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env[DSH_HOME_ENV]?.trim()
  return override !== undefined && override.length > 0 ? override : join(homedir(), '.dsh')
}

/**
 * Absolute path of the user-global rules file.
 * @param dshHome - resolved harness home.
 * @returns the file path inside the harness home.
 */
export function rulesFilePath(dshHome: string): string {
  return join(dshHome, RULES_FILE)
}

/**
 * Outcome of one read: content, a clean absence, or an unreadable file.
 *
 * Absence and failure are distinct because they call for different reporting.
 * A missing file is the ordinary "not configured" state and stays silent; a
 * file that exists but cannot be read is the only case worth a warning,
 * because its rules would otherwise be dropped with no trace.
 */
export type RulesRead =
  | { readonly kind: 'loaded'; readonly text: string }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly error: unknown }

/**
 * Read the rules file, collapsing every failure into a value.
 * @param path - absolute rules path.
 * @returns the loaded text, a clean absence, or the failure.
 */
export function readRulesFile(path: string): RulesRead {
  try {
    if (!statSync(path).isFile()) return { kind: 'absent' }
    return { kind: 'loaded', text: readFileSync(path, 'utf8') }
  } catch (error) {
    return isMissing(error) ? { kind: 'absent' } : { kind: 'unreadable', error }
  }
}

/**
 * Whether an error means the path does not exist.
 * @param error - thrown read or stat value.
 * @returns true for `ENOENT`/`ENOTDIR`.
 */
function isMissing(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) return false
  return error.code === 'ENOENT' || error.code === 'ENOTDIR'
}
