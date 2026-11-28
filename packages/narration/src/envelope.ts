const CONTENT_OPEN = /^\s*<content(?:\s[^>]*)?>\s*$/u
const CONTENT_CLOSE = /^\s*<\/content>\s*$/u
const LEADING_CONTENT = /^\s*<content(?:\s[^>]*)?>\s*/u
const TRAILING_CONTENT = /\s*<\/content>\s*$/u
const METADATA = /^\s*<(path|type)>[^<\n]*<\/\1>\s*$/u
const READ_RANGE = /^\(Showing lines (\d+)-(\d+) of (\d+)\. Use offset=\d+ to continue\.\)$/u

export interface EnvelopeText {
  readonly text: string
  readonly range: string | null
}

export function stripEnvelope(source: string): string {
  const lines = source.split('\n')
  const kept: string[] = []
  for (const line of lines) {
    if (CONTENT_OPEN.test(line) || CONTENT_CLOSE.test(line) || METADATA.test(line)) continue
    kept.push(line)
  }
  return kept.join('\n').replace(LEADING_CONTENT, '').replace(TRAILING_CONTENT, '')
}

export function splitReadRange(source: string): EnvelopeText {
  const lines = source.split('\n')
  const last = lines.length - 1
  const tail = last >= 0 ? (lines[last] ?? '').trim() : ''
  const match = READ_RANGE.exec(tail)
  if (match === null) return { text: source, range: null }
  return {
    text: lines.slice(0, last).join('\n').replace(/\n+$/u, ''),
    range: 'lines ' + String(match[1]) + '\u2013' + String(match[2]) + ' of ' + String(match[3]),
  }
}
