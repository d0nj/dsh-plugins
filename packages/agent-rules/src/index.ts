/**
 * Plugin entry: AGENTS.md files as binding system-prompt sections.
 *
 * The same files already reach every agent through
 * `@deepseek-ai/dsh-agent-instructions`, but that row injects them as a
 * **user-role system-reminder** introduced as guidance a more specific
 * instruction may outrank. Models act on that framing by dropping rules they
 * find inconvenient. This row reads the same files and registers them with
 * `ctx.systemPrompt`, which renders into the system message where they carry
 * system authority. The shipped row is expected to be disabled alongside this
 * one so each file is presented exactly once.
 *
 * Three choices carry the weight:
 *
 * - **A scoped section per agent.** The repository chain depends on the
 *   session's working directory, so each agent gets its own registration
 *   through `agent.ctx` rather than one global section that could only ever
 *   guess. A scoped section shadows a global one of the same name.
 * - **A section name of its own.** `deployment:persona-prefix` is the obvious
 *   slot for extra policy, but agent presets shadow that name on purpose, so
 *   rules placed there vanish in any preset that sets a persona. A fresh name
 *   cannot be shadowed by accident.
 * - **`interpolate: false`.** Prompt sections resolve `{{name}}` references and
 *   throw on an unknown one. Rules are operator prose that may legitimately
 *   contain braces, so the text is registered literal; a stray `{{` must never
 *   break prompt assembly for a session.
 *
 * @module @d0nj/dsh-agent-rules
 */
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-agent'
import '@deepseek-ai/dsh-system-prompt'
import '@deepseek-ai/dsh-working-directory'
import z from '@deepseek-ai/schemastery'

import { discoverInstructionFiles, resolveDiscoveryConfig } from './discover.js'
import { readRulesFile, resolveDshHome, rulesFilePath } from './file.js'
import { renderRulesFor, renderSection } from './render.js'

/** Cordis plugin name — also the profile patch row id. */
export const name = 'agent-rules'

/** Services this row relies on. */
export const inject = ['systemPrompt', 'workingDirectory']

/** Section name, unique to this row so no preset shadowing can hide the rules. */
export const RULES_SECTION = 'agent-rules:instructions'

/**
 * Placement immediately after the deployment persona and before every tool
 * section: high in the prompt, where a standing instruction reads as scope for
 * the work rather than as one more tool note.
 */
const SECTION_ORDER = 1

/** Runtime schema for the rules row. */
export const Config = z.object({
  rulesFile: z.string().description('Absolute path to the user-global rules file; omit to read AGENTS.md from the harness home.'),
  includeProjectFiles: z.boolean().default(true).description('Also register AGENTS.md files from the project root down to the session directory.'),
  projectRootMarkers: z.array(z.string()).description('Child names that identify a project root; defaults to .git.'),
  instructionFileCandidates: z.array(z.string()).description('Instruction file names per directory; defaults to AGENTS.md and CLAUDE.md.'),
  localInstructionFileCandidates: z.array(z.string()).description('Overlay file names per directory; defaults to AGENTS.local.md and CLAUDE.local.md.'),
})

/** Resolved row configuration. */
export interface PluginConfig {
  rulesFile?: string | undefined
  includeProjectFiles?: boolean | undefined
  projectRootMarkers?: string[] | undefined
  instructionFileCandidates?: string[] | undefined
  localInstructionFileCandidates?: string[] | undefined
}

/**
 * Absolute path of the user-global rules file.
 * @param rulesFile - configured path, if any.
 * @returns the resolved path.
 */
export function globalRulesPath(rulesFile: string | undefined): string {
  const explicit = rulesFile?.trim()
  return explicit !== undefined && explicit.length > 0 ? explicit : rulesFilePath(resolveDshHome())
}

/**
 * Register the rules section for every agent in the composition.
 *
 * A missing file is the ordinary unconfigured state and contributes nothing. An
 * unreadable or empty global file is reported once at load, because either
 * silently leaves agents without rules the operator believes are in force.
 * @param ctx - host context carrying the prompt registry.
 * @param config - the row's configuration.
 */
export function apply(ctx: Context, config: PluginConfig): void {
  const logger = ctx.logger(name)
  const discovery = resolveDiscoveryConfig({
    ...(config.projectRootMarkers === undefined ? {} : { projectRootMarkers: config.projectRootMarkers }),
    ...(config.instructionFileCandidates === undefined
      ? {}
      : { instructionFileCandidates: config.instructionFileCandidates }),
    ...(config.localInstructionFileCandidates === undefined
      ? {}
      : { localInstructionFileCandidates: config.localInstructionFileCandidates }),
  })
  const globalPath = globalRulesPath(config.rulesFile)
  const globalRead = readRulesFile(globalPath)
  const globalBlock = globalRead.kind === 'loaded' ? renderRulesFor(globalRead.text, 'AGENTS.md') : ''

  switch (globalRead.kind) {
    case 'unreadable':
      logger.warn('user-global rules file at %s is unreadable; its rules are not in force: %o', globalPath, globalRead.error)
      break
    case 'loaded':
      if (globalBlock.length === 0) logger.warn('user-global rules file at %s holds no rules', globalPath)
      break
    case 'absent':
      logger.debug('no user-global rules file at %s', globalPath)
      break
  }

  const includeProjectFiles = config.includeProjectFiles ?? true

  ctx.on('agent/created', ({ agent }) => {
    const blocks = globalBlock.length > 0 ? [globalBlock] : []
    if (includeProjectFiles) {
      const cwd = ctx.workingDirectory.get(agent.session)
      for (const file of discoverInstructionFiles(cwd, discovery)) {
        const read = readRulesFile(file.absolutePath)
        if (read.kind !== 'loaded') continue
        const block = renderRulesFor(read.text, file.displayPath)
        if (block.length > 0) blocks.push(block)
      }
    }

    const text = renderSection(blocks)
    if (text.length === 0) return undefined

    // Registering through the agent context makes the section scoped to that
    // agent, and its `inject` inherits from this plugin's fiber.
    agent.ctx.effect(
      () =>
        agent.ctx.systemPrompt.section({
          name: RULES_SECTION,
          order: SECTION_ORDER,
          text,
          interpolate: false,
        }),
      'agent-rules.section()',
    )
    return undefined
  })
}
