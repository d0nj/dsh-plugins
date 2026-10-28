/**
 * Renders the panel over a `createElement` shim, pinning behaviour a typecheck
 * cannot see: filtering, keyboard and blur commits, and per-role independence.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { ThemeStudio, resetCombos } from './client/panel.js'
import type { PanelActions, PanelState } from './client/panel.js'

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

  it('applies typed text immediately', async () => {
    resetCombos()
    const { React } = shim()
    const { actions, calls } = recorder()
    const input = combo(React, 'Code font family', panelState(), actions)
    ;(input.props.onInput as (event: { target: { value: string } }) => void)({ target: { value: 'Fira Code' } })
    // A hosted family loads its stylesheet before the write, so the call settles a
    // tick later than the keystroke.
    await new Promise((resolve) => setTimeout(resolve, 0))
    assert.deepEqual(calls, ['font:code:Fira Code'])
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
    const handlers = input.props as { onInput: (event: { target: { value: string } }) => void; onKeyDown: (event: { key: string; preventDefault: () => void }) => void }
    handlers.onInput({ target: { value: 'Custom Mono, monospace' } })
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
    const handlers = input.props as { onInput: (event: { target: { value: string } }) => void; onKeyDown: (event: { key: string; preventDefault: () => void }) => void }
    handlers.onInput({ target: { value: 'Georgia' } })
    handlers.onKeyDown({ key: 'Enter', preventDefault: () => {} })
    assert.deepEqual(calls, ['font:text:Georgia'])
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
