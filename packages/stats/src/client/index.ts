import type { Context } from '@deepseek-ai/cordis'

import { createStatsIcon } from './icon.js'
import { createStatsPage } from './page.js'
import type { ReactApi } from './page.js'

/** Panel id shared by the sidebar entry and the main-panel key it opens. */
export const PANEL_ID = 'stats'

/** The slot services this half needs before `apply` runs. */
export const inject = ['slots'] as const

let ReactImpl: ReactApi | undefined

/** Hand the loader-resolved React namespace to this plugin. */
export function useReact(react: ReactApi): void {
  ReactImpl = react
}

/** The slot registration shape used here. */
interface SlotOptions {
  name: string
  id?: string
  key?: string
  order?: number
  label?: string | (() => string)
}

interface SlotsService {
  inject(owner: string, callback: () => () => void): () => void
  register(options: SlotOptions, component: unknown): () => void
}

/**
 * Register the page and its sidebar entry.
 *
 * The sidebar list dispatches its entry id to the keyed `main` slot, so one id
 * ties the icon and the page together. Both live under `slots.inject` so they
 * follow the declarations they depend on instead of leaking after a removal.
 */
export function apply(ctx: Context): () => void {
  if (ReactImpl === undefined) return () => {}
  const slots = (ctx as unknown as { slots: SlotsService }).slots
  const Page = createStatsPage(ReactImpl)
  const Icon = createStatsIcon(ReactImpl)

  const page = slots.inject('main', () => slots.register({ name: 'main', key: PANEL_ID }, Page))
  const entry = slots.inject('sidebar.panellist', () =>
    slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => 'Token usage' }, Icon),
  )

  return () => {
    page()
    entry()
  }
}
