export type TermTone = 'default' | 'error' | 'success' | 'warn'

export interface TermSpan {
  readonly text: string
  readonly tone: TermTone
  readonly bold: boolean
  readonly dim: boolean
  readonly underline: boolean
}

interface State {
  readonly tone: TermTone
  readonly bold: boolean
  readonly dim: boolean
  readonly underline: boolean
}

const INITIAL: State = { tone: 'default', bold: false, dim: false, underline: false }

const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/gu
const CSI = /\u001b\[([0-9;?]*)([A-Za-z])/gu

function toneOf(code: number): TermTone | undefined {
  if (code === 31 || code === 91) return 'error'
  if (code === 32 || code === 92) return 'success'
  if (code === 33 || code === 93) return 'warn'
  if (code === 39 || code === 99) return 'default'
  return undefined
}

function applySgr(state: State, parameters: string): State {
  let next = state
  for (const field of parameters.split(';')) {
    const code = field.length === 0 ? 0 : Number.parseInt(field, 10)
    if (!Number.isFinite(code)) continue
    if (code === 0) {
      next = INITIAL
      continue
    }
    if (code === 1) next = { ...next, bold: true }
    else if (code === 2) next = { ...next, dim: true }
    else if (code === 4) next = { ...next, underline: true }
    else if (code === 22) next = { ...next, bold: false, dim: false }
    else if (code === 24) next = { ...next, underline: false }
    else {
      const tone = toneOf(code)
      if (tone !== undefined) next = { ...next, tone }
    }
  }
  return next
}

export function normalizeTerminalText(source: string, tabSize = 4): string {
  const withoutOsc = source.replace(OSC, '')
  const lines = withoutOsc.split('\n')
  const flattened = lines.map((line) => {
    const carriage = line.lastIndexOf('\r')
    return carriage >= 0 ? line.slice(carriage + 1) : line
  })
  return flattened.join('\n').replaceAll('\t', ' '.repeat(tabSize))
}

export function compactOutput(source: string): string {
  return source
    .replace(/[ \t]+$/gmu, '')
    .replace(/\n{3,}/gu, '\n\n')
    .replace(/^\n+/u, '')
    .replace(/\n+$/u, '')
}

export function stripAnsi(source: string): string {
  return normalizeTerminalText(source).replace(CSI, '')
}

export function parseAnsi(source: string, tabSize = 4): TermSpan[] {
  const text = normalizeTerminalText(source, tabSize)
  const spans: TermSpan[] = []
  let state = INITIAL
  let last = 0
  CSI.lastIndex = 0
  let match = CSI.exec(text)
  while (match !== null) {
    const index = match.index
    if (index > last) {
      spans.push({ text: text.slice(last, index), ...state })
    }
    if (match[2] === 'm') state = applySgr(state, match[1] ?? '')
    last = index + match[0].length
    match = CSI.exec(text)
  }
  if (last < text.length) spans.push({ text: text.slice(last), ...state })
  return spans
}
