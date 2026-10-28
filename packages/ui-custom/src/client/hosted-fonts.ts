/**
 * Families fetched from a font CDN on demand.
 *
 * @module @d0nj/dsh-ui-custom/hosted-fonts
 */

/** Role a family is suited to, used to group the picker. */
export type FontCategory = 'sans' | 'serif' | 'mono' | 'display'

/** One hosted family this package can load. */
export interface HostedFont {
  /** CSS family name, exactly as the stylesheet declares it. */
  readonly family: string
  /** Grouping in the picker. */
  readonly category: FontCategory
  /** Weights requested from the CDN; 400 is enough for body text. */
  readonly weights?: readonly number[]
}

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

const CDN_BASE = 'https://fonts.googleapis.com/css2'

/** Stylesheets outlive any one render, and a repeat request is a wasted round-trip. */
const requested = new Set<string>()

/**
 * @param font - the family to request.
 * @returns an absolute stylesheet URL.
 */
export function hostedFontUrl(font: HostedFont): string {
  const name = font.family.trim().replace(/\s+/gu, '+')
  const weights = (font.weights ?? [400]).join(';')
  return `${CDN_BASE}?family=${name}:wght@${weights}&display=swap`
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
