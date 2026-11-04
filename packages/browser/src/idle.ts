/**
 * Close something once it has been idle long enough.
 *
 * A browser costs a process, a window slot, and memory, so it should not outlive
 * the work that needed it. A tool call holds the resource open for its whole
 * duration, and any later call pushes the deadline back again.
 *
 * @module @d0nj/dsh-browser/idle
 */
export class IdleCloser {
  readonly #timeoutMs: number
  readonly #onIdle: () => void
  #handle: ReturnType<typeof setTimeout> | undefined
  #stopped = false

  /**
   * @param timeoutMs - idle budget in milliseconds; zero or less disables closing.
   * @param onIdle - called once per expired idle period.
   */
  constructor(timeoutMs: number, onIdle: () => void) {
    this.#timeoutMs = timeoutMs
    this.#onIdle = onIdle
  }

  /** Restart the deadline; call it for every unit of work. */
  end(): void {
    this.#cancel()
    if (this.#stopped || this.#timeoutMs <= 0) return
    this.#handle = setTimeout(() => {
      this.#handle = undefined
      if (!this.#stopped) this.#onIdle()
    }, this.#timeoutMs)
    this.#handle.unref?.()
  }

  /** Stop permanently, for plugin disposal. */
  stop(): void {
    this.#stopped = true
    this.#cancel()
  }

  #cancel(): void {
    if (this.#handle === undefined) return
    clearTimeout(this.#handle)
    this.#handle = undefined
  }
}
