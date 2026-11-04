/**
 * Projection of Chrome's accessibility tree into the numbered outline the model
 * reads.
 *
 * The raw tree is tens of thousands of nodes for a real page and most of it is
 * structure the model cannot act on. This module keeps what a reader can see or
 * operate, assigns a stable `e12`-style reference to every actionable node, and
 * stops at a character budget.
 *
 * @module @d0nj/dsh-browser/snapshot
 */
/** A CDP `Accessibility.AXValue`. */
export interface AxValue {
  readonly value?: unknown
}

/** A CDP `Accessibility.AXProperty`. */
export interface AxProperty {
  readonly name: string
  readonly value?: AxValue
}

/** One node of `Accessibility.getFullAXTree`. */
export interface AxNode {
  readonly nodeId: string
  readonly parentId?: string
  readonly ignored?: boolean
  readonly role?: AxValue
  readonly name?: AxValue
  readonly description?: AxValue
  readonly value?: AxValue
  readonly properties?: readonly AxProperty[]
  readonly childIds?: readonly string[]
  readonly backendDOMNodeId?: number
}

/** Rendering limits. */
export interface SnapshotOptions {
  /** Character budget for the rendered outline. */
  readonly maxChars?: number
  /** Line budget for the rendered outline. */
  readonly maxNodes?: number
  /** Render only the subtree under this backend node. */
  readonly rootBackendNodeId?: number
}

/** Rendered outline plus the reference table it assigns. */
export interface SnapshotResult {
  readonly text: string
  /** `e12` → backend node id, valid until the next snapshot of this tab. */
  readonly refs: ReadonlyMap<string, number>
  readonly lines: number
  readonly truncated: boolean
}

/** Roles a user can operate with a pointer or keyboard. */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  'button',
  'checkbox',
  'combobox',
  'gridcell',
  'link',
  'listbox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
])

/** Roles worth a line even when they carry no accessible name. */
const STRUCTURAL_ROLES: ReadonlySet<string> = new Set([
  'alert',
  'alertdialog',
  'banner',
  'cell',
  'columnheader',
  'complementary',
  'contentinfo',
  'dialog',
  'form',
  'grid',
  'heading',
  'img',
  'image',
  'iframe',
  'list',
  'listitem',
  'main',
  'menu',
  'menubar',
  'navigation',
  'row',
  'rowheader',
  'search',
  'status',
  'table',
  'tablist',
  'tabpanel',
  'toolbar',
  'tree',
  'treegrid',
])

/** Node roles rendered as plain quoted text. */
const TEXT_ROLES: ReadonlySet<string> = new Set(['StaticText'])

/**
 * Roles rendered transparently: their children take their place. The document
 * root only repeats the page title the envelope already carries, and the others
 * are Chrome's canvas-role normalization of plain markup.
 */
const TRANSPARENT_ROLES: ReadonlySet<string> = new Set([
  'Document',
  'InlineTextBox',
  'LineBreak',
  'RootWebArea',
  'WebArea',
  'none',
  'presentation',
])

const DEFAULT_MAX_CHARS = 12_000
const DEFAULT_MAX_NODES = 1_500
const MAX_NAME_CHARS = 160
const MAX_URL_CHARS = 120

/**
 * Collapse whitespace and cap length.
 * @param input - raw accessibility text.
 * @returns one line of display text.
 */
