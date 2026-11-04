/**
 * Minimal RFC 6455 WebSocket client for the DevTools protocol.
 *
 * Chrome speaks CDP over one WebSocket, and the alternative to this file is a
 * runtime dependency or a Node-version gamble on the global `WebSocket`. The
 * `browser` tool runs inside whichever Node the Harness bundles, so the
 * handshake and frame codec are implemented here against `node:http` and
 * `node:stream`, with no protocol surface beyond what CDP uses: text frames,
 * fragmentation, ping/pong, and close.
 *
 * @module @d0nj/dsh-browser/ws
 */
import { createHash, randomBytes } from 'node:crypto'
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import type { Duplex } from 'node:stream'

/** RFC 6455 handshake salt, appended to the client key before hashing. */
const ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** Refuse messages beyond this size instead of growing the heap without bound. */
const MAX_MESSAGE_BYTES = 128 * 1024 * 1024

/** Opcodes this client understands. */
export const OPCODE = {
  continuation: 0x0,
  text: 0x1,
  close: 0x8,
  ping: 0x9,
  pong: 0xa,
} as const

/** One decoded frame. */
export interface WsFrame {
  readonly fin: boolean
  readonly opcode: number
  readonly payload: Buffer
}

/** Thrown when the connection cannot be established or is used after closing. */
export class WebSocketError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'WebSocketError'
  }
}

/**
 * Decode the framing layer from a byte stream.
 *
 * The decoder buffers across chunk boundaries, so callers may feed it whatever
 * the socket delivers.
 */
export class FrameDecoder {
  #buffer: Buffer = Buffer.alloc(0)

  /**
   * Consume one socket chunk.
   * @param chunk - bytes received.
   * @returns every complete frame now available.
   */
  push(chunk: Buffer): WsFrame[] {
    this.#buffer = this.#buffer.length === 0 ? chunk : Buffer.concat([this.#buffer, chunk])
    const frames: WsFrame[] = []
    for (;;) {
      const frame = this.#read()
      if (frame === undefined) return frames
      frames.push(frame)
    }
  }

  #read(): WsFrame | undefined {
    const buffer = this.#buffer
    if (buffer.length < 2) return undefined
    const first = buffer[0] as number
    const second = buffer[1] as number
    const fin = (first & 0x80) !== 0
    const opcode = first & 0x0f
    const masked = (second & 0x80) !== 0
    let length = second & 0x7f
    let offset = 2
    if (length === 126) {
      if (buffer.length < 4) return undefined
      length = buffer.readUInt16BE(2)
      offset = 4
    } else if (length === 127) {
      if (buffer.length < 10) return undefined
      const wide = buffer.readBigUInt64BE(2)
      if (wide > BigInt(MAX_MESSAGE_BYTES)) throw new WebSocketError(`frame of ${wide} bytes exceeds the ${MAX_MESSAGE_BYTES}-byte limit`)
      length = Number(wide)
      offset = 10
    }
    const maskLength = masked ? 4 : 0
    if (buffer.length < offset + maskLength + length) return undefined
    let payload = buffer.subarray(offset + maskLength, offset + maskLength + length)
    if (masked) {
      const mask = buffer.subarray(offset, offset + 4)
      payload = Buffer.from(payload)
      for (let index = 0; index < payload.length; index++) {
        payload[index] = (payload[index] as number) ^ (mask[index % 4] as number)
      }
    }
    this.#buffer = buffer.subarray(offset + maskLength + length)
    return { fin, opcode, payload: Buffer.from(payload) }
  }
}

/**
 * Encode one frame.
 * @param opcode - frame opcode.
 * @param payload - frame payload.
 * @param options - `fin` defaults to true; `mask` defaults to true (client frames).
 * @returns the frame bytes.
 */
export function encodeFrame(opcode: number, payload: Buffer, options: { fin?: boolean; mask?: boolean } = {}): Buffer {
  const fin = options.fin ?? true
  const mask = options.mask ?? true
  const length = payload.length
  const headerLength = length < 126 ? 2 : length < 65_536 ? 4 : 10
  const header = Buffer.alloc(headerLength + (mask ? 4 : 0))
  header[0] = (fin ? 0x80 : 0) | opcode
  const maskBit = mask ? 0x80 : 0
  if (length < 126) {
    header[1] = maskBit | length
  } else if (length < 65_536) {
    header[1] = maskBit | 126
    header.writeUInt16BE(length, 2)
  } else {
    header[1] = maskBit | 127
    header.writeBigUInt64BE(BigInt(length), 2)
  }
  if (!mask) return Buffer.concat([header, payload])
  const key = randomBytes(4)
  key.copy(header, headerLength)
  const masked = Buffer.alloc(length)
  for (let index = 0; index < length; index++) {
    masked[index] = (payload[index] as number) ^ (key[index % 4] as number)
  }
  return Buffer.concat([header, masked])
}

/** A connected WebSocket. */
export interface WebSocketConnection {
  readonly url: string
  readonly closed: boolean
  send(text: string): void
  close(code?: number, reason?: string): void
}

/** Callbacks the connection drives. */
export interface WebSocketListeners {
  readonly message: (text: string) => void
  readonly close: (code: number, reason: string) => void
}

