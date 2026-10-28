/**
 * Client half: keep the theme override layer in step with the document.
 *
 * The browser half owns exactly one thing — the `ctx.theme.overrideTokens` layer
 * this plugin stacks over whatever theme is active. It re-derives that layer
 * whenever the customization document changes, so a change made in the panel
 * reaches the screen without a reload, and removing it restores whatever it
 * covered.
 *
 * Two rules matter here:
 *
 * - **One source, one layer.** `overrideTokens` allows one layer per source and
 *   a repeat call replaces it wholesale, so the plugin never leaks layers: every
 *   update re-registers under the same source id.
 * - **Both palette modes always travel together.** The resolver guarantees it, and
 *   the runtime rejects a bare string, so a half-specified token can never
 *   produce an illegible surface after a scheme switch.
 *
 * @module @d0nj/dsh-ui-custom/client
 */
import type { Context } from '@deepseek-ai/cordis'

import { PRESETS, TOKEN_SPECS } from '../spec.js'
import { resolveCustomization } from '../resolve.js'
import { ThemeStudio } from './panel.js'
import type { PanelActions, PanelState } from './panel.js'
import type { CustomizationDocument } from '../resolve.js'

/** One token's value per palette mode, as ctx.theme.overrideTokens requires. */
export type ThemeTokenOverrides = Record<string, { light: string; dark: string }>

/** Layer identity; the runtime keeps one layer per source. */
export const OVERRIDE_SOURCE = 'd0nj-ui-custom'

/**
 * The slice of the theme service this plugin uses.
 *
 * Declared structurally rather than imported as a class so the module stays
 * loadable when the theme package's internal path changes; `inject` already
 * guarantees the service exists before `apply` runs.
 */
interface ThemeService {
  register(definition: {
    id: string
    colorScheme: 'light' | 'dark'
    tokens: Record<string, string>
  }): () => void
  overrideTokens(source: string, tokens: ThemeTokenOverrides): () => void
  setFontFamily(role: 'text' | 'code' | 'terminal', value: string): void
  setFontSize(role: 'text' | 'code' | 'terminal', px: number): void
  getTheme(): unknown
}

/** The slice of the settings client this plugin uses to read and write its document. */
interface ConfigForm {
  getSnapshot(): { readonly value: unknown; readonly revision: number | undefined; readonly writable: boolean }
  subscribe(listener: () => void): () => void
  mutate(ops: readonly { op: 'set'; path: readonly string[]; value: unknown }[]): Promise<boolean>
  set(field: string, value: unknown): Promise<boolean>
}

/** Services required before `apply` runs. */
export const inject = ['theme', 'configForms', 'slots'] as const

/**
 * The React namespace, handed in by the module envelope.
 *
 * The browser loader resolves React through its own module table, so a client
 * half cannot import it. The stamped envelope calls useReact before apply,
 * which keeps the dependency explicit instead of reading an ambient global.
 */
let ReactImpl: Parameters<typeof ThemeStudio>[0] | undefined

/**
 * Provide the React namespace to this plugin.
 * @param react - the namespace the loader resolved.
 */
export function useReact(react: Parameters<typeof ThemeStudio>[0]): void {
  ReactImpl = react
}

/**
 * Flatten a preset's per-mode tokens to the single value the `register` arm
 * expects, picking the mode that matches the preset's own base palette.
 *
 * `register` takes a flat `tokens` map rather than the two-mode shape
 * `overrideTokens` accepts, so the mapping has to happen somewhere; doing it
 * here keeps the colorScheme and the chosen values from disagreeing.
 *
 * @param preset - one shipped preset.
 * @returns the flat token map for `register`.
 */
function flatPresetTokens(preset: (typeof PRESETS)[number]): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const [name, modes] of Object.entries(preset.tokens)) {
    tokens[name] = preset.colorScheme === 'dark' ? modes.dark : modes.light
  }
  return tokens
}

/**
 * Normalize the stored value into a document.
 *
 * The settings snapshot carries the parsed namespace value, which is already
 * shaped like the config; this narrows it without trusting the transport.
 * @param value - snapshot value.
 * @returns the document to resolve.
 */
