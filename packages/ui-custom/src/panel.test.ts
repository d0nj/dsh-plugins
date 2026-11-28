/**
 * Renders the panel over a `createElement` shim, pinning behaviour a typecheck
 * cannot see: filtering, keyboard and blur commits, and per-role independence.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { HOSTED_FONTS } from './client/hosted-fonts.js'
import { ThemeStudio, resetCombos } from './client/panel.js'
import type { PanelActions, PanelState, PresetChoice } from './client/panel.js'

interface Node {
  type: string
  props: Record<string, unknown>
  children: Node[]
}

/**
 * @returns a shim that records the tree, plus a render counter.
 */
function shim(): {
  React: Parameters<typeof ThemeStudio>[0]
  render: (element: unknown) => Node
  renders: () => number
} {
  const createElement = (type: unknown, props?: unknown, ...children: unknown[]): Node => ({
    type: String(type),
    props: (props ?? {}) as Record<string, unknown>,
    children: children.flat().filter((child): child is Node => typeof child === 'object' && child !== null),
  })
  // Mirrors React's bail-out: a write with the same value must not re-render, which
  // is what makes a no-op render detectable.
  let renderCount = 0
  const slots: unknown[] = []
  let slot = 0
  const React = {
    createElement,
    useState: <T,>(initial: T): [T, (next: T) => void] => {
      const index = slot++
      if (!(index in slots)) slots[index] = initial
      return [slots[index] as T, (next: T) => {
        if (Object.is(slots[index], next)) return
        slots[index] = next
        renderCount += 1
      }]
    },
  } as Parameters<typeof ThemeStudio>[0]
  return {
    React,
    render: (element) => {
      slot = 0
      return createElement('root', {}, element)
    },
    renders: () => renderCount,
  }
}

/** @returns every node, depth first. */
function walk(node: Node): Node[] {
  return [node, ...node.children.flatMap(walk)]
}

/** A state with one row per role, matching what the client supplies. */
function panelState(overrides: Partial<PanelState> = {}): PanelState {
  return {
    basePreset: 'none',
    tokens: [],
    typography: {
      textFontFamily: 'Inter',
      codeFontFamily: 'JetBrainsMono NF',
      terminalFontFamily: 'JetBrainsMono NF',
      fontSize: 14,
      codeFontSize: 11,
      terminalFontSize: 13,
    },
    applied: {
      fontFamilies: { text: '"Inter"', code: '"JetBrainsMono NF"', terminal: '"JetBrainsMono NF"' },
      fontSizes: { text: 14, code: 11, terminal: 13 },
    },
    geometry: { radius: 8, density: 'comfortable' },
    warnings: [],
    writable: true,
    ...overrides,
  }
}

/** Actions that record calls instead of writing. */
function recorder(): { actions: PanelActions; calls: string[] } {
  const calls: string[] = []
  const actions: PanelActions = {
    setPreset: (id) => calls.push(`preset:${id}`),
    setToken: (name, light, dark) => calls.push(`token:${name}:${light}:${dark}`),
    clearToken: (name) => calls.push(`clear:${name}`),
    setFont: (role, value) => calls.push(`font:${role}:${value}`),
    setFontSize: (role, px) => calls.push(`size:${role}:${String(px)}`),
    setRadius: (px) => calls.push(`radius:${String(px)}`),
    setDensity: (density) => calls.push(`density:${density}`),
    resetAll: () => calls.push('reset'),
  }
  return { actions, calls }
}

/**
 * @param React - shim.
 * @param label - aria-label of the input.
 * @param stateValue - panel state.
 * @param actions - recorded actions.
 * @returns the combobox input.
 */
function combo(React: Parameters<typeof ThemeStudio>[0], label: string, stateValue: PanelState, actions: PanelActions): Node {
  const { render } = shim()
  const tree = render(ThemeStudio(React, { state: stateValue, actions, presets: [] }))
  const found = walk(tree).find((node) => node.props['aria-label'] === label)
  assert.ok(found, `expected a combobox named ${label}`)
  return found
}

