export function frameBudget(pending: number): number {
  if (pending <= 0) return 0
  if (pending <= 2) return pending
  if (pending <= 16) return 2
  if (pending <= 96) return 4
  if (pending <= 320) return 8
  return Math.max(16, Math.ceil(pending / 6))
}

function pairSafeLength(text: string): number {
  const last = text.charCodeAt(text.length - 1)
  return last >= 0xd800 && last <= 0xdbff ? text.length - 1 : text.length
}

export class PacedText {
  #parts: string[] = []
  #pending = 0
  #closed = false

  get pending(): number {
    return this.#pending
  }

  get closed(): boolean {
    return this.#closed
  }

  push(text: string): void {
    if (text.length === 0) return
    this.#parts.push(text)
    this.#pending += text.length
  }

  close(): void {
    this.#closed = true
  }

  take(): string {
    const limit = Math.min(frameBudget(this.#pending), this.#pending)
    if (limit <= 0) return ''
    let out = ''
    let need = limit
    while (need > 0) {
      const head = this.#parts[0]
      if (head === undefined) break
      if (head.length <= need) {
        out += head
        this.#parts.shift()
        need -= head.length
        continue
      }
      out += head.slice(0, need)
      this.#parts[0] = head.slice(need)
      need = 0
    }
    const usable = pairSafeLength(out)
    if (usable < out.length) this.#parts.unshift(out.slice(usable))
    this.#pending -= usable
    return out.slice(0, usable)
  }

  reset(): void {
    this.#parts = []
    this.#pending = 0
    this.#closed = false
  }
}

export class RateMeter {
  readonly #window: { at: number; total: number }[] = []
  readonly #spanMs: number

  constructor(spanMs = 1200) {
    this.#spanMs = spanMs
  }

  sample(at: number, total: number): number {
    const window = this.#window
    window.push({ at, total })
    while (window.length > 1 && at - window[0]!.at > this.#spanMs) window.shift()
    const first = window[0]
    if (first === undefined || window.length < 2) return 0
    const elapsed = at - first.at
    if (elapsed <= 0) return 0
    return Math.max(0, ((total - first.total) * 1000) / elapsed)
  }

  reset(): void {
    this.#window.length = 0
  }
}
