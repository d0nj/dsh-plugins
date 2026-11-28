/**
 * Theme Studio: the settings page.
 *
 * Live preview is computed from the same resolver the stored document goes
 * through, so what the panel shows and what the plugin applies cannot drift.
 * Writes go through `configForms.get('ui-custom').set/unset`, which means the
 * panel never touches YAML, never races a revision, and is reversible field by
 * field.
 *
 * Styling follows the plugin rules: theme tokens only (`--dsw-alias-*`, plus the
 * `--d0nj-*` geometry tokens this plugin derives), no literal colours for
 * chrome. The swatches themselves are the one place a literal colour is correct,
 * because they *are* the colour being chosen.
 *
 * @module @d0nj/dsh-ui-custom/panel
 */

import { DEFAULT_GEOMETRY, FONT_FAMILY_FIELDS, FONT_SIZE_FIELDS, FONT_SIZE_RANGES } from '../spec.js'
import type { FontRole } from '../spec.js'
import { clamp } from '../resolve.js'
import { findHostedFont, hostedFamilies, loadHostedFont } from './hosted-fonts.js'

/** One token row's editable state. */
export interface TokenRowState {
  readonly name: string
  readonly label: string
  readonly description: string
  /** Stored override, or `undefined` while the token inherits the preset. */
  readonly override?: { readonly light: string; readonly dark: string } | undefined
}

export interface PresetChoice {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly colorScheme: 'light' | 'dark'
  readonly tokens: Readonly<Record<string, { readonly light: string; readonly dark: string }>>
}

type SchemeFilter = 'all' | 'light' | 'dark'

interface TypographyDraft {
  textFontFamily: string
  codeFontFamily: string
  terminalFontFamily: string
  fontSize?: number
  codeFontSize?: number
  terminalFontSize?: number
}

interface PreviewColors {
  readonly base: string
  readonly sidebar: string
  readonly primary: string
  readonly secondary: string
  readonly accent: string
  readonly error: string
  readonly success: string
  readonly warn: string
  readonly border: string
}

/** Panel state handed in by the client apply. */
export interface PanelState {
  readonly basePreset: string
  readonly tokens: readonly TokenRowState[]
  readonly typography: {
    readonly textFontFamily: string
    readonly codeFontFamily: string
    readonly terminalFontFamily: string
    readonly fontSize?: number
    readonly codeFontSize?: number
    readonly terminalFontSize?: number
  }
  readonly applied: {
    readonly fontFamilies: Readonly<Record<string, string>>
    readonly fontSizes: Readonly<Record<string, number>>
  }
  readonly geometry: { readonly radius: number; readonly density: string }
  readonly warnings: readonly string[]
  readonly writable: boolean
}

/** Reactions the panel invokes. */
export interface PanelActions {
  setPreset(id: string): void
  setToken(name: string, light: string, dark: string): void
  clearToken(name: string): void
  setFont(role: FontRole, value: string): void
  setFontSize(role: FontRole, px: number): void
  setRadius(px: number): void
  setDensity(density: string): void
  resetAll(): void
}