/**
 * Establish a WebSocket connection.
 * @param url - `ws:` or `wss:` URL.
 * @param timeoutMs - handshake budget in milliseconds.
 * @param signal - optional cancellation for the handshake.
 * @param listeners - message and close callbacks.
 * @returns the open connection.
 */
export async function openWebSocket(
  url: string,
  timeoutMs: number,
  listeners: WebSocketListeners,
  signal?: AbortSignal,
): Promise<WebSocketConnection> {
  const target = new URL(url)
  if (target.protocol !== 'ws:' && target.protocol !== 'wss:') {
    throw new WebSocketError(`"${url}" is not a WebSocket URL`)
  }
  const key = randomBytes(16).toString('base64')
  const expectedAccept = createHash('sha1').update(`${key}${ACCEPT_GUID}`).digest('base64')
  const request = target.protocol === 'wss:' ? httpsRequest : httpRequest
  const socket = await new Promise<Duplex>((resolve, reject) => {
    const req = request({
      protocol: target.protocol === 'wss:' ? 'https:' : 'http:',
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    })
    const timer = setTimeout(() => {
      req.destroy()
      reject(new WebSocketError(`WebSocket handshake with ${target.host} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    const onAbort = (): void => {
      req.destroy()
      reject(new WebSocketError('WebSocket handshake aborted'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const settle = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    req.on('upgrade', (response, upgraded, head) => {
      settle()
      if (response.headers['sec-websocket-accept'] !== expectedAccept) {
        upgraded.destroy()
        reject(new WebSocketError(`WebSocket handshake with ${target.host} failed: the server returned an unexpected Sec-WebSocket-Accept`))
        return
      }
      if (head.length > 0) upgraded.unshift(head)
      resolve(upgraded)
    })
    req.on('response', (response) => {
      settle()
      response.resume()
      req.destroy()
      reject(new WebSocketError(`WebSocket handshake with ${target.host} was refused with HTTP ${response.statusCode ?? 0}`))
    })
    req.on('error', (error) => {
      settle()
      reject(error instanceof WebSocketError ? error : new WebSocketError(`WebSocket connection to ${target.host} failed: ${error.message}`, { cause: error }))
    })
    req.end()
  })
  return new Connection(url, socket, listeners)
}

class Connection implements WebSocketConnection {
  readonly url: string
  #socket: Duplex
  #listeners: WebSocketListeners
  #decoder = new FrameDecoder()
  #fragments: Buffer[] = []
  #fragmentOpcode: number | undefined
  #closed = false

  constructor(url: string, socket: Duplex, listeners: WebSocketListeners) {
    this.url = url
    this.#socket = socket
    this.#listeners = listeners
    ;(socket as Duplex & { setNoDelay?: (flag?: boolean) => void }).setNoDelay?.(true)
    socket.on('data', (chunk: Buffer) => this.#receive(chunk))
    socket.on('error', (error: Error) => this.#finish(1006, error.message))
    socket.on('close', () => this.#finish(1006, 'connection closed'))
  }

  get closed(): boolean {
    return this.#closed
  }

  send(text: string): void {
    if (this.#closed) throw new WebSocketError('cannot send on a closed WebSocket')
    this.#socket.write(encodeFrame(OPCODE.text, Buffer.from(text, 'utf8')))
  }

  close(code = 1000, reason = ''): void {
    if (this.#closed) return
    const payload = Buffer.alloc(2 + Buffer.byteLength(reason))
    payload.writeUInt16BE(code, 0)
    payload.write(reason, 2)
    try {
      this.#socket.write(encodeFrame(OPCODE.close, payload))
    } catch {
      // A dead socket needs no close frame.
    }
    this.#finish(code, reason)
  }

  #receive(chunk: Buffer): void {
    let frames: WsFrame[]
    try {
      frames = this.#decoder.push(chunk)
    } catch (error) {
      this.#finish(1002, error instanceof Error ? error.message : 'malformed frame')
      return
    }
    for (const frame of frames) {
      if (frame.opcode === OPCODE.ping) {
        this.#socket.write(encodeFrame(OPCODE.pong, frame.payload))
        continue
      }
      if (frame.opcode === OPCODE.pong) continue
      if (frame.opcode === OPCODE.close) {
        const code = frame.payload.length >= 2 ? frame.payload.readUInt16BE(0) : 1005
        this.close(code, '')
        return
      }
      if (frame.opcode === OPCODE.continuation) {
        if (this.#fragmentOpcode === undefined) {
          this.#finish(1002, 'continuation frame without a start frame')
          return
        }
        this.#fragments.push(frame.payload)
      } else {
        this.#fragmentOpcode = frame.opcode
        this.#fragments = [frame.payload]
      }
      if (!frame.fin) continue
      const payload = Buffer.concat(this.#fragments)
      this.#fragments = []
      this.#fragmentOpcode = undefined
      this.#listeners.message(payload.toString('utf8'))
    }
  }

  #finish(code: number, reason: string): void {
    if (this.#closed) return
    this.#closed = true
    this.#socket.removeAllListeners('data')
    this.#socket.destroy()
    this.#listeners.close(code, reason)
  }
}
