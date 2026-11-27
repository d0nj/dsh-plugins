export class ToolCallLimitExceededError extends Error {
  constructor(limit: number, attempt: number) {
    super(`tool call limit exceeded for this program: ${attempt} attempts, ${limit} allowed`)
    this.name = 'ToolCallLimitExceededError'
  }
}

export class AttemptBudget {
  readonly #limit: number
  #used = 0

  constructor(perMinute: number, timeoutMs: number | null) {
    this.#limit = timeoutMs === null ? Number.POSITIVE_INFINITY : Math.floor((timeoutMs / 60_000) * perMinute)
  }

  next(): number {
    const attempt = ++this.#used
    if (attempt > this.#limit) throw new ToolCallLimitExceededError(this.#limit, attempt)
    return attempt
  }
}

export class Semaphore {
  #available: number
  readonly #waiters: Array<() => void> = []

  constructor(capacity: number) {
    this.#available = Math.max(1, capacity)
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.#acquire()
    try {
      return await task()
    } finally {
      this.#release()
    }
  }

  async #acquire(): Promise<void> {
    if (this.#available > 0) {
      this.#available -= 1
      return
    }
    await new Promise<void>(resolve => this.#waiters.push(resolve))
  }

  #release(): void {
    const waiter = this.#waiters.shift()
    if (waiter === undefined) {
      this.#available += 1
      return
    }
    waiter()
  }
}

export function truncateMiddle(text: string, limit: number): string {
  if (limit <= 0 || text.length <= limit) return text
  const marker = `\n… (${text.length - limit} characters omitted) …\n`
  const room = Math.max(0, limit - marker.length)
  const head = Math.ceil(room * 0.7)
  const tail = room - head
  return `${text.slice(0, head)}${marker}${tail === 0 ? '' : text.slice(text.length - tail)}`
}
