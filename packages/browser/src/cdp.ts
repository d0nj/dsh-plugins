/**
 * Chrome DevTools Protocol client: request/response correlation and events over
 * one flattened WebSocket.
 *
 * @module @d0nj/dsh-browser/cdp
 */
import { openWebSocket } from './ws.js'
import type { WebSocketConnection } from './ws.js'

/** Parameters of one CDP command. */
export type CdpParams = Record<string, unknown>

/** A failure reported by Chrome or by the transport. */
export class CdpError extends Error {
  readonly method: string | undefined
  readonly code: number | undefined

  constructor(message: string, options: { method?: string; code?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'CdpError'
    this.method = options.method
    this.code = options.code
  }
}

/** One event emitted by Chrome. */
export interface CdpEvent {
  readonly method: string
  readonly params: CdpParams
  readonly sessionId: string | undefined
}

type EventListener = (event: CdpEvent) => void

interface PendingRequest {
  readonly method: string
  readonly resolve: (result: CdpParams) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

/** Default per-command budget; page commands that need longer pass their own. */
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000

/**
 * A connection to one browser's DevTools endpoint.
 *
 * Commands carry an optional `sessionId`: omitting it addresses the browser
 * itself (`Target.*`, `Browser.*`), passing it addresses one attached tab.
 */
export class CdpClient {
  readonly #connection: WebSocketConnection
  #nextId = 1
  readonly #pending = new Map<number, PendingRequest>()
  readonly #listeners = new Set<{ readonly method: string; readonly sessionId: string | undefined; readonly listener: EventListener }>()
  readonly #activity = new Set<() => void>()
  #closedReason: string | undefined

  private constructor(connection: WebSocketConnection) {
    this.#connection = connection
  }

  /**
   * Open a connection to a DevTools WebSocket.
   * @param url - the browser-level WebSocket URL.
   * @param options - handshake budget.
   * @returns the connected client.
   */
  static async connect(url: string, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<CdpClient> {
    let client: CdpClient | undefined
    const socket = await openWebSocket(
      url,
      options.timeoutMs ?? 10_000,
      {
        message: (text) => client?.dispatch(text),
        close: (code, reason) => client?.failAll(`DevTools connection closed (${reason === '' ? String(code) : reason})`),
      },
      options.signal,
    )
    client = new CdpClient(socket)
    return client
  }

  get closed(): boolean {
    return this.#closedReason !== undefined
  }

  /**
   * Observe every command this client sends.
   *
   * Commands, not events: page chatter a tab produces on its own must not read as
   * someone still using the browser.
   * @param listener - called before each command is written.
   * @returns the unsubscribe function.
   */
  onActivity(listener: () => void): () => void {
    this.#activity.add(listener)
    return () => {
      this.#activity.delete(listener)
    }
  }

  /**
   * Send one command.
   * @param method - CDP method name.
   * @param params - command parameters.
   * @param sessionId - target session, when the command addresses a tab.
   * @param timeoutMs - per-command budget.
   * @returns the command result.
   */
  async send<T = CdpParams>(method: string, params: CdpParams = {}, sessionId?: string, timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS): Promise<T> {
    if (this.#closedReason !== undefined) throw new CdpError(`${method} failed: ${this.#closedReason}`, { method })
    for (const listener of this.#activity) {
      try {
        listener()
      } catch {
        // Activity listeners must not break dispatch.
      }
    }
    const id = this.#nextId++
    const envelope: CdpParams = { id, method, params }
    if (sessionId !== undefined) envelope.sessionId = sessionId
    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new CdpError(`${method} timed out after ${timeoutMs}ms`, { method }))
      }, timeoutMs)
      this.#pending.set(id, {
        method,
        resolve: (result) => resolve(result as T),
        reject,
        timer,
      })
      try {
        this.#connection.send(JSON.stringify(envelope))
      } catch (error) {
        clearTimeout(timer)
        this.#pending.delete(id)
        reject(error instanceof Error ? error : new CdpError(String(error), { method }))
      }
    })
    return promise
  }

  /**
   * Subscribe to one event.
   * @param method - CDP event name.
   * @param listener - called for every matching event.
   * @param sessionId - restrict to one tab session.
   * @returns the unsubscribe function.
   */
  on(method: string, listener: EventListener, sessionId?: string): () => void {
    const entry = { method, sessionId, listener }
    this.#listeners.add(entry)
    return () => {
      this.#listeners.delete(entry)
    }
  }

  /**
   * Resolve with the next matching event.
   * @param method - CDP event name.
   * @param options - session filter, predicate, and budget.
   * @returns the matching event.
   */
  async waitFor(
    method: string,
    options: { sessionId?: string; timeoutMs?: number; predicate?: (params: CdpParams) => boolean; signal?: AbortSignal } = {},
  ): Promise<CdpEvent> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS
    const signal = options.signal
    return new Promise<CdpEvent>((resolve, reject) => {
      const settle = (): void => {
        clearTimeout(timer)
        unsubscribe()
        signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        settle()
        reject(new CdpError(`${method} wait aborted`, { method }))
      }
      const timer = setTimeout(() => {
        settle()
        reject(new CdpError(`${method} was not emitted within ${timeoutMs}ms`, { method }))
      }, timeoutMs)
      const unsubscribe = this.on(
        method,
        (event) => {
          if (options.predicate !== undefined && !options.predicate(event.params)) return
          settle()
          resolve(event)
        },
        options.sessionId,
      )
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  /** Close the connection and fail outstanding commands. */
  close(): void {
    this.failAll('DevTools connection closed by the client')
    this.#connection.close()
  }

  private failAll(reason: string): void {
    if (this.#closedReason === undefined) this.#closedReason = reason
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer)
      this.#pending.delete(id)
      pending.reject(new CdpError(`${pending.method} failed: ${reason}`, { method: pending.method }))
    }
  }

  dispatch(text: string): void {
    let message: CdpParams
    try {
      message = JSON.parse(text) as CdpParams
    } catch {
      return
    }
    const id = message.id
    if (typeof id === 'number') {
      const pending = this.#pending.get(id)
      if (pending === undefined) return
      this.#pending.delete(id)
      clearTimeout(pending.timer)
      const error = message.error as { code?: number; message?: string } | undefined
      if (error !== undefined) {
        pending.reject(
          new CdpError(`${pending.method}: ${error.message ?? 'unknown error'}`, {
            method: pending.method,
            ...(error.code === undefined ? {} : { code: error.code }),
          }),
        )
        return
      }
      pending.resolve((message.result as CdpParams | undefined) ?? {})
      return
    }
    const method = message.method
    if (typeof method !== 'string') return
    const event: CdpEvent = {
      method,
      params: (message.params as CdpParams | undefined) ?? {},
      sessionId: typeof message.sessionId === 'string' ? message.sessionId : undefined,
    }
    for (const entry of this.#listeners) {
      if (entry.method !== method) continue
      if (entry.sessionId !== undefined && entry.sessionId !== event.sessionId) continue
      try {
        entry.listener(event)
      } catch {
        // A listener must not break event delivery for the others.
      }
    }
  }
}
