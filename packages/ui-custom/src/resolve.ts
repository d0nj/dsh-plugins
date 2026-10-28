/**
 * Resolving a customization document into theme tokens.
 *
 * Three inputs combine, in this order:
 *
 * 1. A **preset**, which is a complete token set.
 * 2. **Per-token overrides**, applied on top of the preset.
 * 3. **Geometry**, expanded into whichever tokens it can express.
 *
 * The result is one `ThemeTokenOverrides` object — token name to `{light, dark}` —
 * which is exactly what `ctx.theme.overrideTokens` accepts. Keeping the merge
 * here, as a pure function, is what lets the panel preview a change and the Host
 * validate one from the same code.
 *
 * @module @d0nj/dsh-ui-custom/resolve
 */
import {
  DENSITIES,
  FONT_SIZE_RANGES,
  RADIUS_MAX,
  RADIUS_MIN,
  TOKEN_NAMES,
  findPreset,
  tokenSpec,
} from './spec.js'
import type { Density, FontRole, TokenModes } from './spec.js'

/** Geometry knobs the panel exposes. */
export interface Geometry {
  /** Corner radius in CSS pixels, 0–24. */
  readonly radius: number
  /** Spacing density. */
  readonly density: Density
}

/** Typography settings the plugin applies through the theme service. */
export interface Typography {
  /** Interface and body font stack; empty keeps the built-in stack. */
  readonly textFontFamily: string
  /** Code font stack; empty keeps the built-in stack. */
  readonly codeFontFamily: string
  /** Sidebar terminal font stack; empty keeps the built-in stack. */
  readonly terminalFontFamily: string
  /** Font sizes per role, each within its own range. */
  readonly fontSize: number
  readonly codeFontSize: number
  readonly terminalFontSize: number
}

/** The customization document, as the Host config carries it. */
export interface CustomizationDocument {
  /** Preset id, or `none` for no base. */
  readonly basePreset: string
  /** Per-token overrides applied over the preset. */
  readonly tokens: Readonly<Record<string, TokenModes>>
  /** Typography applied through the theme service. */
  readonly typography: Typography
  /** Geometry applied as derived tokens. */
  readonly geometry: Geometry
}

/** Result of resolving a document. */
export interface ResolvedCustomization {
  /** Complete token overrides for `ctx.theme.overrideTokens`. */
  readonly tokens: Readonly<Record<string, TokenModes>>
  /** Typography to apply, with out-of-range sizes corrected. */
  readonly typography: Typography
  /** Problems found while resolving, for the panel to show. */
  readonly warnings: readonly string[]
}