function asDocument(value: unknown): CustomizationDocument {
  const fallback: CustomizationDocument = {
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
  }
  if (value === null || typeof value !== 'object') return fallback
  const record = value as Record<string, unknown>
  const typography = record.typography
  const geometry = record.geometry
  return {
    basePreset: typeof record.basePreset === 'string' ? record.basePreset : 'none',
    tokens:
      record.tokens !== null && typeof record.tokens === 'object'
        ? (record.tokens as CustomizationDocument['tokens'])
        : {},
    typography: {
      ...fallback.typography,
      ...(typography !== null && typeof typography === 'object'
        ? (typography as Partial<CustomizationDocument['typography']>)
        : {}),
    },
    geometry: {
      ...fallback.geometry,
      ...(geometry !== null && typeof geometry === 'object'
        ? (geometry as Partial<CustomizationDocument['geometry']>)
        : {}),
    },
  }
}

/**
 * Client plugin body.
 * @param ctx - client cordis context with `theme` and `configForms` injected.
 */
export function apply(ctx: Context): void {
  // A throw here fails the whole web boot (1 entry did not activate), which takes
  // the UI down for a customization plugin. Every step is therefore guarded: a
  // problem is reported once and the rest of the harness keeps working.
  try {
    applyInner(ctx)
  } catch (error) {
    reportFailure(ctx, error)
  }
}

/**
 * Report one fatal setup failure without rethrowing.
 * @param ctx - client context.
 * @param error - the failure.
 */
function reportFailure(ctx: Context, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  const logger = (ctx as unknown as { logger?: (name: string) => { error: (msg: string) => void } }).logger
  logger?.('ui-custom').error("theme customization disabled: " + message)
}

/**
 * The real client body, called under a guard by {@link apply}.
 * @param ctx - client context.
 */
function applyInner(ctx: Context): void {
  const theme = (ctx as unknown as { theme: ThemeService }).theme
  const forms = (ctx as unknown as { configForms: { get(ns: string): ConfigForm } }).configForms

  // Presets register once, as real themes, so they appear among the normal
  // choices and survive a reload even if this plugin's override layer is empty.
  for (const preset of PRESETS) {
    try {
      ctx.effect(() => theme.register({
        id: preset.id,
        colorScheme: preset.colorScheme,
        tokens: flatPresetTokens(preset),
      }))
    } catch (error) {
      // A preset id that is already taken (the built-in light/dark pair, or a
      // re-registration after HMR) must not cost the user the editor.
      reportFailure(ctx, error)
    }
  }

  const form = forms.get('ui-custom')
  let disposeLayer: (() => void) | undefined
  // The last typography this plugin applied, so it writes only real changes and
  // never fights the shipped Appearance rows on every snapshot.
  let appliedTypography = ''

  /**
   * Recompute the layer from the stored document.
   */
  const refresh = (): void => {
    const snapshot = form.getSnapshot()
    if (snapshot.value === undefined) return
    const resolved = resolveCustomization(asDocument(snapshot.value))
    disposeLayer?.()
    disposeLayer = theme.overrideTokens(OVERRIDE_SOURCE, resolved.tokens)

    // Typography goes through the theme service's own entries, so the built-in
    // rows and this panel share one source of truth instead of shadowing each
    // other. Sizes are only written when they differ, because each write is a
    // settings mutation.
    const typography = resolved.typography
    const key = JSON.stringify(typography)
    if (key !== appliedTypography) {
      appliedTypography = key
      const roles: readonly [('text' | 'code' | 'terminal'), string, number][] = [
        ['text', typography.textFontFamily, typography.fontSize],
        ['code', typography.codeFontFamily, typography.codeFontSize],
        ['terminal', typography.terminalFontFamily, typography.terminalFontSize],
      ]
      for (const [role, family, size] of roles) {
        try {
          theme.setFontFamily(role, family)
          theme.setFontSize(role, size)
        } catch {
          // A font name the runtime rejects must not stop the colour layer from
          // applying; the panel surfaces the rejected value instead.
        }
      }
    }
  }

  ctx.effect(() => form.subscribe(refresh))
  ctx.effect(() => () => {
    disposeLayer?.()
  })
  refresh()

  try {
    registerPanel(ctx, () => panelState(form), panelActions(form, readDocument), form)
  } catch (error) {
    reportFailure(ctx, error)
  }
}

/**
 * Register the Theme Studio page into the settings section list.
 *
 * Kept separate from `apply` so the section registration can be exercised in a
 * unit test with a stub slots service, without a browser.
 *
 * @param ctx - client context.
 * @param getState - supplies the current panel state.
 * @param actions - the reactions the panel invokes.
 */
