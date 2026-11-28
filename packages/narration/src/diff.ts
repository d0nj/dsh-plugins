export type DiffKind = 'equal' | 'add' | 'remove' | 'hunk'

export interface DiffLine {
  readonly kind: DiffKind
  readonly text: string
  readonly oldLine: number | null
  readonly newLine: number | null
}

export interface DiffSummary {
  readonly added: number
  readonly removed: number
}

interface Op {
  readonly kind: 'equal' | 'add' | 'remove'
  readonly text: string
}

const MAX_TABLE = 2_000_000
const MAX_LINES = 400

function splitLines(source: string): string[] {
  if (source.length === 0) return []
  return source.split('\n')
}

function commonPrefix(before: readonly string[], after: readonly string[]): number {
  const limit = Math.min(before.length, after.length)
  let index = 0
  while (index < limit && before[index] === after[index]) index += 1
  return index
}

function commonSuffix(before: readonly string[], after: readonly string[], from: number): number {
  const limit = Math.min(before.length, after.length) - from
  let count = 0
  while (
    count < limit &&
    before[before.length - 1 - count] === after[after.length - 1 - count]
  ) {
    count += 1
  }
  return count
}

function fallbackOps(before: readonly string[], after: readonly string[]): Op[] {
  const prefix = commonPrefix(before, after)
  const suffix = commonSuffix(before, after, prefix)
  const ops: Op[] = []
  for (let index = 0; index < prefix; index += 1) ops.push({ kind: 'equal', text: before[index] ?? '' })
  for (let index = prefix; index < before.length - suffix; index += 1) {
    ops.push({ kind: 'remove', text: before[index] ?? '' })
  }
  for (let index = prefix; index < after.length - suffix; index += 1) {
    ops.push({ kind: 'add', text: after[index] ?? '' })
  }
  for (let index = after.length - suffix; index < after.length; index += 1) {
    ops.push({ kind: 'equal', text: after[index] ?? '' })
  }
  return ops
}

export function diffOps(beforeSource: string, afterSource: string): Op[] {
  const before = splitLines(beforeSource)
  const after = splitLines(afterSource)
  const width = after.length + 1
  if ((before.length + 1) * width > MAX_TABLE) return fallbackOps(before, after)
  const table = new Int32Array((before.length + 1) * width)
  for (let row = before.length - 1; row >= 0; row -= 1) {
    for (let column = after.length - 1; column >= 0; column -= 1) {
      table[row * width + column] =
        before[row] === after[column]
          ? (table[(row + 1) * width + column + 1] ?? 0) + 1
          : Math.max(table[(row + 1) * width + column] ?? 0, table[row * width + column + 1] ?? 0)
    }
  }
  const ops: Op[] = []
  let row = 0
  let column = 0
  while (row < before.length && column < after.length) {
    if (before[row] === after[column]) {
      ops.push({ kind: 'equal', text: before[row] ?? '' })
      row += 1
      column += 1
      continue
    }
    const down = table[(row + 1) * width + column] ?? 0
    const right = table[row * width + column + 1] ?? 0
    if (down >= right) {
      ops.push({ kind: 'remove', text: before[row] ?? '' })
      row += 1
    } else {
      ops.push({ kind: 'add', text: after[column] ?? '' })
      column += 1
    }
  }
  while (row < before.length) {
    ops.push({ kind: 'remove', text: before[row] ?? '' })
    row += 1
  }
  while (column < after.length) {
    ops.push({ kind: 'add', text: after[column] ?? '' })
    column += 1
  }
  return ops
}

export function diffSummary(lines: readonly DiffLine[]): DiffSummary {
  let added = 0
  let removed = 0
  for (const line of lines) {
    if (line.kind === 'add') added += 1
    if (line.kind === 'remove') removed += 1
  }
  return { added, removed }
}

export interface DiffRow {
  readonly kind: DiffKind
  readonly text: string
  readonly sign: string
  readonly number: string
  readonly digits: number
}

export function diffRows(lines: readonly DiffLine[]): { rows: DiffRow[]; digits: number } {
  let highest = 0
  for (const line of lines) {
    if (line.oldLine !== null) highest = Math.max(highest, line.oldLine)
    if (line.newLine !== null) highest = Math.max(highest, line.newLine)
  }
  const digits = Math.max(3, String(highest).length)
  let previous = ''
  const rows: DiffRow[] = []
  for (const line of lines) {
    if (line.kind === 'hunk') {
      previous = ''
      rows.push({ kind: 'hunk', text: line.text, sign: '', number: '', digits })
      continue
    }
    const raw = line.kind === 'remove' ? line.oldLine : line.newLine
    const value = raw === null ? '' : String(raw)
    const number = value === previous || value.length === 0 ? '' : value
    if (value.length > 0) previous = value
    rows.push({
      kind: line.kind,
      text: line.text,
      sign: line.kind === 'add' ? '+' : line.kind === 'remove' ? '\u2212' : ' ',
      number,
      digits,
    })
  }
  return { rows, digits }
}

export function diffLines(before: string, after: string, context = 3, maxLines = MAX_LINES): DiffLine[] {
  const ops = diffOps(before, after)
  const keep = new Uint8Array(ops.length)
  for (let index = 0; index < ops.length; index += 1) {
    if (ops[index]?.kind === 'equal') continue
    const from = Math.max(0, index - context)
    const to = Math.min(ops.length - 1, index + context)
    for (let mark = from; mark <= to; mark += 1) keep[mark] = 1
  }
  const lines: DiffLine[] = []
  let oldLine = 1
  let newLine = 1
  let gap = 0
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index]
    if (op === undefined) continue
    if (keep[index] !== 1) {
      gap += 1
      if (op.kind === 'equal') {
        oldLine += 1
        newLine += 1
      }
      continue
    }
    if (gap > 0) {
      lines.push({ kind: 'hunk', text: '\u2026 ' + String(gap) + ' unchanged', oldLine: null, newLine: null })
      gap = 0
    }
    if (op.kind === 'equal') {
      lines.push({ kind: 'equal', text: op.text, oldLine, newLine })
      oldLine += 1
      newLine += 1
    } else if (op.kind === 'remove') {
      lines.push({ kind: 'remove', text: op.text, oldLine, newLine: null })
      oldLine += 1
    } else {
      lines.push({ kind: 'add', text: op.text, oldLine: null, newLine })
      newLine += 1
    }
    if (lines.length > maxLines) {
      lines.push({ kind: 'hunk', text: '\u2026 diff truncated', oldLine: null, newLine: null })
      break
    }
  }
  return lines
}
