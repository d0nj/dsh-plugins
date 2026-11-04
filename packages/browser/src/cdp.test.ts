import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { CdpClient, CdpError } from './cdp.js'
import { startCdpServer } from './ws-server.helper.js'

describe('CdpClient', () => {
  it('correlates a command with its result', async () => {
    const { server } = await startCdpServer((message) => ({ id: message.id, result: { echoed: message.method } }))
    try {
      const client = await CdpClient.connect(server.url)
      const result = await client.send<{ echoed: string }>('Page.enable')
      assert.equal(result.echoed, 'Page.enable')
      client.close()
    } finally {
      await server.close()
    }
  })

  it('forwards the session id of the addressed tab', async () => {
    const { server, commands } = await startCdpServer((message) => ({ id: message.id, result: {} }))
    try {
      const client = await CdpClient.connect(server.url)
      await client.send('Page.navigate', { url: 'https://example.com/' }, 'session-7')
      assert.equal(commands.at(-1)?.sessionId, 'session-7')
      assert.deepEqual(commands.at(-1)?.params, { url: 'https://example.com/' })
      client.close()
    } finally {
      await server.close()
    }
  })

  it('surfaces a protocol error with the failing method', async () => {
    const { server } = await startCdpServer((message) => ({ id: message.id, error: { code: -32601, message: "wasn't found" } }))
    try {
      const client = await CdpClient.connect(server.url)
      await assert.rejects(() => client.send('Page.nope'), (error: unknown) => {
        assert.ok(error instanceof CdpError)
        assert.equal(error.method, 'Page.nope')
        assert.match(error.message, /wasn't found/u)
        return true
      })
      client.close()
    } finally {
      await server.close()
    }
  })

  it('times out a command that never answers', async () => {
    const { server } = await startCdpServer(() => undefined)
    try {
      const client = await CdpClient.connect(server.url)
      await assert.rejects(() => client.send('Page.slow', {}, undefined, 100), /timed out after 100ms/u)
      client.close()
    } finally {
      await server.close()
    }
  })

  it('resolves a waited-for event and filters by session', async () => {
    const { server } = await startCdpServer((message) => ({ id: message.id, result: {} }))
    try {
      const client = await CdpClient.connect(server.url)
      const waiter = client.waitFor('Page.loadEventFired', { sessionId: 'tab-a', timeoutMs: 2_000 })
      await client.send('Page.enable', {}, 'tab-a')
      client.dispatch(JSON.stringify({ method: 'Page.loadEventFired', params: { timestamp: 1 }, sessionId: 'tab-b' }))
      client.dispatch(JSON.stringify({ method: 'Page.loadEventFired', params: { timestamp: 2 }, sessionId: 'tab-a' }))
      const event = await waiter
      assert.equal(event.params.timestamp, 2)
      client.close()
    } finally {
      await server.close()
    }
  })

  it('notifies activity listeners for each command and stops on unsubscribe', async () => {
    const { server } = await startCdpServer((message) => ({ id: message.id, result: {} }))
    try {
      const client = await CdpClient.connect(server.url)
      let calls = 0
      const stop = client.onActivity(() => {
        calls += 1
      })
      await client.send('Page.enable')
      await client.send('Page.enable')
      stop()
      await client.send('Page.enable')
      assert.equal(calls, 2)
      client.close()
    } finally {
      await server.close()
    }
  })

  it('fails outstanding commands when the connection closes', async () => {
    const { server } = await startCdpServer(() => undefined)
    try {
      const client = await CdpClient.connect(server.url)
      const pending = client.send('Page.enable', {}, undefined, 5_000)
      client.close()
      await assert.rejects(() => pending, /DevTools connection closed/u)
      assert.equal(client.closed, true)
    } finally {
      await server.close()
    }
  })
})
