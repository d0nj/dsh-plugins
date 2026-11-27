import type { CatalogEntry } from './catalog.js'
import type { CatalogMode } from './config.js'

export const ONLY_INSTRUCTION =
  '`run_code` is the program transport: a tool call naming any other tool fails, except the tools listed as directly callable below. Reach every other tool from inside the program.'

export const CALL_RULES = `## Writing code for run_code

Execute one TypeScript program per call against the tools below. Takes \`code\` (the program body) and \`description\` (a short summary for the user).

Inside the program:

- Call tools as \`await tools.name(args)\` — quoted access for exotic names: \`tools["my-tool"](args)\`. Tool arguments must be lossless JSON, and each call resolves to the tool's canonical JSON value.
- Discover a tool you cannot see here with \`await catalog.search({ query })\`; it returns exact signatures. \`await catalog.describe({ name })\` expands one tool's arguments.
- A FAILED tool call rejects with \`ToolCallError\`, whose \`toolName\` identifies the failed tool; \`try/catch\` it to continue.
- Independent read-only calls may overlap under \`Promise.all\`; mutating calls run alone, in submission order. Await dependent work.
- \`return\` the value you need; with no explicit return the program yields nothing. Intermediate results stay out of the conversation.`

export function renderCatalog(entries: readonly CatalogEntry[], mode: CatalogMode, maxInlineBytes: number): string {
  if (entries.length === 0) return 'No tools are bound to this program.'
  if (mode === 'full') return renderFull(entries)
  const inline = mode === 'hybrid' ? entries.filter(entry => entry.pinned || entry.direct) : []
  const listed = entries.filter(entry => !inline.includes(entry))
  const blocks: string[] = []
  let used = 0
  for (const entry of inline) {
    if (used + entry.detail.length > maxInlineBytes) break
    used += entry.detail.length
    blocks.push(entry.detail)
  }
  const index = listed.map(entry => `- ${entry.signature} — ${entry.summary}`).join('\n')
  return [...blocks, index === '' ? '' : `### Catalog\n\n${index}`].filter(block => block !== '').join('\n\n')
}

export function renderSections(entries: readonly CatalogEntry[], mode: CatalogMode, maxInlineBytes: number): string {
  return `${CALL_RULES}\n\n${renderCatalog(entries, mode, maxInlineBytes)}`
}

function renderFull(entries: readonly CatalogEntry[]): string {
  return entries.map(entry => entry.detail).join('\n\n')
}
