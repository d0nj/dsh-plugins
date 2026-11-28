import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { PacedText, RateMeter, frameBudget } from './pacing.js'

function drain(paced: PacedText, maxFrames = 400): { text: string; frames: number } {
  let text = ''
  let frames = 0
  while (paced.pending > 0 && frames < maxFrames) {
    text += paced.take()
    frames += 1
  }
  return { text, frames }
}

describe('frameBudget', () => {
  it('releases nothing for an empty backlog', () => {
    assert.equal(frameBudget(0), 0)
    assert.equal(frameBudget(-4), 0)
  })

  it('drips one or two characters while the backlog is shallow', () => {
    assert.equal(frameBudget(1), 1)
    assert.equal(frameBudget(2), 2)
    assert.equal(frameBudget(9), 2)
  })

  it('rises monotonically as the backlog grows', () => {
    const depths = [1, 2, 3, 17, 40, 97, 200, 321, 900, 5000]
    const budgets = depths.map((depth) => frameBudget(depth))
    for (let index = 1; index < budgets.length; index += 1) {
      assert.ok(budgets[index]! >= budgets[index - 1]!, 'budget must not fall at ' + String(depths[index]))
    }
  })

  it('drains a deep backlog within a handful of frames', () => {
    const budget = frameBudget(6000)
    assert.ok(6000 / budget <= 8, 'expected eight frames or fewer, got ' + String(6000 / budget))
  })
})

describe('PacedText', () => {
  it('holds pushed text until a frame asks for it', () => {
    const paced = new PacedText()
    paced.push('streaming narration')
    assert.equal(paced.pending, 'streaming narration'.length)
  })

  it('releases every character across frames, in order, without loss', () => {
    const source = 'The agent is reading server.rs to trace how frames are dispatched.'
    const paced = new PacedText()
    paced.push(source)
    const { text } = drain(paced)
    assert.equal(text, source)
    assert.equal(paced.pending, 0)
  })

  it('joins fragments pushed between frames', () => {
    const paced = new PacedText()
    paced.push('alpha ')
    const first = paced.take()
    paced.push('beta ')
    paced.push('gamma')
    assert.equal(first + drain(paced).text, 'alpha beta gamma')
  })

  it('never splits a surrogate pair across frames', () => {
    const paced = new PacedText()
    paced.push('a\u{1F600}b')
    const { text } = drain(paced)
    assert.equal(text, 'a\u{1F600}b')
    assert.ok(!text.includes('\uFFFD'))
  })

  it('reports completion only after the backlog clears', () => {
    const paced = new PacedText()
    paced.push('done')
    paced.close()
    assert.equal(paced.closed, true)
    assert.ok(paced.pending > 0)
    drain(paced)
    assert.equal(paced.pending, 0)
  })

  it('forgets the backlog on reset', () => {
    const paced = new PacedText()
    paced.push('stale')
    paced.reset()
    assert.equal(paced.pending, 0)
    assert.equal(paced.take(), '')
  })
})

describe('RateMeter', () => {
  it('reports nothing from a single sample', () => {
    assert.equal(new RateMeter().sample(1000, 50), 0)
  })

  it('measures characters per second across the window', () => {
    const meter = new RateMeter(1000)
    meter.sample(0, 0)
    meter.sample(500, 250)
    assert.equal(meter.sample(1000, 500), 500)
  })

  it('drops samples older than the window', () => {
    const meter = new RateMeter(800)
    meter.sample(0, 0)
    meter.sample(5000, 5000)
    meter.sample(5600, 5600)
    assert.equal(meter.sample(6500, 6500), 0)
  })
})
