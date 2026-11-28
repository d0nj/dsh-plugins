import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Context } from '@deepseek-ai/cordis'

import { apply } from './client/index.js'

interface Fonts {
  fontFamilies: Record<string, string>
  fontSizes: Record<string, number>
}

interface Harness {
  readonly calls: readonly string[]
  readonly fonts: Fonts
  setDocument(value: unknown): void
}

function document(typography: Record<string, string | number> = {}): Record<string, unknown> {
  return {
    basePreset: 'none',
    tokens: {},
    typography: {
      textFontFamily: 'Inter',
      codeFontFamily: 'JetBrains Mono',
      terminalFontFamily: 'JetBrains Mono',
      fontSize: 14,
      codeFontSize: 12,
      terminalFontSize: 13,
      ...typography,
    },
    geometry: { radius: 8, density: 'comfortable' },
  }
}

function harness(initial: unknown): Harness {
  const calls: string[] = []
  const fonts: Fonts = {
    fontFamilies: { text: '"Inter"', code: '"JetBrains Mono"', terminal: '"JetBrains Mono"' },
    fontSizes: { text: 14, code: 12, terminal: 13 },
  }
  const listeners = new Set<() => void>()
  let value = initial
  const form = {
    getSnapshot: () => ({ value, revision: 1, writable: true }),
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate: async () => true,
    set: async () => true,
  }
  const theme = {
    register: () => () => {},
    overrideTokens: () => () => {},
    setFontFamily: (role: string, next: string) => {
      calls.push(`family:${role}:${next}`)
      fonts.fontFamilies[role] = next
    },
    setFontSize: (role: string, px: number) => {
      calls.push(`size:${role}:${String(px)}`)
      fonts.fontSizes[role] = px
    },
    getTheme: () => fonts,
  }
  const ctx = {
    effect: (effect: () => unknown) => effect(),
    theme,
    configForms: { get: () => form },
    slots: { inject: () => {}, register: () => () => {} },
  }
  apply(ctx as unknown as Context)
  return {
    calls,
    fonts,
    setDocument: (next: unknown) => {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

describe('client apply', () => {
  it('touches no font when the theme already matches the document', () => {
    const harnessed = harness(document())
    assert.deepEqual(harnessed.calls, [])
  })

  it('applies the document font on first load when the theme differs', () => {
    const harnessed = harness(document({ textFontFamily: 'Fira Code' }))
    assert.deepEqual(harnessed.calls, ['family:text:Fira Code'])
  })

  it('leaves typography alone when only the preset changes', () => {
    const harnessed = harness(document())
    harnessed.setDocument({ ...document(), basePreset: 'dracula' })
    assert.deepEqual(harnessed.calls, [])
  })

  it('does not clear a theme font the document leaves empty', () => {
    const harnessed = harness(document({ textFontFamily: '', codeFontFamily: '', terminalFontFamily: '' }))
    harnessed.setDocument({ ...document({ textFontFamily: '', codeFontFamily: '', terminalFontFamily: '' }), basePreset: 'nord' })
    assert.deepEqual(harnessed.calls, [])
    assert.equal(harnessed.fonts.fontFamilies.text, '"Inter"')
  })

  it('applies only the role the user changed', () => {
    const harnessed = harness(document())
    harnessed.setDocument(document({ textFontFamily: 'Fira Code' }))
    assert.deepEqual(harnessed.calls, ['family:text:Fira Code'])
  })

  it('applies a size the user changed', () => {
    const harnessed = harness(document())
    harnessed.setDocument(document({ fontSize: 18 }))
    assert.deepEqual(harnessed.calls, ['size:text:18'])
  })
})