describe('ThemeStudio font combobox', () => {
  it('starts closed on a fresh mount', () => {
    resetCombos()
    const { React, render } = shim()
    const { actions } = recorder()
    const tree = render(ThemeStudio(React, { state: panelState(), actions, presets: [] }))
    assert.equal(walk(tree).filter((node) => node.props.role === 'option').length, 0)
  })

  it('asks for a re-render when the list opens', () => {
    resetCombos()
    const { React, renders } = shim()
    const { actions } = recorder()
    const before = renders()
    const input = combo(React, 'Code font family', panelState(), actions)
    ;(input.props.onFocus as (event: { target: { value: string; select: () => void } }) => void)({ target: { value: 'x', select: () => {} } })
    assert.equal(renders() > before, true, 'opening the list must trigger a render')
  })

  it('keeps the current stack visible on focus instead of blanking it', () => {
    resetCombos()
    const { React } = shim()
    const { actions } = recorder()
    const input = combo(React, 'Code font family', panelState(), actions)
    ;(input.props.onFocus as (event: { target: { value: string; select: () => void } }) => void)({ target: { value: 'x', select: () => {} } })
    assert.equal(input.props.value, 'JetBrainsMono NF')
  })

  it('holds typed text until Enter commits it', () => {
    resetCombos()
    const { React } = shim()
    const { actions, calls } = recorder()
    const input = combo(React, 'Code font family', panelState(), actions)
    const handlers = input.props as {
      onChange: (event: { target: { value: string } }) => void
      onKeyDown: (event: { key: string; preventDefault: () => void }) => void
    }
    handlers.onChange({ target: { value: 'Fira Code' } })
    assert.deepEqual(calls, [], 'a keystroke must not reach the settings store')
    handlers.onKeyDown({ key: 'Enter', preventDefault: () => {} })
    assert.deepEqual(calls, ['font:code:Fira Code'])
  })

  it('commits typed text when the field loses focus', () => {
    resetCombos()
    const { React } = shim()
    const { actions, calls } = recorder()
    const input = combo(React, 'Code font family', panelState(), actions)
    const handlers = input.props as {
      onChange: (event: { target: { value: string } }) => void
      onBlur: () => void
    }
    handlers.onChange({ target: { value: 'Georgia' } })
    handlers.onBlur()
    assert.deepEqual(calls, ['font:code:Georgia'])
  })

  it('renders one combobox per role, replacing the plain select', () => {
    const { React, render } = shim()
    const { actions } = recorder()
    const tree = render(ThemeStudio(React, { state: panelState(), actions, presets: [] }))
    const nodes = walk(tree)
    const inputs = nodes.filter((node) => node.props.role === 'combobox')
    assert.equal(inputs.length, 3)
    assert.equal(nodes.filter((node) => node.type === 'select').length, 0)
  })

  it('shows the current stack while closed', () => {
    const { React } = shim()
    const { actions } = recorder()
    assert.equal(combo(React, 'Code font family', panelState(), actions).props.value, 'JetBrainsMono NF')
  })

  it('accepts a typed stack that is not an installed family', () => {
    const { React } = shim()
    const { actions, calls } = recorder()
    const input = combo(React, 'Code font family', panelState(), actions)
    const handlers = input.props as { onChange: (event: { target: { value: string } }) => void; onKeyDown: (event: { key: string; preventDefault: () => void }) => void }
    handlers.onChange({ target: { value: 'Custom Mono, monospace' } })
    handlers.onKeyDown({ key: 'Enter', preventDefault: () => {} })
    assert.deepEqual(calls, ['font:code:Custom Mono, monospace'])
  })

  it('treats arrow keys and Escape without committing', () => {
    const { React } = shim()
    const { actions, calls } = recorder()
    const input = combo(React, 'Code font family', panelState(), actions)
    const handlers = input.props as { onKeyDown: (event: { key: string; preventDefault: () => void }) => void }
    for (const key of ['ArrowDown', 'ArrowUp', 'Escape']) {
      handlers.onKeyDown({ key, preventDefault: () => {} })
    }
    assert.deepEqual(calls, [])
  })

  it('does not write when the list is closed and nothing was typed', () => {
    const { React } = shim()
    const { actions, calls } = recorder()
    const input = combo(React, 'Interface text font family', panelState(), actions)
    const handlers = input.props as { onBlur: () => void }
    handlers.onBlur()
    assert.deepEqual(calls, [])
  })

  it('keeps role rows independent', () => {
    const { React } = shim()
    const { actions, calls } = recorder()
    const input = combo(React, 'Interface text font family', panelState(), actions)
    const handlers = input.props as { onChange: (event: { target: { value: string } }) => void; onKeyDown: (event: { key: string; preventDefault: () => void }) => void }
    handlers.onChange({ target: { value: 'Georgia' } })
    handlers.onKeyDown({ key: 'Enter', preventDefault: () => {} })
    assert.deepEqual(calls, ['font:text:Georgia'])
  })

  it('offers every hosted family when the list opens', () => {
    resetCombos()
    const { React, render } = shim()
    const { actions } = recorder()
    const state = panelState()
    const input = combo(React, 'Code font family', state, actions)
    ;(input.props.onFocus as (event: { target: { value: string } }) => void)({ target: { value: '' } })
    const options = walk(render(ThemeStudio(React, { state, actions, presets: [] })))
      .filter((node) => node.props.role === 'option')
    assert.equal(options.length, HOSTED_FONTS.length + 1, 'the Default row plus the whole catalog')
    const keys = new Set(options.map((node) => node.props.key))
    for (const font of HOSTED_FONTS) assert.ok(keys.has(font.family), `${font.family} is not offered`)
  })

  it('offers Default first and clears the stack when it is picked', () => {
    resetCombos()
    const { React, render } = shim()
    const calls: string[] = []
    const actions: PanelActions = {
      ...recorder().actions,
      setFont: (role, value) => calls.push(`${role}:${value}`),
    }
    const input = combo(React, 'Code font family', panelState(), actions)
    // Opening the list is what renders it.
    ;(input.props.onFocus as (event: { target: { value: string } }) => void)({ target: { value: 'JetBrainsMono NF' } })
    const options = walk(render(ThemeStudio(React, { state: panelState(), actions, presets: [] })))
      .filter((node) => node.props.role === 'option')
    assert.equal(options.length > 0, true, 'expected options while open')
    const first = options[0]
    // The shim drops text children, so the sentinel key is what proves this is the
    // Default row rather than an installed family.
    assert.equal(first?.props.key, '\u0000default')
    const choose = first?.props.onMouseDown
    assert.equal(typeof choose, 'function')
    ;(choose as (event: { preventDefault: () => void }) => void)({ preventDefault: () => {} })
    assert.deepEqual(calls, ['code:'])
  })
})

