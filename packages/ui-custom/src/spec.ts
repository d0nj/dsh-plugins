/**
 * The token catalog and the shipped presets.
 *
 * Every override must supply **both** palette modes. The theme runtime requires
 * it (`ThemeTokenModes`), because a token defined for only one scheme goes
 * illegible when the user flips to the other — so this module represents that
 * requirement in the type rather than trusting each caller to remember it.
 *
 * @module @d0nj/dsh-ui-custom/spec
 */

/** One token's value in each palette mode. */
export interface TokenModes {
  readonly light: string
  readonly dark: string
}

/** Whether a token is a colour (validated as a colour) or an arbitrary CSS value. */
export type TokenKind = 'color' | 'length' | 'shadow' | 'font'

/** One documented token the editor can change. */
export interface TokenSpec {
  /** CSS custom property name, such as `--dsw-alias-bg-base`. */
  readonly name: string
  /** Short human label for the editor row. */
  readonly label: string
  /** Grouping in the editor. */
  readonly group: TokenGroup
  /** How the value is validated and rendered. */
  readonly kind: TokenKind
  /** What the token affects, shown as the row hint. */
  readonly description: string
}

/** Editor grouping, ordered as the panel renders them. */
export type TokenGroup = 'surface' | 'border' | 'text' | 'accent' | 'state'

/** Groups in display order, with their headings. */
export const TOKEN_GROUPS: readonly { readonly id: TokenGroup; readonly label: string }[] = [
  { id: 'surface', label: 'Surfaces' },
  { id: 'border', label: 'Borders' },
  { id: 'text', label: 'Text' },
  { id: 'accent', label: 'Accent' },
  { id: 'state', label: 'State colours' },
]

/**
 * The documented alias tokens.
 *
 * These are the tokens the theme Inspect provider reports for this build, so the
 * editor never offers a row that would silently do nothing.
 */
export const TOKEN_SPECS: readonly TokenSpec[] = [
  {
    name: '--dsw-alias-bg-base',
    label: 'Base background',
    group: 'surface',
    kind: 'color',
    description: 'Application base background.',
  },
  {
    name: '--dsw-alias-bg-layer-1',
    label: 'Raised surface',
    group: 'surface',
    kind: 'color',
    description: 'Primary raised surface background.',
  },
  {
    name: '--dsw-alias-bg-layer-2',
    label: 'Nested surface',
    group: 'surface',
    kind: 'color',
    description: 'Secondary nested surface background.',
  },
  {
    name: '--dsw-alias-bg-overlay',
    label: 'Overlay',
    group: 'surface',
    kind: 'color',
    description: 'Overlay and popover background.',
  },
  {
    name: '--dsw-specific-sidebar-fill',
    label: 'Sidebar',
    group: 'surface',
    kind: 'color',
    description: 'Sidebar column and title-row background.',
  },
  {
    name: '--dsw-alias-border-l1',
    label: 'Border, subtle',
    group: 'border',
    kind: 'color',
    description: 'Primary subtle border.',
  },
  {
    name: '--dsw-alias-border-l2',
    label: 'Border, strong',
    group: 'border',
    kind: 'color',
    description: 'Secondary stronger border.',
  },
  {
    name: '--dsw-alias-label-primary',
    label: 'Primary text',
    group: 'text',
    kind: 'color',
    description: 'Primary text colour.',
  },
  {
    name: '--dsw-alias-label-secondary',
    label: 'Secondary text',
    group: 'text',
    kind: 'color',
    description: 'Secondary text colour.',
  },
  {
    name: '--dsw-alias-brand-primary',
    label: 'Brand accent',
    group: 'accent',
    kind: 'color',
    description: 'Primary brand accent.',
  },
  {
    name: '--dsw-alias-state-error-primary',
    label: 'Error',
    group: 'state',
    kind: 'color',
    description: 'Primary error state colour.',
  },
  {
    name: '--dsw-alias-state-success-primary',
    label: 'Success',
    group: 'state',
    kind: 'color',
    description: 'Primary success state colour.',
  },
  {
    name: '--dsw-alias-state-warn-primary',
    label: 'Warning',
    group: 'state',
    kind: 'color',
    description: 'Primary warning state colour.',
  },
  {
    name: '--dsw-alias-state-idle-primary',
    label: 'Idle',
    group: 'state',
    kind: 'color',
    description: 'Primary inactive state colour.',
  },
]

/** Every documented token name, for validation. */
export const TOKEN_NAMES: readonly string[] = TOKEN_SPECS.map((spec) => spec.name)

/**
 * Look up one token's specification.
 * @param name - CSS custom property name.
 * @returns the specification, or `undefined` when the token is not documented.
 */
export function tokenSpec(name: string): TokenSpec | undefined {
  return TOKEN_SPECS.find((spec) => spec.name === name)
}

/** One shipped preset: a complete, legible theme in both modes. */
export interface ThemePreset {
  /** Stable id, used as the `basePreset` config value. */
  readonly id: string
  /** Display name. */
  readonly label: string
  /** One-line description shown on the preset card. */
  readonly description: string
  /** The base palette this preset reads as. */
  readonly colorScheme: 'light' | 'dark'
  /** Complete token set — every documented token, in both modes. */
  readonly tokens: Readonly<Record<string, TokenModes>>
}

/**
 * Shipped presets.
 *
 * Each is a complete token set rather than a partial overlay, so selecting one
 * gives a predictable result no matter what the generated base palette does.
 * The colours are chosen to keep body text at or above WCAG AA contrast against
 * their own surfaces, which the tests check.
 */
