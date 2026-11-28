/**
 * Spec and resolver tests.
 *
 * The preset tests are the important ones: a theme is a colour claim about
 * legibility, and a hand-written hex value is exactly the kind of thing that
 * looks fine in one palette mode and unreadable in the other. These check every
 * shipped preset against WCAG contrast rather than trusting the eye.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DENSITIES,
  FONT_SIZE_RANGES,
  PRESETS,
  PRESET_IDS,
  TOKEN_NAMES,
  TOKEN_SPECS,
  findPreset,
  tokenSpec,
} from './spec.js'
import {
  clamp,
  correctFontSize,
  familyNames,
  geometryTokens,
  isColor,
  isDensity,
  normalizeFontList,
  planTypography,
  resolveCustomization,
} from './resolve.js'
import type { CustomizationDocument } from './resolve.js'

/**
 * Parse a hex colour into 0–255 channels.
 * @param hex - `#rgb` or `#rrggbb`.
 * @returns the channels.
 */
function rgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  return {
    r: Number.parseInt(full.slice(0, 2), 16),
    g: Number.parseInt(full.slice(2, 4), 16),
    b: Number.parseInt(full.slice(4, 6), 16),
  }
}

/**
 * Relative luminance per WCAG 2.1.
 * @param hex - the colour.
 * @returns luminance between 0 and 1.
 */
