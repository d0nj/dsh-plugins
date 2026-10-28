/**
 * Host half: the customization document and its validation.
 *
 * The plugin does no rendering and holds no state of its own on the Host. It
 * contributes one Config schema, which the profile stores and the browser half
 * reads through its settings namespace, so a choice made in the panel survives a
 * reload and a machine switch without this process tracking anything.
 *
 * `Config` is the contract; `resolve.ts` is the meaning. Keeping them apart means
 * the panel can preview a change with the same resolver the stored document
 * goes through, instead of reimplementing the merge rules in the browser.
 *
 * @module @d0nj/dsh-ui-custom
 */
import z from '@deepseek-ai/schemastery'
import type { Volatile } from '@deepseek-ai/cordis'

import { DENSITIES, FONT_SIZE_RANGES, PRESET_IDS, RADIUS_MAX, RADIUS_MIN } from './spec.js'
import type { CustomizationDocument } from './resolve.js'

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'ui-custom'

/** No services are required: this plugin only contributes configuration. */
export const inject = [] as const

/** One token override, with both palette modes required. */
const TokenModesConfig = z.object({
  light: z.string().description('Value used while the light palette is active.'),
  dark: z.string().description('Value used while the dark palette is active.'),
})

/** Font stacks and sizes. */
const TypographyConfig = z.object({
  textFontFamily: z
    .string()
    .description('Interface and body font stack. Empty keeps the built-in stack.'),
  codeFontFamily: z.string().description('Code font stack. Empty keeps the built-in stack.'),
  terminalFontFamily: z
    .string()
    .description('Sidebar terminal font stack. Empty keeps the built-in stack.'),
  fontSize: z
    .number()
    .step(1)
    .min(FONT_SIZE_RANGES.text.min)
    .max(FONT_SIZE_RANGES.text.max)
    .default(FONT_SIZE_RANGES.text.fallback)
    .description('Conversation text size in px.'),
  codeFontSize: z
    .number()
    .step(1)
    .min(FONT_SIZE_RANGES.code.min)
    .max(FONT_SIZE_RANGES.code.max)
    .default(FONT_SIZE_RANGES.code.fallback)
    .description('Code block size in px.'),
  terminalFontSize: z
    .number()
    .step(1)
    .min(FONT_SIZE_RANGES.terminal.min)
    .max(FONT_SIZE_RANGES.terminal.max)
    .default(FONT_SIZE_RANGES.terminal.fallback)
    .description('Sidebar terminal size in px.'),
})

/** Corner radius and spacing density. */
const GeometryConfig = z.object({
  radius: z
    .number()
    .step(1)
    .min(RADIUS_MIN)
    .max(RADIUS_MAX)
    .default(8)
    .description('Corner radius in px.'),
  density: z
    .union([z.const('compact'), z.const('comfortable'), z.const('spacious')])
    .default('comfortable')
    .description('Spacing density.'),
})

/**
 * The plugin's config: one customization document.
 *
 * `basePreset` accepts any preset id or `none`. The resolver reports an unknown
 * id as a warning rather than failing validation, because a stored document
 * naming a preset from a newer version must not stop the plugin mounting.
 */
// Typed as the schema base so the emitted declaration stays portable: the fully
// inferred type of a z.object chain names cosmokit through a pnpm store path.
export const Config: ReturnType<typeof z.object> = z.object({
  basePreset: z
    .union([z.const('none'), ...PRESET_IDS.map((id) => z.const(id))])
    .default('none')
    .volatile()
    .description(`Preset to build on: one of ${PRESET_IDS.join(', ')}, or none.`),
  tokens: z
    .dict(TokenModesConfig)
    .volatile()
    .description('Per-token overrides applied over the preset, keyed by CSS custom property name.'),
  typography: TypographyConfig.volatile(),
  geometry: GeometryConfig.volatile(),
})

/**
 * The resolved config value.
 *
 * Fields are mutable and optional where the schema supplies defaults, matching
 * what `z.object` produces; nothing in this package mutates them.
 */
/**
 * The parsed shape of this plugin's config.
 *
 * Each field is olatile in the schema, so the Host hands pply a
 * Volatile reference for it rather than a plain value; {@link toDocument}
 * unwraps either form.
 */
export interface PluginConfig {
  basePreset?: string
  tokens?: Record<string, { light: string; dark: string }>
  typography?: {
    textFontFamily?: string
    codeFontFamily?: string
    terminalFontFamily?: string
    fontSize?: number
    codeFontSize?: number
    terminalFontSize?: number
  }
  geometry?: { radius?: number; density?: 'compact' | 'comfortable' | 'spacious' }
}

/**
 * Project a stored config into a complete customization document.
 *
 * The schema defaults every field, but a config read back from a partially
 * written document may still be missing sections, so this fills them once here
 * rather than at each use site.
 * @param config - the config handed to `apply`.
 * @returns a complete document.
 */
export function toDocument(input: unknown): CustomizationDocument {
  const config = (input ?? {}) as PluginConfig
  const read = <T,>(value: Volatile<T | undefined> | T | undefined): T | undefined => {
    if (value !== null && typeof value === 'object' && 'get' in value) {
      return (value as Volatile<T | undefined>).get() as T | undefined
    }
    return value as T | undefined
  }
  const geometry = read(config.geometry)
  const typography = read(config.typography)
  const density = geometry?.density
  return {
    basePreset: read(config.basePreset) ?? 'none',
    tokens: read(config.tokens) ?? {},
    typography: {
      textFontFamily: typography?.textFontFamily ?? '',
      codeFontFamily: typography?.codeFontFamily ?? '',
      terminalFontFamily: typography?.terminalFontFamily ?? '',
      fontSize: typography?.fontSize ?? FONT_SIZE_RANGES.text.fallback,
      codeFontSize: typography?.codeFontSize ?? FONT_SIZE_RANGES.code.fallback,
      terminalFontSize: typography?.terminalFontSize ?? FONT_SIZE_RANGES.terminal.fallback,
    },
    geometry: {
      radius: geometry?.radius ?? 8,
      density: density !== undefined && (DENSITIES as readonly string[]).includes(density)
        ? density
        : 'comfortable',
    },
  }
}

/**
 * Host plugin body.
 *
 * The Host contributes no runtime behavior: the browser half owns the theme
 * override layer, and the settings service owns persistence. Returning nothing
 * keeps the mount a pure configuration declaration, so a profile can hold this
 * row without this process doing any work per session.
 */
export function apply(): void {}

export { PRESETS, TOKEN_SPECS, TOKEN_GROUPS, PRESET_IDS } from './spec.js'
export { resolveCustomization } from './resolve.js'
export type { CustomizationDocument, ResolvedCustomization } from './resolve.js'