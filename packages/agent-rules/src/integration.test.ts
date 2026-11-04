/**
 * Integration: a rules section registered at `agent/created` reaches assembly.
 *
 * The unit suites prove rendering and discovery in isolation. This proves the
 * seam actually used — a real `SystemPrompt` registry, a real `agent/created`
 * event, and a scoped section — because the failure worth catching is a
 * section registered in the wrong scope, which no unit test would notice.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { Context } from '@deepseek-ai/cordis'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'

import { apply } from './index.js'

/** Minimal agent scope: a disposable child context, which is what the plugin registers through. */
interface FakeAgent {
  readonly session: unknown
  readonly ctx: Context
}

/**
 * Mount the real registry and plugin, then announce one agent.
 * @param options - rules file path and session directory.
 * @returns the host context and the agent scope to assemble for.
 */
async function mount(options: { globalRules: string; cwd: string }): Promise<{ ctx: Context; agent: FakeAgent }> {
  const ctx = new Context()
  ctx.provide('workingDirectory', { get: () => options.cwd })
  await ctx.plugin(SystemPrompt)
  await ctx.plugin({
    name: 'agent-rules',
    apply: (child: Context) => apply(child, { rulesFile: options.globalRules }),
  })

  const agentCtx = ctx.extend({ label: 'fake-agent' })
  const agent: FakeAgent = { session: {}, ctx: agentCtx }
  emitUnchecked(ctx, 'agent/created', { agent, source: 'user' })
  return { ctx, agent }
}

/** Dispatch an event without constructing the real Agent/Session those payloads need. */
function emitUnchecked(ctx: Context, name: string, payload: unknown): void {
  ;(ctx as unknown as { emit: (event: string, payload: unknown) => void }).emit(name, payload)
}

/**
 * Assemble and render the prompt for one agent scope.
 * @param ctx - host context holding the registry.
 * @param agent - agent whose scope to assemble.
 * @returns the rendered system prompt.
 */
async function promptOf(ctx: Context, agent: FakeAgent): Promise<string> {
  return renderPrompt(await ctx.systemPrompt.assemble({ scope: agent.ctx }))
}

describe('agent-rules assembly', () => {
  it('renders the user-global rules into the assembled prompt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-agent-rules-it-'))
    try {
      const globalRules = join(dir, 'AGENTS.md')
      writeFileSync(globalRules, '# AGENTS.md\n\nAlways prefer ripgrep.')
      const { ctx, agent } = await mount({ globalRules, cwd: dir })
      assert.match(await promptOf(ctx, agent), /Always prefer ripgrep\./)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('keeps brace text literal instead of failing interpolation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-agent-rules-it-'))
    try {
      const globalRules = join(dir, 'AGENTS.md')
      writeFileSync(globalRules, 'Only write {{mustache}} for templates.')
      const { ctx, agent } = await mount({ globalRules, cwd: dir })
      assert.match(await promptOf(ctx, agent), /\{\{mustache\}\}/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('contributes nothing when no rules file exists', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-agent-rules-it-'))
    try {
      const { ctx, agent } = await mount({ globalRules: join(dir, 'missing.md'), cwd: dir })
      assert.ok(!(await promptOf(ctx, agent)).includes('binding instructions from the operator'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
