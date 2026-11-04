/**
 * Per-tab console and page-error capture.
 *
 * A failing page is the most common reason an agent's next action misbehaves,
 * and the console is where that failure is stated plainly. The buffer is
 * bounded so a chatty page can never grow the plugin's memory.
 *
 * @module @d0nj/dsh-browser/console
 */
/** One captured console line. */
export interface ConsoleEntry {
  readonly level: string
  readonly text: string
  readonly time: number
}

/** A CDP `Runtime.RemoteObject`, reduced to the fields that matter here. */
export interface RemoteObjectLike {
  readonly type?: string
  readonly subtype?: string
  readonly className?: string
  readonly value?: unknown
  readonly unserializableValue?: string
  readonly description?: string
}

const MAX_LINE_CHARS = 600

/**
 * Render a remote object the way a console shows it.
 * @param object - the CDP remote object.
 * @returns one readable line.
 */
export function describeRemoteObject(object: RemoteObjectLike | undefined): string {
  if (object === undefined) return ''
  let text: string
  if (object.unserializableValue !== undefined) {
    text = object.unserializableValue
  } else if (object.value !== undefined) {
    if (typeof object.value === 'string') text = object.value
    else {
      try {
        text = JSON.stringify(object.value) ?? String(object.value)
      } catch {
        text = String(object.value)
      }
    }
  } else if (object.description !== undefined) {
    text = object.description
  } else if (object.className !== undefined) {
    text = `[${object.className}]`
  } else {
    text = object.type === undefined ? '' : `[${object.type}]`
  }
  const collapsed = text.replace(/\s+/gu, ' ').trim()
  return collapsed.length > MAX_LINE_CHARS ? `${collapsed.slice(0, MAX_LINE_CHARS - 1)}…` : collapsed
}

/** Bounded console ring. */
export class ConsoleBuffer {
  readonly #limit: number
  #entries: ConsoleEntry[] = []

  constructor(limit = 200) {
    this.#limit = limit
  }

  /**
   * Append one line, dropping the oldest when full.
   * @param level - `log`, `error`, `warning`, `dialog`, `pageerror`, …
   * @param text - the rendered line.
   * @param time - capture timestamp.
   */
  push(level: string, text: string, time = Date.now()): void {
    const trimmed = text.trim()
    if (trimmed === '') return
    this.#entries.push({ level, text: trimmed, time })
    if (this.#entries.length > this.#limit) this.#entries.splice(0, this.#entries.length - this.#limit)
  }

  /** Every captured line, oldest first. */
  entries(): readonly ConsoleEntry[] {
    return this.#entries
  }

  /** Captured errors and uncaught exceptions. */
  errors(): readonly ConsoleEntry[] {
    return this.#entries.filter((entry) => entry.level === 'error' || entry.level === 'pageerror')
  }

  /** Drop what was captured so far. */
  clear(): void {
    this.#entries = []
  }
}