/** Shared inline styles, computed from theme tokens. */
function styles(): Record<string, Record<string, string | number>> {
  return {
    root: {
      display: 'flex',
      flexDirection: 'column',
      gap: 24,
      padding: '4px 0 32px',
      color: 'var(--dsw-alias-label-primary)',
      fontFamily: 'inherit',
    },
    section: { display: 'flex', flexDirection: 'column', gap: 10 },
    heading: { fontSize: 13, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
    hint: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 },
    grid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
      gap: 12,
    },
    selectorTools: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
    search: {
      flex: '1 1 180px',
      minWidth: 140,
      padding: '6px 9px',
      borderRadius: 'var(--d0nj-radius-md, 8px)',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 12,
    },
    segmented: {
      display: 'inline-flex',
      gap: 2,
      padding: 2,
      borderRadius: 'var(--d0nj-radius-md, 8px)',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-2)',
    },
    segment: {
      padding: '4px 10px',
      border: '1px solid transparent',
      borderRadius: 'var(--d0nj-radius-sm, 4px)',
      background: 'transparent',
      color: 'var(--dsw-alias-label-secondary)',
      font: 'inherit',
      fontSize: 12,
      cursor: 'pointer',
    },
    segmentActive: {
      borderColor: 'var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-1)',
      color: 'var(--dsw-alias-label-primary)',
      fontWeight: 600,
    },
    tile: {
      display: 'flex',
      flexDirection: 'column',
      padding: 0,
      overflow: 'hidden',
      borderRadius: 'var(--d0nj-radius-md, 8px)',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'transparent',
      cursor: 'pointer',
      textAlign: 'left',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      outline: 'none',
    },
    tilePreview: { position: 'relative', display: 'flex', height: 84 },
    tileSidebar: { width: 28, display: 'flex', flexDirection: 'column', gap: 4, padding: '9px 0 9px 9px' },
    tileDot: { width: 5, height: 5, borderRadius: '50%' },
    tileBody: { flex: 1, display: 'flex', flexDirection: 'column', gap: 5, padding: '11px 10px 9px' },
    tileLine: { height: 4, borderRadius: 2 },
    tileChips: { display: 'flex', gap: 3, marginTop: 'auto' },
    tileChip: { width: 16, height: 5, borderRadius: 3 },
    tileFooter: { display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', fontSize: 12, fontWeight: 600, lineHeight: 1.25 },
    tileName: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    tileBadge: {
      marginLeft: 'auto',
      width: 16,
      height: 16,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 10,
      lineHeight: 1,
    },
    row: {
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      alignItems: 'center',
      padding: '6px 0',
      borderBottom: '1px solid var(--dsw-alias-border-l1)',
    },
    rowLabel: { display: 'flex', flexDirection: 'column', gap: 2, flex: '1 1 180px', minWidth: 120 },
    input: {
      width: 92,
      padding: '4px 6px',
      borderRadius: 'var(--d0nj-radius-sm, 4px)',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 12,
    },
    select: {
      width: '100%',
      padding: '4px 6px',
      borderRadius: 'var(--d0nj-radius-sm, 4px)',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-base)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 12,
    },
    fontRow: { gap: 18 },
    combo: { position: 'relative', flex: '1 1 220px', minWidth: 140 },
    slider: { flex: '1 1 180px', minWidth: 120, cursor: 'pointer' },
    listbox: {
      position: 'absolute',
      zIndex: 10,
      top: '100%',
      left: 0,
      right: 0,
      marginTop: 4,
      maxHeight: 240,
      overflowY: 'auto',
      padding: 4,
      borderRadius: 'var(--d0nj-radius-sm, 4px)',
      border: '1px solid var(--dsw-alias-border-l2)',
      // A popup over arbitrary content cannot inherit the surface behind it, so
      // it paints the module fill; only the element's own list uses this literal.
      background: 'var(--dsw-alias-bg-module-platform, var(--dsw-alias-bg-layer-1))',
      boxShadow: 'var(--dsw-elevation-lv2, 0 4px 12px rgba(0, 0, 0, 0.2))',
    },
    option: {
      padding: '4px 6px',
      borderRadius: 'var(--d0nj-radius-sm, 4px)',
      fontSize: 12,
      color: 'var(--dsw-alias-label-primary)',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    optionActive: { background: 'var(--dsw-alias-interactive-bg-hover, var(--dsw-alias-bg-layer-2))' },
    colorInput: {
      width: 34,
      height: 26,
      padding: 0,
      border: '1px solid var(--dsw-alias-border-l1)',
      borderRadius: 'var(--d0nj-radius-sm, 4px)',
      background: 'transparent',
      cursor: 'pointer',
    },
    button: {
      padding: '5px 10px',
      borderRadius: 'var(--d0nj-radius-md, 8px)',
      border: '1px solid var(--dsw-alias-border-l2)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      fontSize: 12,
      cursor: 'pointer',
    },
    warning: {
      padding: '8px 10px',
      borderRadius: 'var(--d0nj-radius-md, 8px)',
      border: '1px solid var(--dsw-alias-state-warn-primary)',
      color: 'var(--dsw-alias-state-warn-primary)',
      fontSize: 12,
    },
    row2: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  }
}

