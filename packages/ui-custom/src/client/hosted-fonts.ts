/**
 * Families loaded on demand from our own font mirror.
 *
 * The mirror keeps every family out of Google's hands: the plugin loads one
 * stylesheet per pick, and the stylesheet's `unicode-range` rules make the
 * browser download only the subsets the page needs.
 *
 * @module @d0nj/dsh-ui-custom/hosted-fonts
 */

/** Role a family is suited to, used to group the picker. */
export type FontCategory = 'sans' | 'serif' | 'mono' | 'display'

/** One hosted family this package can load. */
export interface HostedFont {
  /** CSS family name, exactly as the mirrored stylesheet declares it. */
  readonly family: string
  /** Grouping in the picker. */
  readonly category: FontCategory
}

/**
 * The catalog.
 *
 * A family added here is not loadable until the mirror carries it, so a new
 * family means a new mirror tag and a new version of this package.
 */
export const HOSTED_FONTS: readonly HostedFont[] = [
  { family: 'Inter', category: 'sans' },
  { family: 'IBM Plex Sans', category: 'sans' },
  { family: 'Source Sans 3', category: 'sans' },
  { family: 'Public Sans', category: 'sans' },
  { family: 'Work Sans', category: 'sans' },
  { family: 'DM Sans', category: 'sans' },
  { family: 'Manrope', category: 'sans' },
  { family: 'Figtree', category: 'sans' },
  { family: 'Nunito Sans', category: 'sans' },
  { family: 'Open Sans', category: 'sans' },
  { family: 'Roboto', category: 'sans' },
  { family: 'Lato', category: 'sans' },
  { family: 'Montserrat', category: 'sans' },
  { family: 'Poppins', category: 'sans' },
  { family: 'Lexend', category: 'sans' },
  { family: 'Outfit', category: 'sans' },
  { family: 'Sora', category: 'sans' },
  { family: 'Space Grotesk', category: 'sans' },

  { family: 'JetBrains Mono', category: 'mono' },
  { family: 'Geist Mono', category: 'mono' },
  { family: 'Victor Mono', category: 'mono' },
  { family: 'MonoLisa', category: 'mono' },
  { family: 'SF Mono', category: 'mono' },
  { family: 'Fira Code', category: 'mono' },
  { family: 'Source Code Pro', category: 'mono' },
  { family: 'IBM Plex Mono', category: 'mono' },
  { family: 'Roboto Mono', category: 'mono' },
  { family: 'Space Mono', category: 'mono' },
  { family: 'Inconsolata', category: 'mono' },
  { family: 'Ubuntu Mono', category: 'mono' },
  { family: 'Anonymous Pro', category: 'mono' },

  { family: 'Source Serif 4', category: 'serif' },
  { family: 'IBM Plex Serif', category: 'serif' },
  { family: 'Lora', category: 'serif' },
  { family: 'Merriweather', category: 'serif' },
  { family: 'Newsreader', category: 'serif' },
  { family: 'Crimson Pro', category: 'serif' },
  { family: 'Bitter', category: 'serif' },

  { family: 'Bricolage Grotesque', category: 'display' },
  { family: 'Instrument Serif', category: 'display' },
]

const CDN_BASE = 'https://cdn.jsdelivr.net/gh/d0nj/dsh-fonts@v1.0.0/fonts'

/** Stylesheets outlive any one render, and a repeat request is a wasted round-trip. */
const requested = new Set<string>()

/**
 * @param family - the family to address.
 * @returns its directory name in the mirror.
 */
export function fontSlug(family: string): string {
  return family.toLowerCase().replaceAll(' ', '-').replaceAll(/[^a-z0-9-]/gu, '')
}

/**
 * @param font - the family to request.
 * @returns an absolute stylesheet URL.
 */
export function hostedFontUrl(font: HostedFont): string {
  return `${CDN_BASE}/${fontSlug(font.family)}/font.css`
}

/**
 * Load one family into the page; resolves on failure too, because a font that
 * cannot be fetched must not break the panel.
 *
 * @param font - the family to load.
 * @param doc - document to load into; defaults to the global one.
 */
export async function loadHostedFont(
  font: HostedFont,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): Promise<void> {
  if (doc === undefined) return
  const key = font.family.toLowerCase()
  if (requested.has(key)) return
  requested.add(key)

  const stylesheet = doc.createElement('link')
  stylesheet.rel = 'stylesheet'
  stylesheet.href = hostedFontUrl(font)
  stylesheet.dataset.d0njHostedFont = font.family
  await new Promise<void>((resolve) => {
    stylesheet.addEventListener('load', () => resolve(), { once: true })
    stylesheet.addEventListener('error', () => resolve(), { once: true })
    doc.head.append(stylesheet)
  })
  // Without this the first render after a pick can still measure the fallback.
  await doc.fonts?.ready.catch(() => {})
}

/**
 * @param fonts - catalog to read.
 * @returns family names, sorted.
 */
export function hostedFamilies(fonts: readonly HostedFont[] = HOSTED_FONTS): string[] {
  return fonts.map((font) => font.family).sort((left, right) => left.localeCompare(right))
}

/**
 * @param family - family name to find.
 * @param fonts - catalog to search.
 * @returns the entry, or `undefined` when the name is not hosted here.
 */
export function findHostedFont(
  family: string,
  fonts: readonly HostedFont[] = HOSTED_FONTS,
): HostedFont | undefined {
  const key = family.trim().replace(/^["']|["']$/gu, '').toLowerCase()
  return fonts.find((font) => font.family.toLowerCase() === key)
}