export const PRESETS: readonly ThemePreset[] = [
  {
    id: 'midnight',
    label: 'Midnight',
    description: 'Deep blue-black surfaces with a cool accent.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#f4f6fb', dark: '#0b1020' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#141a2e' },
      '--dsw-alias-bg-layer-2': { light: '#eef1f8', dark: '#1c2440' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#1f2745' },
      '--dsw-specific-sidebar-fill': { light: '#e9edf6', dark: '#080d1a' },
      '--dsw-alias-border-l1': { light: '#d9dfec', dark: '#232c48' },
      '--dsw-alias-border-l2': { light: '#c2cade', dark: '#33405f' },
      '--dsw-alias-label-primary': { light: '#111827', dark: '#e8ecf7' },
      '--dsw-alias-label-secondary': { light: '#4b5563', dark: '#9aa5bf' },
      '--dsw-alias-brand-primary': { light: '#2563eb', dark: '#7aa2ff' },
      '--dsw-alias-state-error-primary': { light: '#b91c1c', dark: '#ff8f8f' },
      '--dsw-alias-state-success-primary': { light: '#047857', dark: '#5fd4a0' },
      '--dsw-alias-state-warn-primary': { light: '#a16207', dark: '#f5c26b' },
      '--dsw-alias-state-idle-primary': { light: '#6b7280', dark: '#8792ab' },
    },
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Warm off-white surfaces with ink-black text.',
    colorScheme: 'light',
    tokens: {
      '--dsw-alias-bg-base': { light: '#faf7f0', dark: '#17150f' },
      '--dsw-alias-bg-layer-1': { light: '#fffdf8', dark: '#221f16' },
      '--dsw-alias-bg-layer-2': { light: '#f3efe4', dark: '#2b2619' },
      '--dsw-alias-bg-overlay': { light: '#fffdf8', dark: '#2f2a1c' },
      '--dsw-specific-sidebar-fill': { light: '#f2ecdf', dark: '#12100a' },
      '--dsw-alias-border-l1': { light: '#e2dcc9', dark: '#3a3323' },
      '--dsw-alias-border-l2': { light: '#cfc7ad', dark: '#4d442e' },
      '--dsw-alias-label-primary': { light: '#1c1a14', dark: '#f0ebdd' },
      '--dsw-alias-label-secondary': { light: '#5c5545', dark: '#b3aa92' },
      '--dsw-alias-brand-primary': { light: '#8a4b12', dark: '#e0a061' },
      '--dsw-alias-state-error-primary': { light: '#9b1c1c', dark: '#f08a8a' },
      '--dsw-alias-state-success-primary': { light: '#3f6212', dark: '#9fcb63' },
      '--dsw-alias-state-warn-primary': { light: '#8a5a00', dark: '#e8c063' },
      '--dsw-alias-state-idle-primary': { light: '#6f6757', dark: '#8e856f' },
    },
  },
  {
    id: 'high-contrast',
    label: 'High contrast',
    description: 'Maximum separation for low-vision use.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#ffffff', dark: '#000000' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#0a0a0a' },
      '--dsw-alias-bg-layer-2': { light: '#f2f2f2', dark: '#141414' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#141414' },
      '--dsw-specific-sidebar-fill': { light: '#ebebeb', dark: '#000000' },
      '--dsw-alias-border-l1': { light: '#767676', dark: '#8a8a8a' },
      '--dsw-alias-border-l2': { light: '#000000', dark: '#ffffff' },
      '--dsw-alias-label-primary': { light: '#000000', dark: '#ffffff' },
      '--dsw-alias-label-secondary': { light: '#3d3d3d', dark: '#d6d6d6' },
      '--dsw-alias-brand-primary': { light: '#0033cc', dark: '#8fb0ff' },
      '--dsw-alias-state-error-primary': { light: '#a10000', dark: '#ff9b9b' },
      '--dsw-alias-state-success-primary': { light: '#005c2b', dark: '#7dffb0' },
      '--dsw-alias-state-warn-primary': { light: '#6b4500', dark: '#ffd479' },
      '--dsw-alias-state-idle-primary': { light: '#4a4a4a', dark: '#b8b8b8' },
    },
  },
  {
    // Palette: https://draculatheme.com — bg #282a36, fg #f8f8f2, comment #6272a4.
    id: 'dracula',
    label: 'Dracula',
    description: 'The classic purple-on-charcoal editor theme.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fffbeb', dark: '#282a36' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#21222c' },
      '--dsw-alias-bg-layer-2': { light: '#f2ecd9', dark: '#343746' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#44475a' },
      '--dsw-specific-sidebar-fill': { light: '#f2ecd9', dark: '#21222c' },
      '--dsw-alias-border-l1': { light: '#dcd6c3', dark: '#44475a' },
      '--dsw-alias-border-l2': { light: '#c4bda6', dark: '#6272a4' },
      '--dsw-alias-label-primary': { light: '#1f1f1f', dark: '#f8f8f2' },
      '--dsw-alias-label-secondary': { light: '#6c664b', dark: '#8693bd' },
      '--dsw-alias-brand-primary': { light: '#644ac9', dark: '#bd93f9' },
      '--dsw-alias-state-error-primary': { light: '#cb3a2a', dark: '#ff5555' },
      '--dsw-alias-state-success-primary': { light: '#14710a', dark: '#50fa7b' },
      '--dsw-alias-state-warn-primary': { light: '#846e15', dark: '#f1fa8c' },
      '--dsw-alias-state-idle-primary': { light: '#6c664b', dark: '#6272a4' },
    },
  },
  {
    // Palette: https://www.nordtheme.com — nord0 #2e3440, nord4 #d8dee9, nord8 #88c0d0.
    id: 'nord',
    label: 'Nord',
    description: 'Arctic, north-bluish, with muted frost accents.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#eceff4', dark: '#2e3440' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#3b4252' },
      '--dsw-alias-bg-layer-2': { light: '#e5e9f0', dark: '#434c5e' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#4c566a' },
      '--dsw-specific-sidebar-fill': { light: '#e5e9f0', dark: '#292e39' },
      '--dsw-alias-border-l1': { light: '#d8dee9', dark: '#434c5e' },
      '--dsw-alias-border-l2': { light: '#b8c2d1', dark: '#4c566a' },
      '--dsw-alias-label-primary': { light: '#2e3440', dark: '#eceff4' },
      '--dsw-alias-label-secondary': { light: '#4c566a', dark: '#a3adc0' },
      '--dsw-alias-brand-primary': { light: '#5e81ac', dark: '#88c0d0' },
      '--dsw-alias-state-error-primary': { light: '#a33f4a', dark: '#bf616a' },
      '--dsw-alias-state-success-primary': { light: '#5a7d52', dark: '#a3be8c' },
      '--dsw-alias-state-warn-primary': { light: '#8a6a2f', dark: '#ebcb8b' },
      '--dsw-alias-state-idle-primary': { light: '#6d7b8c', dark: '#7b88a1' },
    },
  },
  {
    // Palette: https://github.com/catppuccin/palette — Mocha base #1e1e2e, text #cdd6f4, mauve #cba6f7.
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    description: 'Soothing pastels on the darkest Catppuccin flavour.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#eff1f5', dark: '#1e1e2e' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#181825' },
      '--dsw-alias-bg-layer-2': { light: '#e6e9ef', dark: '#313244' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#45475a' },
      '--dsw-specific-sidebar-fill': { light: '#e6e9ef', dark: '#11111b' },
      '--dsw-alias-border-l1': { light: '#ccd0da', dark: '#313244' },
      '--dsw-alias-border-l2': { light: '#acb0be', dark: '#45475a' },
      '--dsw-alias-label-primary': { light: '#4c4f69', dark: '#cdd6f4' },
      '--dsw-alias-label-secondary': { light: '#6c6f85', dark: '#a6adc8' },
      '--dsw-alias-brand-primary': { light: '#8839ef', dark: '#cba6f7' },
      '--dsw-alias-state-error-primary': { light: '#d20f39', dark: '#f38ba8' },
      '--dsw-alias-state-success-primary': { light: '#40a02b', dark: '#a6e3a1' },
      '--dsw-alias-state-warn-primary': { light: '#df8e1d', dark: '#f9e2af' },
      '--dsw-alias-state-idle-primary': { light: '#8c8fa1', dark: '#6c7086' },
    },
  },
  {
    // Palette: https://github.com/morhetz/gruvbox — dark0 #282828, fg1 #ebdbb2, orange #fe8019.
    id: 'gruvbox',
    label: 'Gruvbox',
    description: 'Retro groove warmth with earthy amber accents.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fbf1c7', dark: '#282828' },
      '--dsw-alias-bg-layer-1': { light: '#f9f5d7', dark: '#1d2021' },
      '--dsw-alias-bg-layer-2': { light: '#f2e5bc', dark: '#3c3836' },
      '--dsw-alias-bg-overlay': { light: '#f9f5d7', dark: '#504945' },
      '--dsw-specific-sidebar-fill': { light: '#f2e5bc', dark: '#1d2021' },
      '--dsw-alias-border-l1': { light: '#ebdbb2', dark: '#3c3836' },
      '--dsw-alias-border-l2': { light: '#d5c4a1', dark: '#504945' },
      '--dsw-alias-label-primary': { light: '#3c3836', dark: '#ebdbb2' },
      '--dsw-alias-label-secondary': { light: '#665c54', dark: '#a89984' },
      '--dsw-alias-brand-primary': { light: '#af3a03', dark: '#fe8019' },
      '--dsw-alias-state-error-primary': { light: '#9d0006', dark: '#fb4934' },
      '--dsw-alias-state-success-primary': { light: '#79740e', dark: '#b8bb26' },
      '--dsw-alias-state-warn-primary': { light: '#b57614', dark: '#fabd2f' },
      '--dsw-alias-state-idle-primary': { light: '#928374', dark: '#928374' },
    },
  },
  {
    // Palette: https://github.com/atom/one-dark-syntax — bg #282c34, fg #abb2bf, blue #61afef.
    id: 'one-dark',
    label: 'One Dark',
    description: "Atom's iconic blue-on-graphite editor theme.",
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fafafa', dark: '#282c34' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#21252b' },
      '--dsw-alias-bg-layer-2': { light: '#eaeaeb', dark: '#3e4451' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#3e4451' },
      '--dsw-specific-sidebar-fill': { light: '#eaeaeb', dark: '#21252b' },
      '--dsw-alias-border-l1': { light: '#dbdbdc', dark: '#3e4451' },
      '--dsw-alias-border-l2': { light: '#c0c0c2', dark: '#5c6370' },
      '--dsw-alias-label-primary': { light: '#383a42', dark: '#abb2bf' },
      '--dsw-alias-label-secondary': { light: '#696c77', dark: '#8b93a1' },
      '--dsw-alias-brand-primary': { light: '#4078f2', dark: '#61afef' },
      '--dsw-alias-state-error-primary': { light: '#e45649', dark: '#e06c75' },
      '--dsw-alias-state-success-primary': { light: '#50a14f', dark: '#98c379' },
      '--dsw-alias-state-warn-primary': { light: '#986801', dark: '#e5c07b' },
      '--dsw-alias-state-idle-primary': { light: '#a0a1a7', dark: '#5c6370' },
    },
  },
  {
    // Palette: https://ethanschoonover.com/solarized — base03 #002b36, base0 #839496, blue #268bd2.
    id: 'solarized',
    label: 'Solarized Dark',
    description: 'Precision low-contrast colours from Ethan Schoonover.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fdf6e3', dark: '#002b36' },
      '--dsw-alias-bg-layer-1': { light: '#fffbf0', dark: '#073642' },
      '--dsw-alias-bg-layer-2': { light: '#eee8d5', dark: '#0d4756' },
      '--dsw-alias-bg-overlay': { light: '#fffbf0', dark: '#0d4756' },
      '--dsw-specific-sidebar-fill': { light: '#eee8d5', dark: '#00252e' },
      '--dsw-alias-border-l1': { light: '#ddd6c1', dark: '#0d4756' },
      '--dsw-alias-border-l2': { light: '#c9c2ac', dark: '#586e75' },
      '--dsw-alias-label-primary': { light: '#073642', dark: '#93a1a1' },
      '--dsw-alias-label-secondary': { light: '#586e75', dark: '#839496' },
      '--dsw-alias-brand-primary': { light: '#268bd2', dark: '#268bd2' },
      '--dsw-alias-state-error-primary': { light: '#dc322f', dark: '#dc322f' },
      '--dsw-alias-state-success-primary': { light: '#859900', dark: '#859900' },
      '--dsw-alias-state-warn-primary': { light: '#b58900', dark: '#b58900' },
      '--dsw-alias-state-idle-primary': { light: '#93a1a1', dark: '#586e75' },
    },
  },
  {
    // Palette: https://rosepinetheme.com — base #191724, text #e0def4, rose #ebbcba.
    id: 'rose-pine',
    label: 'Rosé Pine',
    description: 'All natural pine, faux fur and a bit of Soho.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#faf4ed', dark: '#191724' },
      '--dsw-alias-bg-layer-1': { light: '#fffaf3', dark: '#1f1d2e' },
      '--dsw-alias-bg-layer-2': { light: '#f2e9e1', dark: '#26233a' },
      '--dsw-alias-bg-overlay': { light: '#fffaf3', dark: '#26233a' },
      '--dsw-specific-sidebar-fill': { light: '#f2e9e1', dark: '#1f1d2e' },
      '--dsw-alias-border-l1': { light: '#e5ded5', dark: '#26233a' },
      '--dsw-alias-border-l2': { light: '#d3cbc2', dark: '#403d52' },
      '--dsw-alias-label-primary': { light: '#575279', dark: '#e0def4' },
      '--dsw-alias-label-secondary': { light: '#797593', dark: '#908caa' },
      '--dsw-alias-brand-primary': { light: '#b4637a', dark: '#ebbcba' },
      '--dsw-alias-state-error-primary': { light: '#b4637a', dark: '#eb6f92' },
      '--dsw-alias-state-success-primary': { light: '#286983', dark: '#9ccfd8' },
      '--dsw-alias-state-warn-primary': { light: '#ea9d34', dark: '#f6c177' },
      '--dsw-alias-state-idle-primary': { light: '#9893a5', dark: '#6e6a86' },
    },
  },
  {
    // Palette: https://github.com/enkia/tokyo-night-vscode-theme — bg #1a1b26, fg #a9b1d6, blue #7aa2f7.
    id: 'tokyo-night',
    label: 'Tokyo Night',
    description: 'A clean dark theme that celebrates downtown Tokyo at night.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#e9e9ed', dark: '#1a1b26' },
      '--dsw-alias-bg-layer-1': { light: '#f5f5f7', dark: '#16161e' },
      '--dsw-alias-bg-layer-2': { light: '#dcdce3', dark: '#292e42' },
      '--dsw-alias-bg-overlay': { light: '#f5f5f7', dark: '#292e42' },
      '--dsw-specific-sidebar-fill': { light: '#dcdce3', dark: '#16161e' },
      '--dsw-alias-border-l1': { light: '#d0d0d9', dark: '#292e42' },
      '--dsw-alias-border-l2': { light: '#b6b8c4', dark: '#3b4261' },
      '--dsw-alias-label-primary': { light: '#343b58', dark: '#a9b1d6' },
      '--dsw-alias-label-secondary': { light: '#565f89', dark: '#7d86a4' },
      '--dsw-alias-brand-primary': { light: '#34548a', dark: '#7aa2f7' },
      '--dsw-alias-state-error-primary': { light: '#8c4351', dark: '#f7768e' },
      '--dsw-alias-state-success-primary': { light: '#485e30', dark: '#9ece6a' },
      '--dsw-alias-state-warn-primary': { light: '#8f5e15', dark: '#e0af68' },
      '--dsw-alias-state-idle-primary': { light: '#9699a3', dark: '#565f89' },
    },
  },
  {
    // Palette: https://github.com/ayu-theme — ayu dark bg #0d1017, fg #bfbdb6, orange #ff8f40.
    id: 'ayu-dark',
    label: 'Ayu Dark',
    description: 'Minimal dark theme with a bright amber accent.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fafafa', dark: '#0d1017' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#131721' },
      '--dsw-alias-bg-layer-2': { light: '#f0f0ee', dark: '#1f2430' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#1f2430' },
      '--dsw-specific-sidebar-fill': { light: '#f0f0ee', dark: '#0b0e14' },
      '--dsw-alias-border-l1': { light: '#e2e2de', dark: '#1f2430' },
      '--dsw-alias-border-l2': { light: '#c9c9c4', dark: '#2d3343' },
      '--dsw-alias-label-primary': { light: '#242936', dark: '#bfbdb6' },
      '--dsw-alias-label-secondary': { light: '#5c6773', dark: '#8a95a1' },
      '--dsw-alias-brand-primary': { light: '#e0882e', dark: '#ff8f40' },
      '--dsw-alias-state-error-primary': { light: '#d95757', dark: '#f26d78' },
      '--dsw-alias-state-success-primary': { light: '#6c9e4a', dark: '#aad94c' },
      '--dsw-alias-state-warn-primary': { light: '#c28c1f', dark: '#e6b450' },
      '--dsw-alias-state-idle-primary': { light: '#8a9199', dark: '#5c6773' },
    },
  },
  {
    // Palette: https://github.com/microsoft/vscode — GitHub Dark bg #0d1117, fg #c9d1d9, blue #58a6ff.
    id: 'github-dark',
    label: 'GitHub Dark',
    description: 'The familiar GitHub interface palette.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#ffffff', dark: '#0d1117' },
      '--dsw-alias-bg-layer-1': { light: '#f6f8fa', dark: '#161b22' },
      '--dsw-alias-bg-layer-2': { light: '#eaeef2', dark: '#21262d' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#21262d' },
      '--dsw-specific-sidebar-fill': { light: '#f6f8fa', dark: '#010409' },
      '--dsw-alias-border-l1': { light: '#d0d7de', dark: '#30363d' },
      '--dsw-alias-border-l2': { light: '#afb8c1', dark: '#484f58' },
      '--dsw-alias-label-primary': { light: '#1f2328', dark: '#c9d1d9' },
      '--dsw-alias-label-secondary': { light: '#656d76', dark: '#8b949e' },
      '--dsw-alias-brand-primary': { light: '#0969da', dark: '#58a6ff' },
      '--dsw-alias-state-error-primary': { light: '#cf222e', dark: '#f85149' },
      '--dsw-alias-state-success-primary': { light: '#1a7f37', dark: '#3fb950' },
      '--dsw-alias-state-warn-primary': { light: '#9a6700', dark: '#d29922' },
      '--dsw-alias-state-idle-primary': { light: '#6e7781', dark: '#484f58' },
    },
  },
  {
    // Palette: https://github.com/Monokai/monokai — bg #272822, fg #f8f8f2, pink #f92672.
    id: 'monokai',
    label: 'Monokai',
    description: 'The Sublime Text original, with its hot-pink accent.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fafaf5', dark: '#272822' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#1e1f1c' },
      '--dsw-alias-bg-layer-2': { light: '#f0efe5', dark: '#3e3d32' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#3e3d32' },
      '--dsw-specific-sidebar-fill': { light: '#f0efe5', dark: '#1e1f1c' },
      '--dsw-alias-border-l1': { light: '#e0dfd1', dark: '#3e3d32' },
      '--dsw-alias-border-l2': { light: '#c6c5b3', dark: '#575744' },
      '--dsw-alias-label-primary': { light: '#272822', dark: '#f8f8f2' },
      '--dsw-alias-label-secondary': { light: '#75715e', dark: '#8a9199' },
      '--dsw-alias-brand-primary': { light: '#c2185b', dark: '#f92672' },
      '--dsw-alias-state-error-primary': { light: '#d13b2f', dark: '#f92672' },
      '--dsw-alias-state-success-primary': { light: '#567f0e', dark: '#a6e22e' },
      '--dsw-alias-state-warn-primary': { light: '#b07d1a', dark: '#e6db74' },
      '--dsw-alias-state-idle-primary': { light: '#8d8b7c', dark: '#75715e' },
    },
  },  {
    id: 'mono',
    label: 'Mono',
    description: 'Grayscale everywhere except state colours.',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#f5f5f5', dark: '#101010' },
      '--dsw-alias-bg-layer-1': { light: '#ffffff', dark: '#1a1a1a' },
      '--dsw-alias-bg-layer-2': { light: '#ececec', dark: '#242424' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#282828' },
      '--dsw-specific-sidebar-fill': { light: '#e8e8e8', dark: '#0a0a0a' },
      '--dsw-alias-border-l1': { light: '#d4d4d4', dark: '#2e2e2e' },
      '--dsw-alias-border-l2': { light: '#b0b0b0', dark: '#454545' },
      '--dsw-alias-label-primary': { light: '#0a0a0a', dark: '#ededed' },
      '--dsw-alias-label-secondary': { light: '#525252', dark: '#a3a3a3' },
      '--dsw-alias-brand-primary': { light: '#262626', dark: '#d4d4d4' },
      '--dsw-alias-state-error-primary': { light: '#b42318', dark: '#ff9184' },
      '--dsw-alias-state-success-primary': { light: '#0a6b45', dark: '#6fd9a8' },
      '--dsw-alias-state-warn-primary': { light: '#8a5c00', dark: '#e8bf6a' },
      '--dsw-alias-state-idle-primary': { light: '#6b6b6b', dark: '#8f8f8f' },
    },
  },
  {
    id: 'kanagawa-wave',
    label: 'Kanagawa',
    description: 'The Great Wave ink palette',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#f2ecbc', dark: '#1f1f28' },
      '--dsw-alias-bg-layer-1': { light: '#e7dba0', dark: '#2a2a37' },
      '--dsw-alias-bg-layer-2': { light: '#e4d794', dark: '#363646' },
      '--dsw-alias-bg-overlay': { light: '#d5cea3', dark: '#223249' },
      '--dsw-specific-sidebar-fill': { light: '#dcd5ac', dark: '#181820' },
      '--dsw-alias-border-l1': { light: '#a09cac', dark: '#363646' },
      '--dsw-alias-border-l2': { light: '#716e61', dark: '#54546d' },
      '--dsw-alias-label-primary': { light: '#545464', dark: '#dcd7ba' },
      '--dsw-alias-label-secondary': { light: '#43436c', dark: '#c8c093' },
      '--dsw-alias-brand-primary': { light: '#4d699b', dark: '#7e9cd8' },
      '--dsw-alias-state-error-primary': { light: '#c84053', dark: '#e82424' },
      '--dsw-alias-state-success-primary': { light: '#6f894e', dark: '#98bb6c' },
      '--dsw-alias-state-warn-primary': { light: '#cc6d00', dark: '#ff9e3b' },
      '--dsw-alias-state-idle-primary': { light: '#8a8980', dark: '#727169' },
    },
  },
  {
    id: 'everforest',
    label: 'Everforest',
    description: 'Muted forest greens on warm paper',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fdf6e3', dark: '#2d353b' },
      '--dsw-alias-bg-layer-1': { light: '#f4f0d9', dark: '#343f44' },
      '--dsw-alias-bg-layer-2': { light: '#efebd4', dark: '#3d484d' },
      '--dsw-alias-bg-overlay': { light: '#e6e2cc', dark: '#475258' },
      '--dsw-specific-sidebar-fill': { light: '#efebd4', dark: '#232a2e' },
      '--dsw-alias-border-l1': { light: '#e0dcc7', dark: '#475258' },
      '--dsw-alias-border-l2': { light: '#bdc3af', dark: '#56635f' },
      '--dsw-alias-label-primary': { light: '#5c6a72', dark: '#d3c6aa' },
      '--dsw-alias-label-secondary': { light: '#63707a', dark: '#9da9a0' },
      '--dsw-alias-brand-primary': { light: '#3a94c5', dark: '#7fbbb3' },
      '--dsw-alias-state-error-primary': { light: '#f85552', dark: '#e67e80' },
      '--dsw-alias-state-success-primary': { light: '#8da101', dark: '#a7c080' },
      '--dsw-alias-state-warn-primary': { light: '#dfa000', dark: '#dbbc7f' },
      '--dsw-alias-state-idle-primary': { light: '#829181', dark: '#859289' },
    },
  },
  {
    id: 'night-owl',
    label: 'Night Owl',
    description: 'Late-night blues, balanced in daylight',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fbfbfb', dark: '#011627' },
      '--dsw-alias-bg-layer-1': { light: '#f0f0f0', dark: '#0b253a' },
      '--dsw-alias-bg-layer-2': { light: '#e0e7ea', dark: '#0b2942' },
      '--dsw-alias-bg-overlay': { light: '#f6f6f6', dark: '#2c3043' },
      '--dsw-specific-sidebar-fill': { light: '#f0f0f0', dark: '#011627' },
      '--dsw-alias-border-l1': { light: '#d9d9d9', dark: '#122d42' },
      '--dsw-alias-border-l2': { light: '#93a1a1', dark: '#5f7e97' },
      '--dsw-alias-label-primary': { light: '#403f53', dark: '#d6deeb' },
      '--dsw-alias-label-secondary': { light: '#697098', dark: '#89a4bb' },
      '--dsw-alias-brand-primary': { light: '#4876d6', dark: '#82aaff' },
      '--dsw-alias-state-error-primary': { light: '#de3d3b', dark: '#ef5350' },
      '--dsw-alias-state-success-primary': { light: '#08916a', dark: '#22da6e' },
      '--dsw-alias-state-warn-primary': { light: '#daaa01', dark: '#ffca28' },
      '--dsw-alias-state-idle-primary': { light: '#93a1a1', dark: '#5f7e97' },
    },
  },
  {
    id: 'material-palenight',
    label: 'Material Palenight',
    description: 'Deep indigo with material accents',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#f8f8fc', dark: '#292d3e' },
      '--dsw-alias-bg-layer-1': { light: '#eeeef5', dark: '#34324a' },
      '--dsw-alias-bg-layer-2': { light: '#e4e4ee', dark: '#414863' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#202331' },
      '--dsw-specific-sidebar-fill': { light: '#eeeef5', dark: '#202331' },
      '--dsw-alias-border-l1': { light: '#d8d8e4', dark: '#2b2a3e' },
      '--dsw-alias-border-l2': { light: '#b8b8cc', dark: '#414863' },
      '--dsw-alias-label-primary': { light: '#292d3e', dark: '#a6accd' },
      '--dsw-alias-label-secondary': { light: '#5a5f7d', dark: '#8f95bd' },
      '--dsw-alias-brand-primary': { light: '#9c27b0', dark: '#ab47bc' },
      '--dsw-alias-state-error-primary': { light: '#d32f2f', dark: '#ff5370' },
      '--dsw-alias-state-success-primary': { light: '#388e3c', dark: '#c3e88d' },
      '--dsw-alias-state-warn-primary': { light: '#f57c00', dark: '#ffcb6b' },
      '--dsw-alias-state-idle-primary': { light: '#757575', dark: '#676e95' },
    },
  },
  {
    id: 'synthwave-84',
    label: "Synthwave '84",
    description: 'Neon eighties sunset chrome',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#faf5ff', dark: '#262335' },
      '--dsw-alias-bg-layer-1': { light: '#f2e9fa', dark: '#2a2139' },
      '--dsw-alias-bg-layer-2': { light: '#e9ddf5', dark: '#34294f' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#171520' },
      '--dsw-specific-sidebar-fill': { light: '#f2e9fa', dark: '#241b2f' },
      '--dsw-alias-border-l1': { light: '#dccce9', dark: '#444251' },
      '--dsw-alias-border-l2': { light: '#b9a3cc', dark: '#495495' },
      '--dsw-alias-label-primary': { light: '#241b2f', dark: '#ffffff' },
      '--dsw-alias-label-secondary': { light: '#5c4a70', dark: '#b6b1b1' },
      '--dsw-alias-brand-primary': { light: '#b8008a', dark: '#ff7edb' },
      '--dsw-alias-state-error-primary': { light: '#c81e3a', dark: '#fe4450' },
      '--dsw-alias-state-success-primary': { light: '#1f8a5b', dark: '#72f1b8' },
      '--dsw-alias-state-warn-primary': { light: '#a86f00', dark: '#fede5d' },
      '--dsw-alias-state-idle-primary': { light: '#7a6b8a', dark: '#848bbd' },
    },
  },
  {
    id: 'cobalt2',
    label: 'Cobalt2',
    description: 'Cobalt blue with electric yellow',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#f4f9fd', dark: '#193549' },
      '--dsw-alias-bg-layer-1': { light: '#e8f1f8', dark: '#1f4662' },
      '--dsw-alias-bg-layer-2': { light: '#d8e8f3', dark: '#234e6d' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#122738' },
      '--dsw-specific-sidebar-fill': { light: '#e8f1f8', dark: '#122738' },
      '--dsw-alias-border-l1': { light: '#cfe0ec', dark: '#0d3a58' },
      '--dsw-alias-border-l2': { light: '#9fb6c8', dark: '#35434d' },
      '--dsw-alias-label-primary': { light: '#122738', dark: '#ffffff' },
      '--dsw-alias-label-secondary': { light: '#3b5568', dark: '#b8d4e8' },
      '--dsw-alias-brand-primary': { light: '#b88600', dark: '#ffc600' },
      '--dsw-alias-state-error-primary': { light: '#c62828', dark: '#ff628c' },
      '--dsw-alias-state-success-primary': { light: '#2e7d32', dark: '#2affdf' },
      '--dsw-alias-state-warn-primary': { light: '#a15c00', dark: '#ff9d00' },
      '--dsw-alias-state-idle-primary': { light: '#6b7f8f', dark: '#8fa8b8' },
    },
  },
  {
    id: 'zenburn',
    label: 'Zenburn',
    description: 'Warm low-contrast zen coding',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#f4f3ea', dark: '#3f3f3f' },
      '--dsw-alias-bg-layer-1': { light: '#e8e7db', dark: '#434443' },
      '--dsw-alias-bg-layer-2': { light: '#dcdbcc', dark: '#4a4a4a' },
      '--dsw-alias-bg-overlay': { light: '#faf9f2', dark: '#2c2e2e' },
      '--dsw-specific-sidebar-fill': { light: '#e8e7db', dark: '#333333' },
      '--dsw-alias-border-l1': { light: '#d0cfbf', dark: '#545a4f' },
      '--dsw-alias-border-l2': { light: '#a8a894', dark: '#5b605e' },
      '--dsw-alias-label-primary': { light: '#2f2f2f', dark: '#dcdccc' },
      '--dsw-alias-label-secondary': { light: '#5f5f5f', dark: '#9fafaf' },
      '--dsw-alias-brand-primary': { light: '#5f7f5f', dark: '#8cd0d3' },
      '--dsw-alias-state-error-primary': { light: '#bc6c4c', dark: '#bc6c4c' },
      '--dsw-alias-state-success-primary': { light: '#5f7f5f', dark: '#7f9f7f' },
      '--dsw-alias-state-warn-primary': { light: '#8a6d1f', dark: '#dfaf8f' },
      '--dsw-alias-state-idle-primary': { light: '#808080', dark: '#8f8f8f' },
    },
  },
  {
    id: 'geist',
    label: 'Geist',
    description: 'Vercel monochrome with electric blue',
    colorScheme: 'light',
    tokens: {
      '--dsw-alias-bg-base': { light: '#ffffff', dark: '#000000' },
      '--dsw-alias-bg-layer-1': { light: '#fafafa', dark: '#0a0a0a' },
      '--dsw-alias-bg-layer-2': { light: '#f2f2f2', dark: '#1a1a1a' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#1a1a1a' },
      '--dsw-specific-sidebar-fill': { light: '#fafafa', dark: '#000000' },
      '--dsw-alias-border-l1': { light: '#eaeaea', dark: '#2e2e2e' },
      '--dsw-alias-border-l2': { light: '#a8a8a8', dark: '#454545' },
      '--dsw-alias-label-primary': { light: '#171717', dark: '#ededed' },
      '--dsw-alias-label-secondary': { light: '#4d4d4d', dark: '#a1a1a1' },
      '--dsw-alias-brand-primary': { light: '#0072f5', dark: '#0072f5' },
      '--dsw-alias-state-error-primary': { light: '#e5484d', dark: '#e5484d' },
      '--dsw-alias-state-success-primary': { light: '#45a557', dark: '#45a557' },
      '--dsw-alias-state-warn-primary': { light: '#e79d13', dark: '#e79d13' },
      '--dsw-alias-state-idle-primary': { light: '#8f8f8f', dark: '#878787' },
    },
  },
  {
    id: 'github-light',
    label: 'GitHub Light',
    description: 'The familiar GitHub canvas in daylight',
    colorScheme: 'light',
    tokens: {
      '--dsw-alias-bg-base': { light: '#ffffff', dark: '#0d1117' },
      '--dsw-alias-bg-layer-1': { light: '#f6f8fa', dark: '#151b23' },
      '--dsw-alias-bg-layer-2': { light: '#eff2f5', dark: '#212830' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#161b22' },
      '--dsw-specific-sidebar-fill': { light: '#f6f8fa', dark: '#0d1117' },
      '--dsw-alias-border-l1': { light: '#d1d9e0', dark: '#3d444d' },
      '--dsw-alias-border-l2': { light: '#818b98', dark: '#656c76' },
      '--dsw-alias-label-primary': { light: '#1f2328', dark: '#f0f6fc' },
      '--dsw-alias-label-secondary': { light: '#59636e', dark: '#9198a1' },
      '--dsw-alias-brand-primary': { light: '#0969da', dark: '#4493f8' },
      '--dsw-alias-state-error-primary': { light: '#d1242f', dark: '#f85149' },
      '--dsw-alias-state-success-primary': { light: '#1a7f37', dark: '#3fb950' },
      '--dsw-alias-state-warn-primary': { light: '#9a6700', dark: '#d29922' },
      '--dsw-alias-state-idle-primary': { light: '#818b98', dark: '#656c76' },
    },
  },
  {
    id: 'one-light',
    label: 'One Light',
    description: "Atom's balanced light theme",
    colorScheme: 'light',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fafafa', dark: '#282c34' },
      '--dsw-alias-bg-layer-1': { light: '#f0f0f0', dark: '#21252b' },
      '--dsw-alias-bg-layer-2': { light: '#e5e5e6', dark: '#2c313a' },
      '--dsw-alias-bg-overlay': { light: '#ffffff', dark: '#21252b' },
      '--dsw-specific-sidebar-fill': { light: '#f0f0f0', dark: '#21252b' },
      '--dsw-alias-border-l1': { light: '#dbdbdc', dark: '#3e4451' },
      '--dsw-alias-border-l2': { light: '#c7c7c8', dark: '#4b5263' },
      '--dsw-alias-label-primary': { light: '#383a42', dark: '#abb2bf' },
      '--dsw-alias-label-secondary': { light: '#696c77', dark: '#9da5b4' },
      '--dsw-alias-brand-primary': { light: '#4078f2', dark: '#61afef' },
      '--dsw-alias-state-error-primary': { light: '#e45649', dark: '#e06c75' },
      '--dsw-alias-state-success-primary': { light: '#50a14f', dark: '#98c379' },
      '--dsw-alias-state-warn-primary': { light: '#c18401', dark: '#e5c07b' },
      '--dsw-alias-state-idle-primary': { light: '#a0a1a7', dark: '#5c6370' },
    },
  },
  {
    id: 'gruvbox-light',
    label: 'Gruvbox Light',
    description: 'Retro groove warmth on cream paper',
    colorScheme: 'light',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fbf1c7', dark: '#282828' },
      '--dsw-alias-bg-layer-1': { light: '#ebdbb2', dark: '#3c3836' },
      '--dsw-alias-bg-layer-2': { light: '#d5c4a1', dark: '#504945' },
      '--dsw-alias-bg-overlay': { light: '#f2e5bc', dark: '#32302f' },
      '--dsw-specific-sidebar-fill': { light: '#f2e5bc', dark: '#1d2021' },
      '--dsw-alias-border-l1': { light: '#d5c4a1', dark: '#504945' },
      '--dsw-alias-border-l2': { light: '#bdae93', dark: '#665c54' },
      '--dsw-alias-label-primary': { light: '#3c3836', dark: '#ebdbb2' },
      '--dsw-alias-label-secondary': { light: '#504945', dark: '#bdae93' },
      '--dsw-alias-brand-primary': { light: '#458588', dark: '#fabd2f' },
      '--dsw-alias-state-error-primary': { light: '#cc241d', dark: '#fb4934' },
      '--dsw-alias-state-success-primary': { light: '#79740e', dark: '#b8bb26' },
      '--dsw-alias-state-warn-primary': { light: '#d65d0e', dark: '#fe8019' },
      '--dsw-alias-state-idle-primary': { light: '#928374', dark: '#928374' },
    },
  },
  {
    id: 'tokyo-night-day',
    label: 'Tokyo Night Day',
    description: 'Tokyo neon, dialled down for daylight',
    colorScheme: 'light',
    tokens: {
      '--dsw-alias-bg-base': { light: '#e6e7ed', dark: '#1a1b26' },
      '--dsw-alias-bg-layer-1': { light: '#d6d8df', dark: '#1f2335' },
      '--dsw-alias-bg-layer-2': { light: '#dcdee3', dark: '#292e42' },
      '--dsw-alias-bg-overlay': { light: '#dcdee3', dark: '#1f2335' },
      '--dsw-specific-sidebar-fill': { light: '#d6d8df', dark: '#16161e' },
      '--dsw-alias-border-l1': { light: '#c1c2c7', dark: '#292e42' },
      '--dsw-alias-border-l2': { light: '#707280', dark: '#414868' },
      '--dsw-alias-label-primary': { light: '#363c4d', dark: '#c0caf5' },
      '--dsw-alias-label-secondary': { light: '#4a5272', dark: '#a9b1d6' },
      '--dsw-alias-brand-primary': { light: '#2959aa', dark: '#7aa2f7' },
      '--dsw-alias-state-error-primary': { light: '#942f2f', dark: '#f7768e' },
      '--dsw-alias-state-success-primary': { light: '#385f0d', dark: '#9ece6a' },
      '--dsw-alias-state-warn-primary': { light: '#8f5e15', dark: '#e0af68' },
      '--dsw-alias-state-idle-primary': { light: '#707280', dark: '#565f89' },
    },
  },
  {
    id: 'solarized-light',
    label: 'Solarized Light',
    description: 'Precision low-contrast colours in daylight',
    colorScheme: 'light',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fdf6e3', dark: '#002b36' },
      '--dsw-alias-bg-layer-1': { light: '#eee8d5', dark: '#073642' },
      '--dsw-alias-bg-layer-2': { light: '#eee8d5', dark: '#073642' },
      '--dsw-alias-bg-overlay': { light: '#eee8d5', dark: '#073642' },
      '--dsw-specific-sidebar-fill': { light: '#fdf6e3', dark: '#002b36' },
      '--dsw-alias-border-l1': { light: '#93a1a1', dark: '#586e75' },
      '--dsw-alias-border-l2': { light: '#839496', dark: '#657b83' },
      '--dsw-alias-label-primary': { light: '#52686f', dark: '#93a1a1' },
      '--dsw-alias-label-secondary': { light: '#5c727a', dark: '#839496' },
      '--dsw-alias-brand-primary': { light: '#268bd2', dark: '#268bd2' },
      '--dsw-alias-state-error-primary': { light: '#dc322f', dark: '#dc322f' },
      '--dsw-alias-state-success-primary': { light: '#859900', dark: '#859900' },
      '--dsw-alias-state-warn-primary': { light: '#b58900', dark: '#b58900' },
      '--dsw-alias-state-idle-primary': { light: '#93a1a1', dark: '#586e75' },
    },
  },
  {
    id: 'rose-pine-dawn',
    label: 'Rosé Pine Dawn',
    description: 'Rosy dusk in soft dawn pastels',
    colorScheme: 'light',
    tokens: {
      '--dsw-alias-bg-base': { light: '#faf4ed', dark: '#232136' },
      '--dsw-alias-bg-layer-1': { light: '#fffaf3', dark: '#2a273f' },
      '--dsw-alias-bg-layer-2': { light: '#f2e9e1', dark: '#393552' },
      '--dsw-alias-bg-overlay': { light: '#f4ede8', dark: '#44415a' },
      '--dsw-specific-sidebar-fill': { light: '#fffaf3', dark: '#1f1d30' },
      '--dsw-alias-border-l1': { light: '#dfdad9', dark: '#44415a' },
      '--dsw-alias-border-l2': { light: '#cecacd', dark: '#56526e' },
      '--dsw-alias-label-primary': { light: '#464261', dark: '#e0def4' },
      '--dsw-alias-label-secondary': { light: '#6b6785', dark: '#908caa' },
      '--dsw-alias-brand-primary': { light: '#907aa9', dark: '#c4a7e7' },
      '--dsw-alias-state-error-primary': { light: '#b4637a', dark: '#eb6f92' },
      '--dsw-alias-state-success-primary': { light: '#56949f', dark: '#9ccfd8' },
      '--dsw-alias-state-warn-primary': { light: '#ea9d34', dark: '#f6c177' },
      '--dsw-alias-state-idle-primary': { light: '#9893a5', dark: '#6e6a86' },
    },
  },
  {
    id: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    description: 'Soothing pastels on the lightest Catppuccin flavour',
    colorScheme: 'light',
    tokens: {
      '--dsw-alias-bg-base': { light: '#eff1f5', dark: '#1e1e2e' },
      '--dsw-alias-bg-layer-1': { light: '#e6e9ef', dark: '#313244' },
      '--dsw-alias-bg-layer-2': { light: '#ccd0da', dark: '#45475a' },
      '--dsw-alias-bg-overlay': { light: '#dce0e8', dark: '#11111b' },
      '--dsw-specific-sidebar-fill': { light: '#e6e9ef', dark: '#181825' },
      '--dsw-alias-border-l1': { light: '#ccd0da', dark: '#45475a' },
      '--dsw-alias-border-l2': { light: '#bcc0cc', dark: '#585b70' },
      '--dsw-alias-label-primary': { light: '#4c4f69', dark: '#cdd6f4' },
      '--dsw-alias-label-secondary': { light: '#5c5f77', dark: '#a6adc8' },
      '--dsw-alias-brand-primary': { light: '#8839ef', dark: '#cba6f7' },
      '--dsw-alias-state-error-primary': { light: '#d20f39', dark: '#f38ba8' },
      '--dsw-alias-state-success-primary': { light: '#40a02b', dark: '#a6e3a1' },
      '--dsw-alias-state-warn-primary': { light: '#df8e1d', dark: '#f9e2af' },
      '--dsw-alias-state-idle-primary': { light: '#8c8fa1', dark: '#6c7086' },
    },
  },
]

