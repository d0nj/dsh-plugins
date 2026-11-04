/**
 * In-process WebSocket server used by the transport and CDP tests.
 *
 * Not part of the published build: `tsconfig.build.json` excludes `*.helper.ts`,
 * while the test build compiles it next to the suites that use it.
 *
 * @module @d0nj/dsh-browser/test/ws-server
 */
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'

import { FrameDecoder, encodeFrame, OPCODE } from './ws.js'
import type { WsFrame } from './ws.js'

const ACCEPT_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** What a test server hands to the handler for each accepted connection. */
export interface ServerConnection {
  /** Send one text message. */
  send(text: string): void
  /** Send raw frame bytes, for fragmentation and ping tests. */
  sendRaw(bytes: Buffer): void
  /** Close the socket. */
  close(code?: number): void
  /** Frames the client sent, as decoded. */
  readonly received: WsFrame[]
  /** Wait for the next text frame from the client. */
  nextText(): Promise<string>
}

/** A running test server. */
export interface TestServer {
  readonly url: string
  readonly port: number
  close(): Promise<void>
}

/**
 * Start a WebSocket server that completes the RFC 6455 handshake and delegates
 * each connection.
 * @param handler - called once per accepted connection.
 * @returns the server handle.
 */
export async function startWebSocketServer(handler: (connection: ServerConnection) => void): Promise<TestServer> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(400)
    response.end()
  })
  const sockets = new Set<Duplex>()
  server.on('upgrade', (request: IncomingMessage, socket: Duplex, _head: Buffer) => {
    const key = request.headers['sec-websocket-key']
    if (typeof key !== 'string') {
      socket.destroy()
      return
    }
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    const accept = createHash('sha1').update(`${key}${ACCEPT_GUID}`).digest('base64')
    socket.write(
      ['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`, '', ''].join('\r\n'),
    )
    const decoder = new FrameDecoder()
    const received: WsFrame[] = []
    const waiters: Array<(text: string) => void> = []
    socket.on('data', (chunk: Buffer) => {
      for (const frame of decoder.push(chunk)) {
        received.push(frame)
        if (frame.opcode === OPCODE.ping) {
          socket.write(encodeFrame(OPCODE.pong, frame.payload, { mask: false }))
          continue
        }
        if (frame.opcode === OPCODE.text) {
          const text = frame.payload.toString('utf8')
          waiters.shift()?.(text)
        }
      }
    })
    socket.on('error', () => undefined)
    handler({
      send: (text) => socket.write(encodeFrame(OPCODE.text, Buffer.from(text, 'utf8'), { mask: false })),
      sendRaw: (bytes) => socket.write(bytes),
      close: (code = 1000) => {
        const payload = Buffer.alloc(2)
        payload.writeUInt16BE(code, 0)
        socket.write(encodeFrame(OPCODE.close, payload, { mask: false }))
        socket.end()
      },
      received,
      nextText: () => new Promise<string>((resolve) => waiters.push(resolve)),
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the test server did not bind a port')
  return {
    url: `ws://127.0.0.1:${address.port}/socket`,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const socket of sockets) socket.destroy()
        sockets.clear()
        server.closeAllConnections()
        server.close((error) => (error === undefined ? resolve() : reject(error)))
      }),
  }
}

/**
 * Start a server that speaks just enough CDP to exercise the client.
 * @param respond - builds the reply for one parsed command, or undefined to stay silent.
 * @returns the server handle and commands the client sent.
 */
export async function startCdpServer(
  respond: (message: { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string }) => unknown,
): Promise<{ server: TestServer; commands: Array<{ id: number; method: string; params: Record<string, unknown>; sessionId?: string }> }> {
  const commands: Array<{ id: number; method: string; params: Record<string, unknown>; sessionId?: string }> = []
  const server = await startWebSocketServer((accepted) => {
    void (async () => {
      for (;;) {
        const text = await accepted.nextText()
        const message = JSON.parse(text) as { id?: number; method?: string; params?: Record<string, unknown>; sessionId?: string }
        if (typeof message.id !== 'number' || typeof message.method !== 'string') continue
        commands.push({
          id: message.id,
          method: message.method,
          params: message.params ?? {},
          ...(message.sessionId === undefined ? {} : { sessionId: message.sessionId }),
        })
        const reply = respond(message)
        if (reply !== undefined) accepted.send(JSON.stringify(reply))
      }
    })()
  })
  return {
    server,
    commands,
  }
}