/** Transient state of one font combobox, outside React so keystrokes are not lost. */
interface ComboState {
  open: boolean
  query: string
  active: number
  draft?: string | undefined
}

/**
 * Combobox state per role.
 *
 * Kept at module scope because the panel re-renders on every settings echo, and
 * state created inside the render would reset to closed each pass.
 */
const combos = new Map<string, ComboState>()

/** Exported so tests do not inherit an open list between cases. */
export function resetCombos(): void {
  combos.clear()
}

/**
 * @param key - the role's accessible label.
 * @returns the state for that role, created on first use.
 */
function comboState(key: string): ComboState {
  const existing = combos.get(key)
  if (existing !== undefined) return existing
  const created: ComboState = { open: false, query: '', active: 0 }
  combos.set(key, created)
  return created
}

/**
 * Fonts offered by the picker.
 *
 * Hosted rather than local: a browser cannot enumerate installed fonts without a
 * permission-gated API most lack, and a local family looks different elsewhere.
 */
let fontChoiceCache: string[] | undefined

/** @returns the families the picker offers. */
function fontChoices(): string[] {
  fontChoiceCache ??= hostedFamilies()
  return fontChoiceCache
}

/**
 * Render the Theme Studio page.
 *
 * Written against a minimal `React.createElement` shim rather than JSX so the
 * module needs no transform at build time; the client bundle supplies React.
 *
 * @param React - the React namespace from the module table.
 * @param props - current state and the actions to invoke.
 * @returns the section element.
 */
