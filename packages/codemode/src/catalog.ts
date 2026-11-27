export interface CatalogTool {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output?: unknown
}

export interface CatalogFilters {
  readonly pinned: readonly string[]
  readonly direct: readonly string[]
  readonly exclude: readonly string[]
}

export interface CatalogEntry {
  readonly name: string
  readonly summary: string
  readonly signature: string
  readonly detail: string
  readonly pinned: boolean
  readonly direct: boolean
}

export interface SearchHit {
  readonly name: string
  readonly signature: string
  readonly summary: string
}

const UNTYPED = 'JsonValue'
const MAX_DEPTH = 12

export function buildCatalog(tools: readonly CatalogTool[], filters: CatalogFilters): CatalogEntry[] {
  const entries: CatalogEntry[] = []
  for (const tool of tools) {
    if (tool.name === 'run_code' || filters.exclude.includes(tool.name)) continue
    const signature = renderSignature(tool.name, tool.parameters, tool.output)
    const detail = `${signature}\n${renderSchemaBlock(tool.parameters)}`
    entries.push({
      name: tool.name,
      summary: summarize(tool.description),
      signature,
      detail,
      pinned: filters.pinned.includes(tool.name),
      direct: filters.direct.includes(tool.name),
    })
  }
  return entries.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))
}

export function renderSignature(name: string, parameters: Record<string, unknown>, output: unknown): string {
  const properties = isRecord(parameters.properties) ? parameters.properties : {}
  const required = new Set(Array.isArray(parameters.required) ? parameters.required.filter((key): key is string => typeof key === 'string') : [])
  const parametersText = Object.entries(properties)
    .map(([key, node]) => {
      const optional = required.has(key) ? '' : '?'
      return `${propertyName(key)}${optional}: ${jsonSchemaToTs(node, 1)}`
    })
    .join(', ')
  const outputText = output === undefined ? UNTYPED : jsonSchemaToTs(output, 1)
  return `${propertyName(name)}(${parametersText}) => ${outputText}`
}

export function renderSchemaBlock(parameters: Record<string, unknown>): string {
  const properties = isRecord(parameters.properties) ? parameters.properties : {}
  const required = new Set(Array.isArray(parameters.required) ? parameters.required.filter((key): key is string => typeof key === 'string') : [])
  const lines = Object.entries(properties).map(([key, node]) => {
    const description = isRecord(node) && typeof node.description === 'string' ? ` — ${summarize(node.description)}` : ''
    const optional = required.has(key) ? '' : '?'
    return `    ${propertyName(key)}${optional}: ${jsonSchemaToTs(node, 2)}${description}`
  })
  return lines.length === 0 ? '  (no arguments)' : lines.join('\n')
}

export function searchCatalog(entries: readonly CatalogEntry[], query: string, limit: number): SearchHit[] {
  const bounded = Math.max(1, limit)
  const normalized = query.trim().toLowerCase()
  if (normalized === '') {
    return entries.slice(0, bounded).map(toHit)
  }
  const terms = normalized.split(/\s+/).filter(term => term !== '')
  const scored: Array<{ entry: CatalogEntry; score: number }> = []
  for (const entry of entries) {
    const score = scoreEntry(entry, normalized, terms)
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort((left, right) => (right.score === left.score ? compareNames(left.entry, right.entry) : right.score - left.score))
  return scored.slice(0, bounded).map(match => toHit(match.entry))
}

export function describeCatalogEntry(entries: readonly CatalogEntry[], name: string): string | undefined {
  const entry = entries.find(candidate => candidate.name === name)
  return entry === undefined ? undefined : `${entry.signature}\n${renderSchemaBlockFromDetail(entry.detail)}`
}

export function jsonSchemaToTs(node: unknown, depth = 0): string {
  if (depth > MAX_DEPTH || !isRecord(node)) return UNTYPED
  if (Array.isArray(node.oneOf)) {
    const branches = node.oneOf.map(branch => jsonSchemaToTs(branch, depth + 1))
    return branches.length === 0 ? UNTYPED : [...new Set(branches)].join(' | ')
  }
  if (Array.isArray(node.enum)) {
    const literals = node.enum.map(literal => JSON.stringify(literal))
    return literals.length === 0 ? UNTYPED : literals.join(' | ')
  }
  if (node.const !== undefined) return JSON.stringify(node.const)
  const type = typeof node.type === 'string' ? node.type : undefined
  if (type === 'string') return 'string'
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'null') return 'null'
  if (type === 'json') return UNTYPED
  if (type === 'array' || (type === undefined && node.items !== undefined)) return `${wrapUnion(jsonSchemaToTs(node.items, depth + 1))}[]`
  if (type === 'object' || isRecord(node.properties)) {
    const properties = isRecord(node.properties) ? node.properties : {}
    const required = new Set(Array.isArray(node.required) ? node.required.filter((key): key is string => typeof key === 'string') : [])
    const members = Object.entries(properties).map(([key, value]) => {
      const optional = required.has(key) ? '' : '?'
      return `${propertyName(key)}${optional}: ${jsonSchemaToTs(value, depth + 1)}`
    })
    const open = node.additionalProperties === true ? ['[key: string]: JsonValue'] : []
    const body = [...members, ...open].join('; ')
    return body === '' ? 'Record<string, never>' : `{ ${body} }`
  }
  return UNTYPED
}

function scoreEntry(entry: CatalogEntry, normalized: string, terms: readonly string[]): number {
  const name = entry.name.toLowerCase()
  const summary = entry.summary.toLowerCase()
  let score = 0
  if (name === normalized) score += 1_000
  else if (name.startsWith(normalized)) score += 500
  else if (name.includes(normalized)) score += 300
  for (const term of terms) {
    if (name.split(/[-_.]/).includes(term)) score += 80
    else if (name.includes(term)) score += 60
    if (summary.includes(term)) score += 30
  }
  if (entry.pinned) score += 10
  if (entry.direct) score += 5
  return score
}

function compareNames(left: CatalogEntry, right: CatalogEntry): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

function toHit(entry: CatalogEntry): SearchHit {
  return { name: entry.name, signature: entry.signature, summary: entry.summary }
}

function renderSchemaBlockFromDetail(detail: string): string {
  const index = detail.indexOf('\n')
  return index === -1 ? '' : detail.slice(index + 1)
}

function summarize(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return ''
  const sentence = collapsed.split(/(?<=[.!?])\s/)[0] ?? collapsed
  return sentence.length > 160 ? `${sentence.slice(0, 159)}…` : sentence
}

function propertyName(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name)
}

function wrapUnion(text: string): string {
  return text.includes(' | ') ? `(${text})` : text
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