/** A colour in one of the forms the theme service and browsers accept. */
const COLOR_PATTERN = /^(#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl|oklch|lab|lch|color)\([^)]*\)|[a-z]+)$/iu

/**
 * Whether a value is a plausible CSS colour.
 *
 * Colour tokens are rendered straight into CSS custom properties, so an
 * arbitrary string would not be a security hole but would silently produce an
 * unstyled surface. Rejecting it here turns that into a visible warning.
 * @param value - candidate colour value.
 * @returns true when the value looks like a CSS colour.
 */
export function isColor(value: string): boolean {
  return COLOR_PATTERN.test(value.trim())
}

/**
 * Clamp a number into a closed range.
 * @param value - candidate value.
 * @param min - lower bound.
 * @param max - upper bound.
 * @returns the clamped integer.
 */
export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

/**
 * Expand geometry into token values.
 *
 * The documented token set has no radius or spacing tokens, so geometry is
 * expressed as a *shadow layer* of `--d0nj-*` variables the panel's own styles
 * consume, plus any `--dsw-*` tokens that exist. Emitting our own names keeps
 * this additive: a token the harness does not define cannot break a surface,
 * and the panel styles read ours.
 *
 * @param geometry - the requested geometry.
 * @returns derived custom properties with identical light and dark values.
 */
export function geometryTokens(geometry: Geometry): Record<string, TokenModes> {
  const radius = clamp(geometry.radius, RADIUS_MIN, RADIUS_MAX)
  const scale = geometry.density === 'compact' ? 0.8 : geometry.density === 'spacious' ? 1.25 : 1
  const value = (px: string): TokenModes => ({ light: px, dark: px })
  return {
    '--d0nj-radius-sm': value(`${String(Math.round(radius * 0.5))}px`),
    '--d0nj-radius-md': value(`${String(radius)}px`),
    '--d0nj-radius-lg': value(`${String(Math.round(radius * 1.5))}px`),
    '--d0nj-space-1': value(`${String(Math.round(4 * scale))}px`),
    '--d0nj-space-2': value(`${String(Math.round(8 * scale))}px`),
    '--d0nj-space-3': value(`${String(Math.round(12 * scale))}px`),
    '--d0nj-space-4': value(`${String(Math.round(16 * scale))}px`),
  }
}

/**
 * Correct one role's font size into its accepted range.
 * @param role - font role.
 * @param px - requested size.
 * @returns the in-range size.
 */
export function correctFontSize(role: FontRole, px: number): number {
  const range = FONT_SIZE_RANGES[role]
  return clamp(px, range.min, range.max)
}

/**
 * Whether a string names a known density.
 * @param value - candidate density.
 * @returns true for a known density.
 */
export function isDensity(value: string): value is Density {
  return (DENSITIES as readonly string[]).includes(value)
}

/**
 * Resolve a customization document into theme tokens and typography.
 *
 * Merge order is preset, then explicit overrides, then geometry, so a user who
 * picks a preset and then tweaks one token keeps the tweak, and geometry always
 * wins over a token of the same name (it is the more specific control).
 *
 * @param document - the customization document.
 * @returns the token overrides, corrected typography, and any warnings.
 */
export function resolveCustomization(document: CustomizationDocument): ResolvedCustomization {
  const warnings: string[] = []
  const tokens: Record<string, TokenModes> = {}

  if (document.basePreset !== 'none') {
    const preset = findPreset(document.basePreset)
    if (preset === undefined) {
      warnings.push(`unknown preset "${document.basePreset}"; no base tokens applied`)
    } else {
      for (const [name, modes] of Object.entries(preset.tokens)) tokens[name] = modes
    }
  }

  for (const [name, modes] of Object.entries(document.tokens)) {
    const spec = tokenSpec(name)
    if (spec === undefined) {
      // A hand-edited document can name a token this build does not document.
      // Skipping it with a warning beats applying a property nothing reads.
      warnings.push(`ignoring undocumented token "${name}"`)
      continue
    }
    const light = modes.light.trim()
    const dark = modes.dark.trim()
    if (light.length === 0 || dark.length === 0) {
      warnings.push(`token "${name}" needs both a light and a dark value`)
      continue
    }
    if (spec.kind === 'color' && (!isColor(light) || !isColor(dark))) {
      warnings.push(`token "${name}" is not a valid CSS colour`)
      continue
    }
    tokens[name] = { light, dark }
  }

  for (const [name, modes] of Object.entries(geometryTokens(document.geometry))) {
    tokens[name] = modes
  }

  const typography: Typography = {
    textFontFamily: document.typography.textFontFamily,
    codeFontFamily: document.typography.codeFontFamily,
    terminalFontFamily: document.typography.terminalFontFamily,
    fontSize: correctFontSize('text', document.typography.fontSize),
    codeFontSize: correctFontSize('code', document.typography.codeFontSize),
    terminalFontSize: correctFontSize('terminal', document.typography.terminalFontSize),
  }
  if (typography.fontSize !== document.typography.fontSize) {
    warnings.push(`text font size corrected to ${String(typography.fontSize)}px (allowed ${String(FONT_SIZE_RANGES.text.min)}–${String(FONT_SIZE_RANGES.text.max)})`)
  }

  return { tokens, typography, warnings }
}

/** Every documented token name, re-exported for the panel's reset action. */
export { TOKEN_NAMES }
