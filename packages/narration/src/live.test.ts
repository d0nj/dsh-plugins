import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  TOOL_NARRATION,
  clip,
  formatElapsed,
  formatRate,
  narrateCall,
  phaseLabel,
  splitPath,
  summarize,
} from './live.js'
import type { LiveCall } from './live.js'

function call(name: string, args: Record<string, string>, phase: 'preparing' | 'start' = 'preparing'): LiveCall {
  return {
    callId: name + '-1',
    name,
    phase,
    time: 0,
    args: {
      text: (key: string) => args[key],
    },
  }
}

describe('TOOL_NARRATION', () => {
  it('names a verb for every curated tool', () => {
    for (const [tool, narration] of Object.entries(TOOL_NARRATION)) {
      assert.ok(narration.verb.length > 0, tool + ' needs a verb')
      assert.ok(narration.keys.length > 0, tool + ' needs at least one argument key')
    }
  })
})

describe('narrateCall', () => {
  it('turns a preparing read into its target path', () => {
    const narrated = narrateCall(call('read', { path: 'src/server.rs' }))
    assert.equal(narrated.verb, 'Reading')
    assert.equal(narrated.argument, 'src/server.rs')
    assert.equal(narrated.preparing, true)
  })

  it('shows a shell command while its JSON is still streamed', () => {
    const narrated = narrateCall(call('bash', { command: 'cargo test --quiet' }))
    assert.equal(narrated.verb, 'Running')
    assert.equal(narrated.argument, 'cargo test --quiet')
  })

  it('falls back to the second path key when the first is absent', () => {
    const narrated = narrateCall(call('write', { file_path: '/tmp/out.txt' }))
    assert.equal(narrated.argument, '/tmp/out.txt')
  })

  it('keeps an unknown tool legible instead of hiding it', () => {
    const narrated = narrateCall(call('custom_probe', { query: 'find me' }))
    assert.equal(narrated.verb, 'custom probe')
    assert.equal(narrated.argument, 'find me')
  })

  it('names the wait before any argument value arrives', () => {
    const narrated = narrateCall(call('read', {}))
    assert.equal(narrated.argument, 'composing\u2026')
    assert.equal(narrated.preparing, true)
  })

  it('leaves a dispatched call with no argument empty', () => {
    assert.equal(narrateCall(call('read', {}, 'start')).argument, '')
  })

  it('stops a long argument at the limit', () => {
    const narrated = narrateCall(call('bash', { command: 'a'.repeat(400) }), 20)
    assert.equal(narrated.argument.length, 21)
    assert.ok(narrated.argument.endsWith('\u2026'))
  })

  it('marks a dispatched call as no longer preparing', () => {
    assert.equal(narrateCall(call('read', { path: 'a' }, 'start')).preparing, false)
  })
})

describe('summarize', () => {
  it('reports a tool call as the acting phase while still leading with the narration', () => {
    const summary = summarize({
      calls: [call('read', { path: 'src/live.ts' }), call('grep', { pattern: 'stream' })],
      reasoning: 'Considering the options.',
      answer: 'Reading both.',
      running: true,
    })
    assert.equal(summary.phase, 'calling')
    assert.equal(summary.calls.length, 2)
    assert.equal(summary.lead, 'Considering the options.')
  })

  it('names the leading call when the model said nothing first', () => {
    const summary = summarize({
      calls: [call('read', { path: 'src/live.ts' }), call('grep', { pattern: 'stream' })],
      reasoning: '',
      answer: '',
      running: true,
    })
    assert.equal(summary.phase, 'calling')
    assert.equal(summary.lead, 'Reading \u2026 src/live.ts +1')
  })

  it('reports writing once an answer has characters', () => {
    const summary = summarize({ calls: [], reasoning: 'hmm', answer: 'Here it is.', running: true })
    assert.equal(summary.phase, 'writing')
    assert.equal(summary.lead, 'Here it is.')
  })

  it('reports thinking from reasoning alone', () => {
    const summary = summarize({ calls: [], reasoning: 'First I check.\nThen I act.', answer: '', running: true })
    assert.equal(summary.phase, 'thinking')
    assert.equal(summary.lead, 'Then I act.')
  })

  it('distinguishes a running turn from an idle one before any token', () => {
    const idle = summarize({ calls: [], reasoning: '', answer: '', running: false })
    const working = summarize({ calls: [], reasoning: '', answer: '', running: true })
    assert.equal(idle.phase, 'idle')
    assert.equal(working.phase, 'holding')
    assert.notEqual(phaseLabel(idle.phase), phaseLabel(working.phase))
  })
})

describe('formatElapsed', () => {
  it('keeps a tenth of a second for fast work', () => {
    assert.equal(formatElapsed(428), '0.4s')
  })

  it('drops the fraction across seconds', () => {
    assert.equal(formatElapsed(41_900), '41s')
  })

  it('rolls into minutes with a padded seconds field', () => {
    assert.equal(formatElapsed(64_000), '1m04s')
  })

  it('never prints a negative or invalid duration', () => {
    assert.equal(formatElapsed(-1), '0.0s')
    assert.equal(formatElapsed(Number.NaN), '0.0s')
  })
})

describe('formatRate', () => {
  it('holds an em dash until characters arrive', () => {
    assert.equal(formatRate(0), '\u2014')
  })

  it('shows one decimal while slow and whole numbers while fast', () => {
    assert.equal(formatRate(4.25), '4.3/s')
    assert.equal(formatRate(180.4), '180/s')
  })
})

describe('clip', () => {
  it('collapses whitespace and keeps short text', () => {
    assert.equal(clip('  a\n  b  ', 40), 'a b')
  })

  it('ellipsizes past the limit', () => {
    assert.equal(clip('abcdef', 3), 'abc\u2026')
  })
})

describe('splitPath', () => {
  it('keeps the basename so a long path never hides its target', () => {
    assert.deepEqual(splitPath('packages/narration/src/client/assistant.ts'), {
      directory: 'packages/narration/src/client/',
      base: 'assistant.ts',
    })
  })

  it('handles a windows path', () => {
    assert.deepEqual(splitPath('D:\\projects\\dsh-plugins\\packages\\a.ts'), {
      directory: 'D:\\projects\\dsh-plugins\\packages\\',
      base: 'a.ts',
    })
  })

  it('returns a bare token unchanged', () => {
    assert.deepEqual(splitPath('cargo test'), { directory: '', base: 'cargo test' })
  })
})