export function normalizeText(input: string): string {
  const collapsed = input.replace(/\s+/gu, ' ').trim()
  return collapsed.length > MAX_NAME_CHARS ? `${collapsed.slice(0, MAX_NAME_CHARS - 1)}…` : collapsed
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

function stringValue(value: AxValue | undefined): string {
  return asString(value?.value)
}

function propertyMap(properties: readonly AxProperty[] | undefined): Map<string, unknown> {
  const map = new Map<string, unknown>()
  for (const property of properties ?? []) map.set(property.name, property.value?.value)
  return map
}

function describeAttributes(role: string, node: AxNode, properties: Map<string, unknown>): string[] {
  const attributes: string[] = []
  const level = properties.get('level')
  if (typeof level === 'number') attributes.push(`level=${level}`)
  for (const flag of ['disabled', 'required', 'readonly', 'focused', 'selected'] as const) {
    if (properties.get(flag) === true) attributes.push(flag)
  }
  const checked = properties.get('checked')
  if (checked === true) attributes.push('checked')
  else if (checked === 'mixed') attributes.push('checked=mixed')
  const pressed = properties.get('pressed')
  if (pressed === true) attributes.push('pressed')
  else if (pressed === 'mixed') attributes.push('pressed=mixed')
  const expanded = properties.get('expanded')
  if (expanded === true) attributes.push('expanded')
  else if (expanded === false) attributes.push('collapsed')
  const invalid = properties.get('invalid')
  if (typeof invalid === 'string' && invalid !== 'false') attributes.push('invalid')
  if (properties.get('modal') === true) attributes.push('modal')

  const url = properties.get('url')
  if (role === 'link' && typeof url === 'string' && url !== '') {
    attributes.push(`url=${url.length > MAX_URL_CHARS ? `${url.slice(0, MAX_URL_CHARS - 1)}…` : url}`)
  }
  const value = stringValue(node.value) || asString(properties.get('valuetext'))
  if (value !== '' && (role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'slider' || role === 'spinbutton' || role === 'progressbar')) {
    attributes.push(`value="${normalizeText(value)}"`)
  }
  return attributes
}

/**
 * Render a full accessibility tree as a numbered outline.
 * @param nodes - every node returned by `Accessibility.getFullAXTree`.
 * @param options - character and line budgets.
 * @returns the outline text and its reference table.
 */
export function renderAccessibilityTree(nodes: readonly AxNode[], options: SnapshotOptions = {}): SnapshotResult {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES
  const byId = new Map<string, AxNode>()
  for (const node of nodes) byId.set(node.nodeId, node)

  const root =
    (options.rootBackendNodeId === undefined
      ? undefined
      : nodes.find((node) => node.backendDOMNodeId === options.rootBackendNodeId))
    ?? nodes.find((node) => node.parentId === undefined)
    ?? nodes[0]

  const refs = new Map<string, number>()
  const lines: string[] = []
  let chars = 0
  let truncated = false

  if (root === undefined) return { text: '(no accessible content)', refs, lines: 0, truncated: false }

  const visited = new Set<string>()
  const stack: Array<{ node: AxNode; depth: number; parentName: string }> = [{ node: root, depth: 0, parentName: '' }]
  let lastText = ''

  const pushChildren = (children: readonly AxNode[], depth: number, parentName: string): void => {
    for (let index = children.length - 1; index >= 0; index--) {
      stack.push({ node: children[index] as AxNode, depth, parentName })
    }
  }

  while (stack.length > 0) {
    if (lines.length >= maxNodes || chars >= maxChars) {
      truncated = true
      break
    }
    const frame = stack.pop() as { node: AxNode; depth: number; parentName: string }
    const node = frame.node
    if (visited.has(node.nodeId)) continue
    visited.add(node.nodeId)

    const role = stringValue(node.role)
    const name = normalizeText(stringValue(node.name))
    const children = (node.childIds ?? []).map((id) => byId.get(id)).filter((child): child is AxNode => child !== undefined)

    if (TEXT_ROLES.has(role)) {
      if (name !== '' && name !== frame.parentName && name !== lastText) {
        lastText = name
        const line = `${'  '.repeat(frame.depth)}- ${JSON.stringify(name)}`
        lines.push(line)
        chars += line.length + 1
      }
      pushChildren(children, frame.depth, name)
      continue
    }

    if (node.ignored === true || TRANSPARENT_ROLES.has(role)) {
      pushChildren(children, frame.depth, frame.parentName)
      continue
    }

    const interactive = INTERACTIVE_ROLES.has(role)
    const emit = name !== '' || interactive || STRUCTURAL_ROLES.has(role)

    if (!emit) {
      pushChildren(children, frame.depth, frame.parentName)
      continue
    }

    const attributes = describeAttributes(role, node, propertyMap(node.properties))
    if (interactive && node.backendDOMNodeId !== undefined) {
      const ref = `e${refs.size + 1}`
      refs.set(ref, node.backendDOMNodeId)
      attributes.unshift(`ref=${ref}`)
    }
    const label = role === '' ? 'group' : role
    const line = `${'  '.repeat(frame.depth)}- ${label}${name === '' ? '' : ` ${JSON.stringify(name)}`}${attributes.map((attribute) => ` [${attribute}]`).join('')}`
    lines.push(line)
    chars += line.length + 1
    pushChildren(children, frame.depth + 1, name)
  }

  if (truncated) lines.push(`… outline truncated at ${lines.length} lines; scope it with selector, or raise maxChars`)

  return {
    text: lines.length === 0 ? '(no accessible content)' : lines.join('\n'),
    refs,
    lines: lines.length,
    truncated,
  }
}