export function registerPanel(
  ctx: Context,
  getState: () => import('./panel.js').PanelState,
  actions: import('./panel.js').PanelActions,
  settingsForm: ConfigForm,
): void {
  const slots = (ctx as unknown as {
    slots: {
      inject: (owner: string, register: () => () => void) => void
      register: (options: { name: string; id: string; order?: number; label?: () => string }, component: unknown) => () => void
    }
  }).slots
  if (ReactImpl === undefined) return
  const React = ReactImpl as Parameters<typeof ThemeStudio>[0] & {
    useEffect: (effect: () => undefined | (() => void), deps: readonly unknown[]) => void
  }

  /**
   * The slot component.
   *
   * It is a real component rather than a direct call, so hooks belong to it and a
   * settings change re-renders it. The subscription is what makes a panel write
   * visible without reopening the page: `getState()` reads the same form the
   * action just wrote, and the subscription fires when the Host echoes it back.
   *
   * @returns the Theme Studio element.
   */
  const Panel = (): unknown => {
    const [, force] = React.useState(0)
    React.useEffect(() => {
      // Re-render when the Host publishes a new section for this namespace.
      let tick = 0
      const dispose = settingsForm.subscribe(() => {
        tick += 1
        force(tick)
      })
      return dispose
    }, [])
    return ThemeStudio(React, { state: getState(), actions, presets: PRESETS })
  }

  ctx.effect(() => {
    slots.inject('settings.section', () =>
      slots.register(
        { name: 'settings.section', id: 'ui-custom', order: 11, label: () => 'Theme Studio' },
        Panel,
      ),
    )
    return () => {}
  })
}

/**
 * Read the stored customization document.
 * @param form - the settings form for this plugin's namespace.
 * @returns the document the panel edits.
 */
function readDocument(form: ConfigForm): CustomizationDocument {
  return asDocument(form.getSnapshot().value)
}

/**
 * The document the panel last rendered, so its actions can merge one field
 * without restating the whole section from a possibly stale snapshot.
 */
let currentDocument: CustomizationDocument | undefined

/**
 * Supply the current document for the panel's reads.
 * @param form - the settings form.
 * @returns the document.
 */
function getDocument(form: ConfigForm): CustomizationDocument {
  currentDocument = readDocument(form)
  return currentDocument
}

/**
 * Build the panel's state from the stored document.
 * @param form - the settings form.
 * @returns the state the panel renders.
 */
function panelState(form: ConfigForm): PanelState {
  const document = getDocument(form)
  const resolved = resolveCustomization(document)
  const overrides = document.tokens
  return {
    basePreset: document.basePreset,
    tokens: TOKEN_SPECS.map((spec) => ({
      name: spec.name,
      label: spec.label,
      description: spec.description,
      override: overrides[spec.name],
    })),
    typography: resolved.typography,
    geometry: document.geometry,
    warnings: resolved.warnings,
    writable: form.getSnapshot().writable,
  }
}

/**
 * Build the panel's write actions.
 *
 * Every action writes a whole field through the settings form, which serializes
 * the mutation against the namespace revision. Tokens are written as one field
 * (`tokens`) rather than per-name, because the schema models them as a dict and
 * a partial write would drop the others.
 *
 * @param form - the settings form.
 * @param document - reads the document the action should start from.
 * @returns the actions the panel invokes.
 */
function panelActions(form: ConfigForm, document: (form: ConfigForm) => CustomizationDocument): PanelActions {
  const write = (field: string, value: unknown): void => {
    void form.set(field, value)
  }
  const withTokens = (mutate: (tokens: CustomizationDocument['tokens']) => CustomizationDocument['tokens']): void => {
    const base = document(form)
    write('tokens', mutate({ ...base.tokens }))
  }
  return {
    setPreset: (id) => write('basePreset', id),
    setToken: (name, light, dark) =>
      withTokens((tokens) => ({ ...tokens, [name]: { light, dark } })),
    clearToken: (name) =>
      withTokens((tokens) => {
        const next = { ...tokens }
        delete next[name]
        return next
      }),
    setFont: (role, value) => {
      const base = document(form)
      const key = role === 'text' ? 'textFontFamily' : role === 'code' ? 'codeFontFamily' : 'terminalFontFamily'
      write('typography', { ...base.typography, [key]: value })
    },
    setFontSize: (role, px) => {
      const base = document(form)
      const key = role === 'text' ? 'fontSize' : role === 'code' ? 'codeFontSize' : 'terminalFontSize'
      write('typography', { ...base.typography, [key]: px })
    },
    setRadius: (px) => {
      const base = document(form)
      write('geometry', { ...base.geometry, radius: px })
    },
    setDensity: (density) => {
      const base = document(form)
      write('geometry', { ...base.geometry, density: density as CustomizationDocument['geometry']['density'] })
    },
    resetAll: () => write('tokens', {}),
  }
}