import assert from 'node:assert/strict'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { buildInitPrompt, initTargetPath } from './prompt.js'

const DIRECTORY = join('/repo')

function prompt(overrides: Partial<Parameters<typeof buildInitPrompt>[0]> = {}): string {
  return buildInitPrompt({
    directory: DIRECTORY,
    fileName: 'AGENTS.md',
    focus: '',
    extraGuidance: '',
    ...overrides,
  })
}

describe('initTargetPath', () => {
  it('resolves the instruction file against the session directory', () => {
    assert.equal(initTargetPath(DIRECTORY, 'AGENTS.md'), join(DIRECTORY, 'AGENTS.md'))
  })

  it('keeps a nested target nested', () => {
    assert.equal(
      initTargetPath(DIRECTORY, 'packages/app/AGENTS.md'),
      join(DIRECTORY, 'packages', 'app', 'AGENTS.md'),
    )
  })
})

describe('buildInitPrompt', () => {
  it('names the concrete target path the agent must write', () => {
    assert.ok(prompt().includes(`Target file: ${join(DIRECTORY, 'AGENTS.md')}`))
  })

  it('honours a configured file name everywhere the brief refers to it', () => {
    const text = prompt({ fileName: 'CLAUDE.md' })
    assert.ok(text.includes('Create or update CLAUDE.md'), 'opening sentence names the file')
    assert.ok(text.includes(join(DIRECTORY, 'CLAUDE.md')), 'target path uses the file')
    assert.ok(!text.includes('AGENTS.md already exists'), 'existing-file clause follows the configured name')
  })

  it('states where the harness reads instruction files, including the user-global file', () => {
    const text = prompt()
    assert.ok(text.includes('nearest ancestor holding .git'), 'project root rule')
    assert.ok(text.includes('AGENTS.local.md'), 'local overlay names')
    assert.ok(text.includes('~/.dsh/AGENTS.md'), 'user-global destination for non-repo preferences')
  })

  it('tells the agent to improve an existing file rather than overwrite it', () => {
    assert.ok(prompt().includes('improve it in place'))
  })

  it('omits the focus section when the invocation carried no argument', () => {
    assert.ok(!prompt().includes('## Focus for this pass'))
  })

  it('omits the focus section when the argument is only whitespace', () => {
    assert.ok(!prompt({ focus: '   \n\t ' }).includes('## Focus for this pass'))
  })

  it('carries the user focus verbatim, trimmed', () => {
    const text = prompt({ focus: '  focus on the release pipeline  ' })
    assert.ok(text.includes('## Focus for this pass'))
    assert.ok(text.endsWith('focus on the release pipeline'))
  })

  it('leaves operator prose untouched, including template syntax', () => {
    const extraGuidance = 'Use {{template}} braces and $ARGUMENTS literally.'
    assert.ok(prompt({ extraGuidance }).includes(extraGuidance))
  })

  it('omits the guidance section when the row sets none', () => {
    assert.ok(!prompt().includes('## Additional guidance'))
  })

  it('orders the brief, then the focus, then operator guidance', () => {
    const text = prompt({ focus: 'the tests', extraGuidance: 'Prefer node:test.' })
    const brief = text.indexOf('## How to investigate')
    const focus = text.indexOf('## Focus for this pass')
    const guidance = text.indexOf('## Additional guidance')
    assert.ok(brief >= 0 && brief < focus, 'fixed brief precedes the focus')
    assert.ok(focus < guidance, 'focus precedes operator guidance')
  })
})