export function ThemeStudio(
  React: {
    createElement: (type: unknown, props?: unknown, ...children: unknown[]) => unknown
    useState: <T>(initial: T) => [T, (next: T) => void]
  },
  props: { state: PanelState; actions: PanelActions; presets: readonly PresetChoice[] },
): unknown {
  const h = React.createElement
  const s = styles()
  const { state, actions, presets } = props

  // Local mirrors. The panel must react to a click immediately: a settings write
  // is a round-trip through the Host, and waiting for the echo makes every
  // control feel dead when the write is slow, refused, or not mirrored at all.
  // Local state is the source of truth for rendering; the action is the command.
  const [localPreset, setLocalPreset] = React.useState(state.basePreset)
  const [localTokens, setLocalTokens] = React.useState<Record<string, { light: string; dark: string }>>({})
  const [localGeometry, setLocalGeometry] = React.useState(state.geometry)
  const [localTypography, setLocalTypography] = React.useState<TypographyDraft>({ ...state.typography })
  const [sizeDrafts, setSizeDrafts] = React.useState<Partial<Record<FontRole, string>>>({})
  const [query, setQuery] = React.useState('')
  const [scheme, setScheme] = React.useState<SchemeFilter>('all')
  // The counter must keep changing: writing the same number makes React bail out.
  const [renderTick, setRender] = React.useState(0)
  const choices = fontChoices()
  const rerender = (): void => setRender(renderTick + 1)

  /**
   * @param role - font role being changed.
   * @param value - CSS stack to apply.
   */
  const applyFont = (role: FontRole, value: string): void => {
    const hosted = findHostedFont(value)
    if (hosted !== undefined) void loadHostedFont(hosted)
    actions.setFont(role, value)
  }

  /**
   * @param ariaLabel - accessible name for the input.
   * @param family - current stack.
   * @param onChange - writes the chosen stack.
   * @returns the combobox element.
   */
  const fontCombo = (ariaLabel: string, family: string, onChange: (value: string) => void): unknown => {
    const combo = comboState(ariaLabel)
    // Not the word "Default", which could collide with a family of that name.
    const DEFAULT_CHOICE = '\u0000default'
    const isDefault = (choice: string): boolean => choice === DEFAULT_CHOICE
    const matches = (): string[] => {
      const query = combo.query.trim().toLowerCase()
      if (query === '') return [DEFAULT_CHOICE, ...choices]
      const filtered = choices.filter((choice) => choice.toLowerCase().includes(query))
      const keepDefault = 'default (built-in)'.includes(query) || 'built-in'.includes(query)
      return keepDefault ? [DEFAULT_CHOICE, ...filtered] : filtered
    }
    const commit = (value: string): void => {
      combo.open = false
      combo.query = ''
      combo.active = 0
      combo.draft = undefined
      const next = isDefault(value) ? '' : value
      if (next !== family) onChange(next)
      rerender()
    }
    const display = combo.draft ?? family
    const visible = combo.open ? matches() : []
    return h(
      'div',
      { style: s.combo },
      h('input', {
        type: 'text',
        role: 'combobox',
        style: s.select,
        'aria-label': ariaLabel,
        'aria-expanded': combo.open,
        'aria-autocomplete': 'list',
        placeholder: 'Default (built-in stack)',
        value: display,
        onFocus: (event: { target: { value: string; select?: () => void } }) => {
          combo.open = true
          combo.query = ''
          combo.active = 0
          combo.draft = family
          event.target.select?.()
          rerender()
        },
        onChange: (event: { target: { value: string } }) => {
          combo.open = true
          combo.query = event.target.value
          combo.draft = event.target.value
          combo.active = 0
          rerender()
        },        onKeyDown: (event: { key: string; preventDefault: () => void }) => {
          const list = visible
          if (event.key === 'Escape') {
            combo.open = false
            combo.query = ''
            combo.draft = undefined
            rerender()
            return
          }
          if (event.key === 'ArrowDown' && list.length > 0) {
            event.preventDefault()
            combo.active = (combo.active + 1) % list.length
            rerender()
            return
          }
          if (event.key === 'ArrowUp' && list.length > 0) {
            event.preventDefault()
            combo.active = (combo.active - 1 + list.length) % list.length
            rerender()
            return
          }
          if (event.key === 'Enter') {
            const picked = list[combo.active]
            const typed = (combo.draft ?? '').trim()
            if (combo.open && picked !== undefined) commit(picked)
            else if (combo.open && typed !== '') commit(typed)
          }
        },
        onBlur: () => {
          const typed = combo.draft
          combo.open = false
          combo.query = ''
          combo.draft = undefined
          if (typed !== undefined && typed.trim() !== '' && typed.trim() !== family) onChange(typed.trim())
          rerender()
        },
      }),
      combo.open && visible.length > 0
        ? h(
            'div',
            { style: s.listbox, role: 'listbox' },
            ...visible.map((choice, index) =>
              h(
                'div',
                {
                  key: choice,
                  role: 'option',
                  'aria-selected': index === combo.active,
                  style: {
                    ...s.option,
                    ...(isDefault(choice) ? {} : { fontFamily: `"${choice}"` }),
                    ...(index === combo.active ? s.optionActive : {}),
                  },
                  // Fires before the input's blur, which would close the list first.
                  onMouseDown: (event: { preventDefault: () => void }) => {
                    event.preventDefault()
                    commit(choice)
                  },
                },
                isDefault(choice) ? 'Default (built-in stack)' : choice,
              ),
            ),
          )
        : null,
    )
  }

  /** The preset currently selected, for filling a missing mode from its colours. */
  const basePreset = presets.find((preset) => preset.id === (localPreset ?? state.basePreset))

  /**
   * The effective value of one token: the local edit, else the stored override,
   * else the base preset's own value for that mode.
   */
  const effective = (name: string): { light: string; dark: string } => {
    const local = localTokens[name]
    if (local !== undefined) return local
    const stored = state.tokens.find((row) => row.name === name)?.override
    if (stored !== undefined) return stored
    const presetValue = basePreset === undefined ? undefined : basePreset.tokens[name]
    return presetValue ?? { light: '', dark: '' }
  }

  const previewColors = (preset?: PresetChoice): PreviewColors => {
    const mode = preset?.colorScheme ?? 'dark'
    const pick = (name: string, fallback: string): string => preset?.tokens[name]?.[mode] ?? fallback
    return {
      base: pick('--dsw-alias-bg-base', 'var(--dsw-alias-bg-base)'),
      sidebar: pick('--dsw-specific-sidebar-fill', 'var(--dsw-specific-sidebar-fill)'),
      primary: pick('--dsw-alias-label-primary', 'var(--dsw-alias-label-primary)'),
      secondary: pick('--dsw-alias-label-secondary', 'var(--dsw-alias-label-secondary)'),
      accent: pick('--dsw-alias-brand-primary', 'var(--dsw-alias-brand-primary)'),
      error: pick('--dsw-alias-state-error-primary', 'var(--dsw-alias-state-error-primary)'),
      success: pick('--dsw-alias-state-success-primary', 'var(--dsw-alias-state-success-primary)'),
      warn: pick('--dsw-alias-state-warn-primary', 'var(--dsw-alias-state-warn-primary)'),
      border: pick('--dsw-alias-border-l2', 'var(--dsw-alias-border-l1)'),
    }
  }

  const presetTile = (id: string, label: string, description: string | undefined, preset?: PresetChoice): unknown => {
    const active = (localPreset ?? state.basePreset) === id
    const colors = previewColors(preset)
    const dot = (background: string): unknown => h('span', { style: { ...s.tileDot, background } })
    const line = (width: string, background: string): unknown => h('span', { style: { ...s.tileLine, width, background } })
    const chip = (background: string): unknown => h('span', { style: { ...s.tileChip, background } })
    return h(
      'button',
      {
        key: id,
        type: 'button',
        title: description,
        style: {
          ...s.tile,
          ...(active ? { borderColor: colors.accent, boxShadow: `0 0 0 1px ${colors.accent}` } : {}),
        },
        'aria-pressed': active,
        onClick: () => {
          setLocalPreset(id)
          setLocalTokens({})
          actions.setPreset(id)
        },
      },
      h(
        'div',
        { style: { ...s.tilePreview, background: colors.base } },
        h(
          'div',
          { style: { ...s.tileSidebar, background: colors.sidebar } },
          dot(colors.secondary),
          dot(colors.border),
          dot(colors.accent),
        ),
        h(
          'div',
          { style: s.tileBody },
          line('58%', colors.primary),
          line('78%', colors.secondary),
          line('42%', colors.secondary),
          h(
            'div',
            { style: s.tileChips },
            chip(colors.accent),
            chip(colors.error),
            chip(colors.success),
            chip(colors.warn),
          ),
        ),
      ),
      h(
        'div',
        {
          style: {
            ...s.tileFooter,
            background: colors.base,
            color: colors.primary,
            borderTop: `1px solid ${colors.border}`,
          },
        },
        h('span', { style: s.tileName }, label),
        active
          ? h('span', { style: { ...s.tileBadge, background: colors.accent, color: colors.base }, 'aria-hidden': true }, '✓')
          : null,
      ),
    )
  }

  const term = query.trim().toLowerCase()
  const textMatches = (text: string): boolean => term === '' || text.toLowerCase().includes(term)
  const shown = presets.filter(
    (preset) => (scheme === 'all' || preset.colorScheme === scheme)
      && textMatches(`${preset.label} ${preset.description} ${preset.id}`),
  )
  const builtinTile = textMatches('built-in none')
    ? presetTile('none', 'Built-in', 'Follow the shipped palette.', undefined)
    : null
  const presetTiles = shown.map((preset) => presetTile(preset.id, preset.label, preset.description, preset))
  const selectorSegments: readonly { id: SchemeFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'dark', label: 'Dark' },
    { id: 'light', label: 'Light' },
  ]
  const selectorTools = h(
    'div',
    { style: s.selectorTools },
    h('input', {
      type: 'search',
      style: s.search,
      'aria-label': 'Search presets',
      placeholder: 'Search presets',
      value: query,
      onChange: (event: { target: { value: string } }) => setQuery(event.target.value),
    }),
    h(
      'div',
      { style: s.segmented, role: 'group', 'aria-label': 'Filter presets by colour scheme' },
      ...selectorSegments.map((segment) =>
        h(
          'button',
          {
            key: segment.id,
            type: 'button',
            style: scheme === segment.id ? { ...s.segment, ...s.segmentActive } : s.segment,
            'aria-pressed': scheme === segment.id,
            onClick: () => setScheme(segment.id),
          },
          segment.label,
        ),
      ),
    ),
  )

  const tokenRows = state.tokens.map((row) => {
    const current = effective(row.name)
    /**
     * Apply one mode's edit and write both modes.
     *
     * The theme runtime needs a value for each scheme, so a half-typed row is
     * completed from the preset rather than withheld: withholding was why typing
     * appeared to do nothing until both fields happened to be filled.
     */
    const edit = (mode: 'light' | 'dark', value: string): void => {
      const next = { ...current, [mode]: value }
      setLocalTokens({ ...localTokens, [row.name]: next })
      if (next.light.length > 0 && next.dark.length > 0) actions.setToken(row.name, next.light, next.dark)
    }
    return h(
      'div',
      { key: row.name, style: s.row },
      h(
        'div',
        { style: s.rowLabel },
        h('span', { style: { fontSize: 12, fontWeight: 600 } }, row.label),
        h('span', { style: s.hint }, row.description),
      ),
      h(
        'div',
        { style: s.row2 },
        h('input', {
          style: s.colorInput,
          type: 'color',
          'aria-label': `${row.label} light`,
          value: /^#[0-9a-f]{6}$/iu.test(current.light) ? current.light : '#000000',
          onChange: (event: { target: { value: string } }) => edit('light', event.target.value),
        }),
        h('input', {
          style: s.input,
          type: 'text',
          'aria-label': `${row.label} light value`,
          placeholder: 'light',
          value: current.light,
          onChange: (event: { target: { value: string } }) => edit('light', event.target.value),
        }),
      ),
      h(
        'div',
        { style: s.row2 },
        h('input', {
          style: s.colorInput,
          type: 'color',
          'aria-label': `${row.label} dark`,
          value: /^#[0-9a-f]{6}$/iu.test(current.dark) ? current.dark : '#000000',
          onChange: (event: { target: { value: string } }) => edit('dark', event.target.value),
        }),
        h('input', {
          style: s.input,
          type: 'text',
          'aria-label': `${row.label} dark value`,
          placeholder: 'dark',
          value: current.dark,
          onChange: (event: { target: { value: string } }) => edit('dark', event.target.value),
        }),
        h(
          'button',
          {
            type: 'button',
            style: s.button,
            onClick: () => {
              const next = { ...localTokens }
              delete next[row.name]
              setLocalTokens(next)
              actions.clearToken(row.name)
            },
          },
          'Reset',
        ),
      ),
    )
  })

  const fontRow = (role: FontRole, label: string): unknown => {
    const range = FONT_SIZE_RANGES[role]
    const typography = localTypography
    const family = typography[FONT_FAMILY_FIELDS[role]] || (state.applied.fontFamilies[role] ?? '')
    const size = typography[FONT_SIZE_FIELDS[role]] ?? state.applied.fontSizes[role] ?? range.fallback
    const editFamily = (value: string): void => {
      const next: TypographyDraft = { ...typography }
      next[FONT_FAMILY_FIELDS[role]] = value
      setLocalTypography(next)
      applyFont(role, value)
    }
    const commitSize = (): void => {
      const draft = sizeDrafts[role]
      const remaining = { ...sizeDrafts }
      delete remaining[role]
      setSizeDrafts(remaining)
      if (draft === undefined || draft.trim() === '') return
      const parsed = Number(draft)
      if (!Number.isFinite(parsed)) return
      const px = clamp(parsed, range.min, range.max)
      const next: TypographyDraft = { ...typography }
      next[FONT_SIZE_FIELDS[role]] = px
      setLocalTypography(next)
      actions.setFontSize(role, px)
    }
    return h(
      'div',
      { style: { ...s.row, ...s.fontRow } },
      h('div', { style: s.rowLabel }, h('span', { style: { fontSize: 12, fontWeight: 600 } }, label)),
      fontCombo(`${label} font family`, family, editFamily),
      h(
        'div',
        { style: s.row2 },
        h('input', {
          style: s.input,
          type: 'number',
          min: range.min,
          max: range.max,
          'aria-label': `${label} size`,
          value: sizeDrafts[role] ?? String(size),
          onChange: (event: { target: { value: string } }) => {
            setSizeDrafts({ ...sizeDrafts, [role]: event.target.value })
          },
          onBlur: commitSize,
          onKeyDown: (event: { key: string }) => {
            if (event.key === 'Enter') commitSize()
          },
        }),
        h('span', { style: s.hint }, 'px'),
      ),
    )
  }

  return h(
    'div',
    { style: s.root },
    state.writable
      ? null
      : h('div', { style: s.warning }, 'This profile does not accept settings writes; changes will not persist.'),

    h(
      'section',
      { style: s.section },
      h('h3', { style: s.heading }, 'Theme'),
      selectorTools,
      h('div', { style: s.grid }, builtinTile, ...presetTiles),
      builtinTile === null && presetTiles.length === 0
        ? h('p', { style: s.hint }, 'No presets match.')
        : null,
    ),

    h(
      'section',
      { style: s.section },
      h('h3', { style: s.heading }, 'Typography'),
      fontRow('text', 'Interface text'),
      fontRow('code', 'Code'),
      fontRow('terminal', 'Terminal'),
    ),

    h(
      'section',
      { style: s.section },
      h('h3', { style: s.heading }, 'Geometry'),
      h(
        'div',
        { style: s.row },
        h('div', { style: s.rowLabel }, h('span', { style: { fontSize: 12, fontWeight: 600 } }, 'Corner radius')),
        h('input', {
          type: 'range',
          min: 0,
          max: 24,
          style: s.slider,
          value: localGeometry.radius,
          'aria-label': 'Corner radius',
          onChange: (event: { target: { value: string } }) => {
            const radius = Number(event.target.value)
            setLocalGeometry({ ...localGeometry, radius })
            actions.setRadius(radius)
          },
        }),
        h('span', { style: s.hint }, `${String(localGeometry.radius)}px`),
      ),
      h(
        'div',
        { style: s.row },
        h('div', { style: s.rowLabel }, h('span', { style: { fontSize: 12, fontWeight: 600 } }, 'Density')),
        h(
          'div',
          { style: s.row2 },
          ...['compact', 'comfortable', 'spacious'].map((density) =>
            h(
              'button',
              {
                key: density,
                type: 'button',
                style:
                  localGeometry.density === density
                    ? { ...s.button, borderColor: 'var(--dsw-alias-brand-primary)' }
                    : s.button,
                'aria-pressed': localGeometry.density === density,
                onClick: () => {
                  setLocalGeometry({ ...localGeometry, density })
                  actions.setDensity(density)
                },
              },
              density,
            ),
          ),
        ),
        h('span', {}),
      ),
    ),

    h(
      'section',
      { style: s.section },
      h('h3', { style: s.heading }, 'Colour tokens'),
      ...tokenRows,
    ),

    state.warnings.length > 0
      ? h(
          'section',
          { style: s.section },
          ...state.warnings.map((warning, index) =>
            h('div', { key: String(index), style: s.warning }, warning),
          ),
        )
      : null,

    h(
      'section',
      { style: { ...s.section, alignItems: 'flex-start' } },
      h(
        'button',
        {
          type: 'button',
          style: s.button,
          onClick: () => {
            setLocalPreset('none')
            setLocalTokens({})
            setLocalTypography({ textFontFamily: '', codeFontFamily: '', terminalFontFamily: '' })
            setLocalGeometry({ ...DEFAULT_GEOMETRY })
            actions.resetAll()
          },
        },
        'Reset all customization',
      ),
    ),
  )
}
