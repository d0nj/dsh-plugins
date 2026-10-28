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

/** One token row's editable state. */
export interface TokenRowState {
  readonly name: string
  readonly label: string
  readonly description: string
  /** Stored override, or `undefined` while the token inherits the preset. */
  readonly override?: { readonly light: string; readonly dark: string } | undefined
}

/** Panel state handed in by the client apply. */
export interface PanelState {
  readonly basePreset: string
  readonly tokens: readonly TokenRowState[]
  readonly typography: {
    readonly textFontFamily: string
    readonly codeFontFamily: string
    readonly terminalFontFamily: string
    readonly fontSize: number
    readonly codeFontSize: number
    readonly terminalFontSize: number
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
  setFont(role: 'text' | 'code' | 'terminal', value: string): void
  setFontSize(role: 'text' | 'code' | 'terminal', px: number): void
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
      gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
      gap: 10,
    },
    card: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 10,
      borderRadius: 'var(--d0nj-radius-md, 8px)',
      border: '1px solid var(--dsw-alias-border-l1)',
      // No background and no colour token here: a card represents a theme, so it
      // paints that theme's own surface (set per card, below). Using a token made
      // every card show the live theme instead, which read as banding.
      background: 'transparent',
      cursor: 'pointer',
      textAlign: 'left',
      color: 'var(--dsw-alias-label-primary)',
      font: 'inherit',
      // The UA focus ring lingers on whichever card was last clicked; a
      // focus-visible ring keeps keyboard affordance without that trail.
      outline: 'none',
    },
    cardActive: {
      borderColor: 'var(--dsw-alias-brand-primary)',
      borderWidth: 2,
      padding: 9,
    },
    swatches: { display: 'flex', gap: 4 },
    swatch: {
      width: 22,
      height: 22,
      borderRadius: 'var(--d0nj-radius-sm, 4px)',
      border: '1px solid var(--dsw-alias-border-l1)',
    },
    row: {
      display: 'grid',
      gridTemplateColumns: 'minmax(120px, 1fr) auto auto',
      gap: 8,
      alignItems: 'center',
      padding: '6px 0',
      borderBottom: '1px solid var(--dsw-alias-border-l1)',
    },
    rowLabel: { display: 'flex', flexDirection: 'column', gap: 2 },
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
    preview: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 14,
      borderRadius: 'var(--d0nj-radius-lg, 12px)',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-base)',
    },
    row2: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  }
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
  props: { state: PanelState; actions: PanelActions; presets: readonly { id: string; label: string; description: string; colorScheme: 'light' | 'dark'; tokens: Record<string, { light: string; dark: string }> }[] },
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
  const [localTypography, setLocalTypography] = React.useState(state.typography)

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

  const presetCards = [
    { id: 'none', label: 'No preset', description: 'Start from the built-in palette.', colorScheme: 'dark' as const, tokens: {} },
    ...presets,
  ].map((preset) => {
    const base = preset.tokens['--dsw-alias-bg-base']
    const accent = preset.tokens['--dsw-alias-brand-primary']
    const label = preset.tokens['--dsw-alias-label-primary']
    const active = (localPreset ?? state.basePreset) === preset.id
    return h(
      'button',
      {
        key: preset.id,
        type: 'button',
        style: {
          ...s.card,
          // Paint the preset's own surface and text colour, so the grid shows what
          // each theme looks like rather than the one currently applied.
          background: base?.light ?? 'transparent',
          color: label?.light ?? 'var(--dsw-alias-label-primary)',
          ...(active ? s.cardActive : {}),
        },
        'aria-pressed': active,
        onClick: () => {
          setLocalPreset(preset.id)
          setLocalTokens({})
          actions.setPreset(preset.id)
        },
      },
      h(
        'div',
        { style: s.swatches },
        h('span', { style: { ...s.swatch, background: base?.light ?? 'transparent' } }),
        h('span', { style: { ...s.swatch, background: base?.dark ?? 'transparent' } }),
        h('span', { style: { ...s.swatch, background: accent?.dark ?? 'transparent' } }),
        h('span', { style: { ...s.swatch, background: label?.dark ?? 'transparent' } }),
      ),
      h('span', { style: { fontSize: 13, fontWeight: 600 } }, preset.label),
      h('span', { style: s.hint }, preset.description),
    )
  })

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

  const fontRow = (
    role: 'text' | 'code' | 'terminal',
    label: string,
    family: string,
    size: number,
  ): unknown =>
    h(
      'div',
      { style: s.row },
      h('div', { style: s.rowLabel }, h('span', { style: { fontSize: 12, fontWeight: 600 } }, label)),
      h('input', {
        style: { ...s.input, width: 260 },
        type: 'text',
        'aria-label': `${label} font stack`,
        placeholder: 'Font family, fallback, sans-serif',
        value: family,
        onChange: (event: { target: { value: string } }) => {
          const key = role === 'text' ? 'textFontFamily' : role === 'code' ? 'codeFontFamily' : 'terminalFontFamily'
          setLocalTypography({ ...(localTypography ?? state.typography), [key]: event.target.value })
          actions.setFont(role, event.target.value)
        },
      }),
      h(
        'div',
        { style: s.row2 },
        h('input', {
          style: s.input,
          type: 'number',
          min: 8,
          max: 24,
          'aria-label': `${label} size`,
          value: size,
          onChange: (event: { target: { value: string } }) => {
            const px = Number(event.target.value)
            const key = role === 'text' ? 'fontSize' : role === 'code' ? 'codeFontSize' : 'terminalFontSize'
            setLocalTypography({ ...(localTypography ?? state.typography), [key]: px })
            actions.setFontSize(role, px)
          },
        }),
        h('span', { style: s.hint }, 'px'),
      ),
    )

  return h(
    'div',
    { style: s.root },
    state.writable
      ? null
      : h('div', { style: s.warning }, 'This profile does not accept settings writes; changes will not persist.'),

    h(
      'section',
      { style: s.section },
      h('h3', { style: s.heading }, 'Base theme'),
      h('p', { style: s.hint }, 'A preset supplies a complete token set. Tune individual values below it.'),
      h('div', { style: s.grid }, presetCards),
    ),

    h(
      'section',
      { style: s.section },
      h('h3', { style: s.heading }, 'Live preview'),
      h(
        'div',
        { style: s.preview },
        h('span', { style: { fontSize: 15, fontWeight: 600 } }, 'The quick brown fox'),
        h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' } }, 'Secondary text sits one step down.'),
        h(
          'div',
          { style: s.row2 },
          h('span', { style: { ...s.button, background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-bg-base)' } }, 'Accent'),
          h('span', { style: { ...s.button, borderColor: 'var(--dsw-alias-state-error-primary)' } }, 'Error'),
          h('span', { style: { ...s.button, borderColor: 'var(--dsw-alias-state-success-primary)' } }, 'Success'),
          h('span', { style: { ...s.button, borderColor: 'var(--dsw-alias-state-warn-primary)' } }, 'Warning'),
        ),
      ),
    ),

    h(
      'section',
      { style: s.section },
      h('h3', { style: s.heading }, 'Typography'),
      fontRow('text', 'Interface text', (localTypography ?? state.typography).textFontFamily, (localTypography ?? state.typography).fontSize),
      fontRow('code', 'Code', (localTypography ?? state.typography).codeFontFamily, (localTypography ?? state.typography).codeFontSize),
      fontRow('terminal', 'Terminal', (localTypography ?? state.typography).terminalFontFamily, (localTypography ?? state.typography).terminalFontSize),
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
          value: (localGeometry ?? state.geometry).radius,
          'aria-label': 'Corner radius',
          onChange: (event: { target: { value: string } }) => {
            const radius = Number(event.target.value)
            setLocalGeometry({ ...(localGeometry ?? state.geometry), radius })
            actions.setRadius(radius)
          },
        }),
        h('span', { style: s.hint }, `${String((localGeometry ?? state.geometry).radius)}px`),
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
                  (localGeometry ?? state.geometry).density === density
                    ? { ...s.button, borderColor: 'var(--dsw-alias-brand-primary)' }
                    : s.button,
                'aria-pressed': (localGeometry ?? state.geometry).density === density,
                onClick: () => {
                  setLocalGeometry({ ...(localGeometry ?? state.geometry), density })
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
      h('p', { style: s.hint }, 'Both values are required: one per palette mode, so switching scheme stays legible.'),
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
      { style: s.section },
      h(
        'button',
        { type: 'button', style: s.button, onClick: () => actions.resetAll() },
        'Reset all customization',
      ),
    ),
  )
}