describe('ThemeStudio font sizes', () => {
  function sizeInput(React: Parameters<typeof ThemeStudio>[0], render: (element: unknown) => Node, state: PanelState, actions: PanelActions): Node {
    const found = walk(render(ThemeStudio(React, { state, actions, presets: [] })))
      .find((node) => node.props['aria-label'] === 'Interface text size')
    assert.ok(found, 'expected the interface text size field')
    return found
  }

  it('waits for blur before writing a typed size', () => {
    const { React, render } = shim()
    const { actions, calls } = recorder()
    const state = panelState()
    ;(sizeInput(React, render, state, actions).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '1' } })
    assert.deepEqual(calls, [], 'a partial number must not reach the settings store')
    ;(sizeInput(React, render, state, actions).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '18' } })
    ;(sizeInput(React, render, state, actions).props.onBlur as () => void)()
    assert.deepEqual(calls, ['size:text:18'])
  })

  it('clamps a size typed outside the role range', () => {
    const { React, render } = shim()
    const { actions, calls } = recorder()
    const state = panelState()
    ;(sizeInput(React, render, state, actions).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '99' } })
    ;(sizeInput(React, render, state, actions).props.onKeyDown as (event: { key: string }) => void)({ key: 'Enter' })
    assert.deepEqual(calls, ['size:text:22'])
  })
})

const CHOICES: readonly PresetChoice[] = [
  {
    id: 'alpha',
    label: 'Alpha',
    description: 'A dark preset',
    colorScheme: 'dark',
    tokens: {
      '--dsw-alias-bg-base': { light: '#ffffff', dark: '#101010' },
      '--dsw-alias-label-primary': { light: '#111111', dark: '#eeeeee' },
      '--dsw-alias-brand-primary': { light: '#3366ff', dark: '#77aaff' },
    },
  },
  {
    id: 'beta',
    label: 'Beta',
    description: 'A light preset',
    colorScheme: 'light',
    tokens: {
      '--dsw-alias-bg-base': { light: '#fafafa', dark: '#202020' },
      '--dsw-alias-label-primary': { light: '#222222', dark: '#dddddd' },
      '--dsw-alias-brand-primary': { light: '#9933ff', dark: '#bb99ff' },
    },
  },
]

