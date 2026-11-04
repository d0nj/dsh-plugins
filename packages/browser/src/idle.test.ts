import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { IdleCloser } from './idle.js'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('IdleCloser', () => {
  it('fires after the idle budget', async () => {
    let calls = 0
    const closer = new IdleCloser(15, () => {
      calls += 1
    })
    closer.end()
    await sleep(60)
    assert.equal(calls, 1)
    closer.stop()
  })

  it('pushes the deadline back on every end', async () => {
    let calls = 0
    const closer = new IdleCloser(40, () => {
      calls += 1
    })
    closer.end()
    await sleep(25)
    closer.end()
    await sleep(25)
    assert.equal(calls, 0)
    await sleep(40)
    assert.equal(calls, 1)
    closer.stop()
  })

  it('stays quiet after stop', async () => {
    let calls = 0
    const closer = new IdleCloser(10, () => {
      calls += 1
    })
    closer.end()
    closer.stop()
    await sleep(40)
    closer.end()
    await sleep(40)
    assert.equal(calls, 0)
  })

  it('is inert when the budget disables it', async () => {
    let calls = 0
    const closer = new IdleCloser(0, () => {
      calls += 1
    })
    closer.end()
    await sleep(30)
    assert.equal(calls, 0)
    closer.stop()
  })
})