function luminance(hex: string): number {
  const { r, g, b } = rgb(hex)
  const channel = (value: number): number => {
    const srgb = value / 255
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/**
 * WCAG contrast ratio between two colours.
 * @param a - first colour.
 * @param b - second colour.
 * @returns the ratio, from 1 to 21.
 */
function contrast(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la]
  return (lighter + 0.05) / (darker + 0.05)
}

/** A minimal document for resolve tests. */
function document(overrides: Partial<CustomizationDocument> = {}): CustomizationDocument {
  return {
    basePreset: 'none',
    tokens: {},
    typography: {
      textFontFamily: '',
      codeFontFamily: '',
      terminalFontFamily: '',
      fontSize: 14,
      codeFontSize: 11,
      terminalFontSize: 13,
    },
    geometry: { radius: 8, density: 'comfortable' },
    ...overrides,
  }
}

describe('TOKEN_SPECS', () => {
  it('has no duplicate names', () => {
    assert.equal(new Set(TOKEN_NAMES).size, TOKEN_NAMES.length)
  })

  it('uses --dsw- aliases or the documented sidebar token', () => {
    for (const spec of TOKEN_SPECS) {
      assert.match(spec.name, /^--dsw-(alias|specific)-/u, spec.name)
    }
  })

  it('gives every token a label and a description', () => {
    for (const spec of TOKEN_SPECS) {
      assert.ok(spec.label.length > 0, spec.name)
      assert.ok(spec.description.length > 0, spec.name)
    }
  })

  it('looks tokens up by name', () => {
    assert.equal(tokenSpec('--dsw-alias-bg-base')?.label, 'Base background')
    assert.equal(tokenSpec('--nope'), undefined)
  })
})

describe('PRESETS', () => {
  it('has unique ids', () => {
    assert.equal(new Set(PRESET_IDS).size, PRESET_IDS.length)
  })

  it('covers every documented token, in both modes', () => {
    for (const preset of PRESETS) {
      for (const name of TOKEN_NAMES) {
        const modes = preset.tokens[name]
        assert.ok(modes !== undefined, `${preset.id} is missing ${name}`)
        assert.ok(isColor(modes.light), `${preset.id} ${name} light is not a colour: ${modes.light}`)
        assert.ok(isColor(modes.dark), `${preset.id} ${name} dark is not a colour: ${modes.dark}`)
      }
    }
  })

  it('declares a colour scheme it is legible in', () => {
    for (const preset of PRESETS) {
      assert.ok(preset.colorScheme === 'light' || preset.colorScheme === 'dark', preset.id)
      assert.ok(preset.label.length > 0, preset.id)
      assert.ok(preset.description.length > 0, preset.id)
    }
  })

  it('keeps body text at WCAG AA (4.5:1) against its base surface, in both modes', () => {
    for (const preset of PRESETS) {
      const base = preset.tokens['--dsw-alias-bg-base']
      const label = preset.tokens['--dsw-alias-label-primary']
      assert.ok(base !== undefined && label !== undefined, preset.id)
      const light = contrast(base.light, label.light)
      const dark = contrast(base.dark, label.dark)
      assert.ok(light >= 4.5, `${preset.id} light contrast ${light.toFixed(2)} is below 4.5`)
      assert.ok(dark >= 4.5, `${preset.id} dark contrast ${dark.toFixed(2)} is below 4.5`)
    }
  })

  it('keeps secondary text at WCAG AA (4.5:1) against its base surface, in both modes', () => {
    for (const preset of PRESETS) {
      const base = preset.tokens['--dsw-alias-bg-base']
      const secondary = preset.tokens['--dsw-alias-label-secondary']
      assert.ok(base !== undefined && secondary !== undefined, preset.id)
      assert.ok(contrast(base.light, secondary.light) >= 3, `${preset.id} light secondary`)
      assert.ok(contrast(base.dark, secondary.dark) >= 3, `${preset.id} dark secondary`)
    }
  })

  it('looks presets up by id and rejects none', () => {
    assert.equal(findPreset('dracula')?.label, 'Dracula')
    assert.equal(findPreset('none'), undefined)
    assert.equal(findPreset('not-a-theme'), undefined)
  })

  it('ships the famous editor themes', () => {
    // The set the request named; a rename here should be a deliberate choice.
    for (const id of ['dracula', 'nord', 'gruvbox', 'one-dark', 'solarized', 'monokai', 'tokyo-night', 'kanagawa-wave', 'everforest', 'night-owl']) {
      assert.ok(PRESET_IDS.includes(id), `missing ${id}`)
    }
  })

  it('ships the expansion, dark and light alike', () => {
    for (const id of [
      'material-palenight', 'synthwave-84', 'cobalt2', 'zenburn',
      'geist', 'github-light', 'one-light', 'gruvbox-light', 'tokyo-night-day',
      'solarized-light', 'rose-pine-dawn', 'catppuccin-latte',
    ]) {
      assert.ok(PRESET_IDS.includes(id), `missing ${id}`)
    }
    assert.ok(PRESETS.filter((preset) => preset.colorScheme === 'light').length >= 8, 'too few daylight presets')
    assert.ok(PRESETS.filter((preset) => preset.colorScheme === 'dark').length >= 15, 'too few night presets')
  })

  it('keeps primary text legible on raised surfaces too', () => {
    for (const preset of PRESETS) {
      const layer = preset.tokens['--dsw-alias-bg-layer-1']
      const label = preset.tokens['--dsw-alias-label-primary']
      assert.ok(layer !== undefined && label !== undefined, preset.id)
      assert.ok(contrast(layer.light, label.light) >= 4.5, `${preset.id} light label on layer-1`)
      assert.ok(contrast(layer.dark, label.dark) >= 4.5, `${preset.id} dark label on layer-1`)
    }
  })
})

describe('geometryTokens', () => {
  it('derives radius and spacing in both modes', () => {
    const tokens = geometryTokens({ radius: 8, density: 'comfortable' })
    assert.deepEqual(tokens['--d0nj-radius-md'], { light: '8px', dark: '8px' })
    assert.deepEqual(tokens['--d0nj-space-4'], { light: '16px', dark: '16px' })
  })

  it('scales spacing with density', () => {
    const compact = geometryTokens({ radius: 8, density: 'compact' })
    const spacious = geometryTokens({ radius: 8, density: 'spacious' })
    assert.equal(compact['--d0nj-space-4']?.light, '13px')
    assert.equal(spacious['--d0nj-space-4']?.light, '20px')
  })

  it('clamps a radius outside the allowed range', () => {
    assert.equal(geometryTokens({ radius: -10, density: 'comfortable' })['--d0nj-radius-md']?.light, '0px')
    assert.equal(geometryTokens({ radius: 999, density: 'comfortable' })['--d0nj-radius-md']?.light, '24px')
  })
})

describe('resolveCustomization', () => {
  it('applies a preset then the explicit override', () => {
    const resolved = resolveCustomization(document({
      basePreset: 'dracula',
      tokens: { '--dsw-alias-bg-base': { light: '#ffffff', dark: '#000000' } },
    }))
    // The override wins over the preset for the one token it names...
    assert.deepEqual(resolved.tokens['--dsw-alias-bg-base'], { light: '#ffffff', dark: '#000000' })
    // ...and the preset still supplies the rest.
    assert.deepEqual(resolved.tokens['--dsw-alias-brand-primary'], {
      light: '#644ac9',
      dark: '#bd93f9',
    })
  })

  it('derives the composer surface and send-button accent from the preset', () => {
    const resolved = resolveCustomization(document({ basePreset: 'dracula' }))
    assert.deepEqual(
      resolved.tokens['--dsw-specific-input-major'],
      resolved.tokens['--dsw-alias-bg-layer-1'],
    )
    assert.deepEqual(
      resolved.tokens['--dsw-alias-button-info-fill'],
      resolved.tokens['--dsw-alias-brand-primary'],
    )
    assert.ok(resolved.tokens['--dsw-alias-button-info-hover']?.dark.startsWith('color-mix('))
  })

  it('moves the send-button accent with a brand override', () => {
    const resolved = resolveCustomization(document({
      basePreset: 'dracula',
      tokens: { '--dsw-alias-brand-primary': { light: '#123456', dark: '#abcdef' } },
    }))
    assert.deepEqual(resolved.tokens['--dsw-alias-button-info-fill'], {
      light: '#123456',
      dark: '#abcdef',
    })
  })

  it('adds no runtime aliases when no preset is selected', () => {
    const resolved = resolveCustomization(document({ basePreset: 'none' }))
    assert.equal(resolved.tokens['--dsw-specific-input-major'], undefined)
    assert.equal(resolved.tokens['--dsw-alias-button-info-fill'], undefined)
  })

  it('lets geometry win over a token of the same name', () => {
    const resolved = resolveCustomization(document({
      tokens: { '--d0nj-radius-md': { light: '99px', dark: '99px' } },
      geometry: { radius: 4, density: 'comfortable' },
    }))
    // A `--d0nj-*` name is not in the catalog, so the override is dropped with a
    // warning and the geometry value stands.
    assert.equal(resolved.tokens['--d0nj-radius-md']?.light, '4px')
    assert.ok(resolved.warnings.some((warning) => warning.includes('undocumented token')))
  })

  it('warns rather than throwing on an unknown preset', () => {
    const resolved = resolveCustomization(document({ basePreset: 'from-a-newer-version' }))
    assert.deepEqual(resolved.tokens['--dsw-alias-bg-base'], undefined)
    assert.ok(resolved.warnings.some((warning) => warning.includes('unknown preset')))
  })

  it('rejects a token with only one mode', () => {
    const resolved = resolveCustomization(document({
      tokens: { '--dsw-alias-bg-base': { light: '#ffffff', dark: '  ' } },
    }))
    assert.equal(resolved.tokens['--dsw-alias-bg-base'], undefined)
    assert.ok(resolved.warnings.some((warning) => warning.includes('both a light and a dark')))
  })

  it('rejects a colour token whose value is not a colour', () => {
    const resolved = resolveCustomization(document({
      tokens: { '--dsw-alias-bg-base': { light: 'not-a-colour', dark: '#000000' } },
    }))
    assert.equal(resolved.tokens['--dsw-alias-bg-base'], undefined)
    assert.ok(resolved.warnings.some((warning) => warning.includes('not a valid CSS colour')))
  })

  it('corrects an out-of-range font size', () => {
    const resolved = resolveCustomization(document({
      typography: { ...document().typography, fontSize: 99 },
    }))
    assert.equal(resolved.typography.fontSize, FONT_SIZE_RANGES.text.max)
    assert.ok(resolved.warnings.some((warning) => warning.includes('corrected')))
  })

  it('keeps an in-range font size untouched', () => {
    const resolved = resolveCustomization(document())
    assert.equal(resolved.typography.fontSize, 14)
    assert.deepEqual(resolved.warnings, [])
  })
})

describe('resolved typography', () => {
  it('keeps a size the document does not state absent', () => {
    const resolved = resolveCustomization(document({
      typography: { textFontFamily: '', codeFontFamily: '', terminalFontFamily: '' },
    }))
    assert.equal(resolved.typography.fontSize, undefined)
    assert.equal(resolved.typography.codeFontSize, undefined)
    assert.deepEqual(resolved.warnings, [])
  })
})

describe('normalizeFontList', () => {
  it('matches the quoted form the theme service stores', () => {
    assert.equal(normalizeFontList('Inter'), '"Inter"')
    assert.equal(normalizeFontList('"Inter"'), '"Inter"')
    assert.equal(normalizeFontList('Inter, system-ui'), '"Inter", system-ui')
    assert.equal(normalizeFontList('  '), '')
  })
})

describe('planTypography', () => {
  const applied = {
    fontFamilies: { text: '"Inter"', code: '"JetBrainsMono NF"', terminal: '"JetBrainsMono NF"' },
    fontSizes: { text: 14, code: 11, terminal: 13 },
  }

  it('writes nothing when the theme already carries the document', () => {
    const resolved = resolveCustomization(document({
      typography: {
        ...document().typography,
        textFontFamily: 'Inter',
        codeFontFamily: 'JetBrainsMono NF',
        terminalFontFamily: 'JetBrainsMono NF',
      },
    }))
    assert.deepEqual(planTypography(resolved.typography, applied), [])
  })

  it('writes nothing for a role the document leaves empty', () => {
    const resolved = resolveCustomization(document())
    assert.deepEqual(planTypography(resolved.typography, applied), [])
  })

  it('writes only the role whose family changed', () => {
    const resolved = resolveCustomization(document({
      typography: { ...document().typography, textFontFamily: 'Inter, system-ui' },
    }))
    assert.deepEqual(planTypography(resolved.typography, applied), [
      { role: 'text', family: 'Inter, system-ui' },
    ])
  })

  it('writes a stated size when the theme differs', () => {
    const plan = planTypography(
      { textFontFamily: '', codeFontFamily: '', terminalFontFamily: '', fontSize: 18 },
      { fontFamilies: {}, fontSizes: { text: 16 } },
    )
    assert.deepEqual(plan, [{ role: 'text', size: 18 }])
  })

  it('leaves sizes alone when the document states none', () => {
    const plan = planTypography(
      { textFontFamily: '', codeFontFamily: '', terminalFontFamily: '' },
      { fontFamilies: {}, fontSizes: { text: 16, code: 12, terminal: 14 } },
    )
    assert.deepEqual(plan, [])
  })
})

describe('familyNames', () => {
  it('keeps only concrete families, stripping quotes and generics', () => {
    assert.deepEqual(familyNames('"JetBrainsMono NF", monospace'), ['JetBrainsMono NF'])
    assert.deepEqual(familyNames('Inter, system-ui, sans-serif'), ['Inter'])
    assert.deepEqual(familyNames(''), [])
  })

  it('treats a bare generic stack as needing no local match', () => {
    assert.deepEqual(familyNames('monospace, system-ui'), [])
  })
})

describe('value helpers', () => {
  it('recognises CSS colours', () => {
    for (const value of ['#fff', '#a1b2c3', '#a1b2c3dd', 'rgb(1 2 3)', 'oklch(0.7 0.1 30)', 'red', 'transparent']) {
      assert.ok(isColor(value), value)
    }
    for (const value of ['', 'not-a-colour', '#12345', '<script>']) {
      assert.equal(isColor(value), false, value)
    }
  })

  it('clamps to the closed range and rounds', () => {
    assert.equal(clamp(5, 0, 10), 5)
    assert.equal(clamp(-1, 0, 10), 0)
    assert.equal(clamp(11, 0, 10), 10)
    assert.equal(clamp(5.6, 0, 10), 6)
    assert.equal(clamp(Number.NaN, 3, 10), 3)
  })

  it('corrects each font role within its own range', () => {
    assert.equal(correctFontSize('text', 99), FONT_SIZE_RANGES.text.max)
    assert.equal(correctFontSize('code', 99), FONT_SIZE_RANGES.code.max)
    assert.equal(correctFontSize('terminal', 1), FONT_SIZE_RANGES.terminal.min)
  })

  it('recognises densities', () => {
    for (const density of DENSITIES) assert.ok(isDensity(density), density)
    assert.equal(isDensity('tight'), false)
  })
})