function rendered(React: Parameters<typeof ThemeStudio>[0], render: (element: unknown) => Node, state: PanelState, actions: PanelActions): Node {
  return render(ThemeStudio(React, { state, actions, presets: CHOICES }))
}

function tiles(tree: Node): Node[] {
  return walk(tree).filter((node) => node.type === 'button' && typeof node.props.title === 'string')
}

function segmentOf(tree: Node, id: string): Node {
  const found = walk(tree).find((node) => node.type === 'button' && node.props.key === id && node.props.title === undefined)
  assert.ok(found, `expected the ${id} filter segment`)
  return found
}

function searchOf(tree: Node): Node {
  const found = walk(tree).find((node) => node.props['aria-label'] === 'Search presets')
  assert.ok(found, 'expected the preset search field')
  return found
}

describe('ThemeStudio preset selector', () => {
  it('lists every preset behind the built-in tile', () => {
    const { React, render } = shim()
    const { actions } = recorder()
    const tree = rendered(React, render, panelState(), actions)
    assert.equal(tiles(tree).length, CHOICES.length + 1)
    assert.equal(tiles(tree)[0]?.props.key, 'none')
  })

  it('narrows the gallery to one colour scheme', () => {
    const { React, render } = shim()
    const { actions } = recorder()
    const first = rendered(React, render, panelState(), actions)
    ;(segmentOf(first, 'dark').props.onClick as () => void)()
    const dark = rendered(React, render, panelState(), actions)
    assert.deepEqual(tiles(dark).map((tile) => tile.props.key), ['none', 'alpha'])
    ;(segmentOf(dark, 'light').props.onClick as () => void)()
    const light = rendered(React, render, panelState(), actions)
    assert.deepEqual(tiles(light).map((tile) => tile.props.key), ['none', 'beta'])
  })

  it('finds a preset by name', () => {
    const { React, render } = shim()
    const { actions } = recorder()
    const first = rendered(React, render, panelState(), actions)
    const search = searchOf(first)
    ;(search.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'beta' } })
    const found = rendered(React, render, panelState(), actions)
    assert.deepEqual(tiles(found).map((tile) => tile.props.key), ['beta'])
  })

  it('reports an empty gallery instead of a blank grid', () => {
    const { React, render } = shim()
    const { actions } = recorder()
    const first = rendered(React, render, panelState(), actions)
    assert.equal(walk(first).filter((node) => node.type === 'p').length, 0)
    ;(searchOf(first).props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'nothing like this' } })
    const empty = rendered(React, render, panelState(), actions)
    assert.equal(tiles(empty).length, 0)
    assert.equal(walk(empty).filter((node) => node.type === 'p').length, 1)
  })

  it('previews each preset in the scheme it opens with', () => {
    const { React, render } = shim()
    const { actions } = recorder()
    const tree = rendered(React, render, panelState(), actions)
    const alpha = tiles(tree).find((tile) => tile.props.key === 'alpha')
    const beta = tiles(tree).find((tile) => tile.props.key === 'beta')
    const background = (tile: Node | undefined): unknown =>
      (tile?.children[0]?.props.style as { background?: unknown } | undefined)?.background
    assert.equal(background(alpha), '#101010')
    assert.equal(background(beta), '#fafafa')
  })

  it('marks the stored preset as pressed', () => {
    const { React, render } = shim()
    const { actions } = recorder()
    const tree = rendered(React, render, panelState({ basePreset: 'beta' }), actions)
    assert.equal(tiles(tree).find((tile) => tile.props.key === 'beta')?.props['aria-pressed'], true)
    assert.equal(tiles(tree).find((tile) => tile.props.key === 'alpha')?.props['aria-pressed'], false)
  })

  it('selects the built-in palette through the first tile', () => {
    const { React, render } = shim()
    const { actions, calls } = recorder()
    const tree = rendered(React, render, panelState({ basePreset: 'alpha' }), actions)
    ;(tiles(tree)[0]?.props.onClick as () => void)()
    assert.deepEqual(calls, ['preset:none'])
  })
})