/** Every preset id, for validation. */
export const PRESET_IDS: readonly string[] = PRESETS.map((preset) => preset.id)

/**
 * Look up one preset by id.
 * @param id - preset id.
 * @returns the preset, or `undefined` for an unknown or `none` id.
 */
export function findPreset(id: string): ThemePreset | undefined {
  return PRESETS.find((preset) => preset.id === id)
}

/** The role names the theme runtime accepts for typography. */
export const FONT_ROLES = ['text', 'code', 'terminal'] as const

/** One font role. */
export type FontRole = (typeof FONT_ROLES)[number]

export const FONT_FAMILY_FIELDS: Readonly<Record<FontRole, 'textFontFamily' | 'codeFontFamily' | 'terminalFontFamily'>> = {
  text: 'textFontFamily',
  code: 'codeFontFamily',
  terminal: 'terminalFontFamily',
}

export const FONT_SIZE_FIELDS: Readonly<Record<FontRole, 'fontSize' | 'codeFontSize' | 'terminalFontSize'>> = {
  text: 'fontSize',
  code: 'codeFontSize',
  terminal: 'terminalFontSize',
}

/** Accepted font-size range per role, mirroring the shipped Appearance rows. */
export const FONT_SIZE_RANGES: Readonly<Record<FontRole, { readonly min: number; readonly max: number; readonly fallback: number }>> = {
  text: { min: 10, max: 22, fallback: 14 },
  code: { min: 10, max: 16, fallback: 11 },
  terminal: { min: 10, max: 20, fallback: 13 },
}

/** Density presets, expressed as a spacing multiplier applied to derived tokens. */
export const DENSITIES = ['compact', 'comfortable', 'spacious'] as const

/** One density option. */
export type Density = (typeof DENSITIES)[number]

/** Radius bounds in pixels. */
export const RADIUS_MIN = 0

/** Upper radius bound in pixels. */
export const RADIUS_MAX = 24

export const DEFAULT_GEOMETRY: { readonly radius: number; readonly density: Density } = {
  radius: 8,
  density: 'comfortable',
}
