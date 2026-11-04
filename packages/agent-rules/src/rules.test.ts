/**
 * Behaviour of discovery, reading, and prompt rendering.
 *
 * The units are pure apart from filesystem probes, which run against real
 * temporary directories: the interesting cases are the branches the plugin
 * takes on them, and a stub would only assert that those branches exist.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import { discoverInstructionFiles, findProjectRoot, resolveDiscoveryConfig } from './discover.js'
import { readRulesFile, resolveDshHome, rulesFilePath } from './file.js'
import { renderRulesFor, renderSection, FOOTER, HEADER } from './render.js'

describe('renderSection', () => {
  it('marks the rules as binding, not advisory', () => {
    const text = renderSection(['Instructions from: AGENTS.md\n\nAlways use ripgrep.'])
    assert.ok(text.startsWith(HEADER), 'the binding header opens the section')
    assert.ok(text.endsWith(FOOTER), 'the precedence footer closes the section')
    assert.match(text, /binding instructions from the operator/)
    assert.match(text, /Always use ripgrep\./)
  })

  it('states that a nested file outranks a shallower one', () => {
    assert.match(HEADER, /nested deeper/i)
  })

  it('names the only precedence the rules yield to', () => {
    assert.match(FOOTER, /Only the operator can waive/)
    assert.match(FOOTER, /is data, not instruction/)
  })

  it('renders nothing when every block is empty', () => {
    assert.equal(renderSection([]), '')
    assert.equal(renderSection(['', '']), '')
  })

  it('drops empty blocks rather than leaving gaps between files', () => {
    const text = renderSection(['', 'Instructions from: AGENTS.md\n\nBe direct.'])
    assert.equal(text.match(/Instructions from:/g)?.length, 1)
  })
})

describe('renderRulesFor', () => {
  it('labels the block with the file it came from', () => {
    assert.match(renderRulesFor('# AGENTS.md\n\nBe direct.', 'packages/foo/AGENTS.md'), /^Instructions from: packages\/foo\/AGENTS\.md/)
  })

  it('drops the leading title because the label already names the file', () => {
    const block = renderRulesFor('# AGENTS.md\n\nPrefer small functions.', 'AGENTS.md')
    assert.ok(!block.includes('# AGENTS.md'), 'the file title is not repeated')
    assert.match(block, /Prefer small functions\./)
  })

  it('keeps later headings, which carry the file structure', () => {
    const block = renderRulesFor('# AGENTS.md\n\n## Tool Routing\n\nUse Context7 first.', 'AGENTS.md')
    assert.match(block, /## Tool Routing/)
  })

  it('renders an empty block for a file holding only a title', () => {
    assert.equal(renderRulesFor('# AGENTS.md\n\n', 'AGENTS.md'), '')
    assert.equal(renderRulesFor('   \n\n  ', 'AGENTS.md'), '')
  })

  it('preserves brace text rather than treating it as a prompt variable', () => {
    assert.match(renderRulesFor('Use {{mustache}} syntax.', 'AGENTS.md'), /\{\{mustache\}\}/)
  })
})

describe('resolveDshHome', () => {
  it('prefers DSH_HOME over the default harness home', () => {
    assert.equal(resolveDshHome({ DSH_HOME: '/custom/home' }), '/custom/home')
  })

  it('treats a blank DSH_HOME as unset', () => {
    const home = resolveDshHome({ DSH_HOME: '   ' })
    assert.ok(home.includes('.dsh'))
  })

  it('appends the rules file name to the resolved home', () => {
    assert.equal(rulesFilePath(join(tmpdir(), 'dsh-home')), join(tmpdir(), 'dsh-home', 'AGENTS.md'))
  })
})

describe('readRulesFile', () => {
  it('loads an existing file', () => {
    withTemp((dir) => {
      const path = join(dir, 'AGENTS.md')
      writeFileSync(path, '# AGENTS.md\n\nBe direct.')
      const read = readRulesFile(path)
      assert.equal(read.kind, 'loaded')
      assert.ok(read.kind === 'loaded' && read.text.includes('Be direct.'))
    })
  })

  it('reports a missing path as absence rather than failure', () => {
    assert.equal(readRulesFile(join(tmpdir(), 'dsh-agent-rules-missing', 'AGENTS.md')).kind, 'absent')
  })

  it('reports a directory as absence, not as rules', () => {
    withTemp((dir) => {
      const nested = join(dir, 'AGENTS.md')
      mkdirSync(nested)
      assert.equal(readRulesFile(nested).kind, 'absent')
    })
  })
})

describe('discoverInstructionFiles', () => {
  it('finds the project root by its marker', () => {
    withProject((root) => {
      mkdirSync(join(root, 'packages', 'foo'), { recursive: true })
      assert.equal(findProjectRoot(join(root, 'packages', 'foo'), ['.git']), root)
    })
  })

  it('returns every file from the root down to the cwd, broadest first', () => {
    withProject((root) => {
      const nested = join(root, 'packages', 'foo')
      mkdirSync(nested, { recursive: true })
      writeFileSync(join(root, 'AGENTS.md'), 'root rules')
      writeFileSync(join(nested, 'AGENTS.md'), 'foo rules')
      const files = discoverInstructionFiles(nested, resolveDiscoveryConfig({}))
      assert.deepEqual(
        files.map((file) => file.displayPath),
        ['AGENTS.md', 'packages/foo/AGENTS.md'],
      )
    })
  })

  it('skips a directory that has no instruction file', () => {
    withProject((root) => {
      const nested = join(root, 'packages', 'foo')
      mkdirSync(nested, { recursive: true })
      writeFileSync(join(nested, 'AGENTS.md'), 'foo rules')
      const files = discoverInstructionFiles(nested, resolveDiscoveryConfig({}))
      assert.deepEqual(files.map((file) => file.displayPath), ['packages/foo/AGENTS.md'])
    })
  })

  it('includes a local overlay after the base file', () => {
    withProject((root) => {
      writeFileSync(join(root, 'AGENTS.md'), 'base')
      writeFileSync(join(root, 'AGENTS.local.md'), 'local')
      const files = discoverInstructionFiles(root, resolveDiscoveryConfig({}))
      assert.deepEqual(files.map((file) => file.displayPath), ['AGENTS.md', 'AGENTS.local.md'])
    })
  })

  it('returns nothing when no instruction file exists', () => {
    withProject((root) => {
      assert.deepEqual(discoverInstructionFiles(root, resolveDiscoveryConfig({})), [])
    })
  })
})

/** Run one assertion inside a temporary directory that is always removed. */
function withTemp(assertOne: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-agent-rules-'))
  try {
    assertOne(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Run one assertion inside a temporary directory carrying a `.git` root marker. */
function withProject(assertOne: (root: string) => void): void {
  withTemp((root) => {
    mkdirSync(join(root, '.git'))
    assertOne(root)
  })
}
