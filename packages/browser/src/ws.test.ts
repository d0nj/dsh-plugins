import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { openWebSocket, WebSocketError } from './ws.js'
import { startWebSocketServer } from './ws-server.helper.js'

describe('openWebSocket', () => {
  it('completes the handshake and delivers text frames both ways', async () => {
    const server = await startWebSocketServer((connection) => {
      void connection.nextText().then((text) => connection.send(`echo:${text}`))
    })
    try {
      const received: string[] = []
      const connection = await openWebSocket(server.url, 2_000, {
        message: (text) => received.push(text),
        close: () => undefined,
      })
      connection.send('hello')
      await waitUntil(() => received.length === 1)
      assert.deepEqual(received, ['echo:hello'])
      connection.close()
    } finally {
      await server.close()
    }
  })

  it('reassembles a fragmented message', async () => {
    const server = await startWebSocketServer((connection) => {
      void connection.nextText().then(() => {
        connection.sendRaw(encodeFragment(0x01, 'frag', false))
        connection.sendRaw(encodeFragment(0x00, 'mented', true))
      })
    })
    try {
      const received: string[] = []
      const connection = await openWebSocket(server.url, 2_000, {
        message: (text) => received.push(text),
        close: () => undefined,
      })
      connection.send('go')
      await waitUntil(() => received.length === 1)
      assert.deepEqual(received, ['fragmented'])
      connection.close()
    } finally {
      await server.close()
    }
  })

  it('answers a ping with a pong', async () => {
    let pongSeen = false
    const server = await startWebSocketServer((connection) => {
      void connection.nextText().then(async () => {
        connection.sendRaw(encodeFrameOf(0x09, Buffer.from('ping')))
        await new Promise((resolve) => setTimeout(resolve, 200))
        pongSeen = connection.received.some((frame) => frame.opcode === 0x0a)
        connection.send('done')
      })
    })
    try {
      let finished = false
      const connection = await openWebSocket(server.url, 2_000, {
        message: (text) => {
          finished = text === 'done'
        },
        close: () => undefined,
      })
      connection.send('go')
      await waitUntil(() => finished)
      assert.equal(pongSeen, true)
      connection.close()
    } finally {
      await server.close()
    }
  })

  it('reports the close code a server sends', async () => {
    const server = await startWebSocketServer((connection) => {
      void connection.nextText().then(() => connection.close(1001))
    })
    try {
      let closed: { code: number; reason: string } | undefined
      const connection = await openWebSocket(server.url, 2_000, {
        message: () => undefined,
        close: (code, reason) => {
          closed = { code, reason }
        },
      })
      connection.send('go')
      await waitUntil(() => closed !== undefined)
      assert.equal(closed?.code, 1001)
      assert.equal(connection.closed, true)
    } finally {
      await server.close()
    }
  })

  it('rejects a handshake the server refuses', async () => {
    const server = await startWebSocketServer(() => undefined)
    const url = server.url
    await server.close()
    await assert.rejects(() => openWebSocket(url, 1_000, { message: () => undefined, close: () => undefined }), WebSocketError)
  })

  it('rejects a non-WebSocket URL', async () => {
    await assert.rejects(() => openWebSocket('http://127.0.0.1:1/', 1_000, { message: () => undefined, close: () => undefined }), /not a WebSocket URL/u)
  })
})

function encodeFrameOf(opcode: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(2)
  header[0] = 0x80 | opcode
  header[1] = payload.length
  return Buffer.concat([header, payload])
}

function encodeFragment(opcode: number, text: string, fin: boolean): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const header = Buffer.alloc(2)
  header[0] = (fin ? 0x80 : 0) | opcode
  header[1] = payload.length
  return Buffer.concat([header, payload])
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition was not met in time')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
