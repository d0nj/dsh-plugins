import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { columnHeights, donutArcs, fractions, groupSmall, hitZones } from './chart.js'

describe('fractions', () => {
  it('resolves items into contiguous shares of the whole', () => {
    const segments = fractions([
      { key: 'a', value: 1 },
      { key: 'b', value: 3 },
    ])
    assert.deepEqual(segments, [
      { key: 'a', value: 1, from: 0, to: 0.25 },
      { key: 'b', value: 3, from: 0.25, to: 1 },
    ])
  })

  it('drops zero and non-finite values so they cannot claim a sliver', () => {
    const segments = fractions([
      { key: 'a', value: 0 },
      { key: 'b', value: Number.NaN },
      { key: 'c', value: 2 },
    ])
    assert.deepEqual(segments.map((segment) => segment.key), ['c'])
    assert.equal(segments[0]?.to, 1)
  })

  it('reports no segments when nothing is positive', () => {
    assert.deepEqual(fractions([{ key: 'a', value: 0 }]), [])
    assert.deepEqual(fractions([]), [])
  })

  it('pins the last boundary to one despite float drift', () => {
    const segments = fractions([
      { key: 'a', value: 1 },
      { key: 'b', value: 1 },
      { key: 'c', value: 1 },
    ])
    assert.equal(segments[segments.length - 1]?.to, 1)
  })
})

describe('groupSmall', () => {
  it('leaves a small series untouched', () => {
    const items = [
      { key: 'a', value: 3 },
      { key: 'b', value: 1 },
    ]
    assert.deepEqual(groupSmall(items, 4), items)
  })

  it('keeps the largest slices and folds the tail into one', () => {
    const items = [
      { key: 'a', value: 1 },
      { key: 'b', value: 9 },
      { key: 'c', value: 2 },
      { key: 'd', value: 8 },
    ]
    assert.deepEqual(groupSmall(items, 3), [
      { key: 'b', value: 9 },
      { key: 'd', value: 8 },
      { key: 'other', value: 3 },
    ])
  })

  it('drops non-positive slices entirely', () => {
    assert.deepEqual(groupSmall([{ key: 'a', value: 0 }], 3), [])
  })
})

describe('donutArcs', () => {
  it('turns shares into stroke lengths and offsets', () => {
    const arcs = donutArcs(fractions([{ key: 'half', value: 1 }, { key: 'half', value: 1 }]), 10)
    const circumference = 2 * Math.PI * 10
    assert.equal(arcs.length, 2)
    assert.ok(Math.abs((arcs[0]?.length ?? 0) - circumference / 2) < 1e-9)
    assert.equal(arcs[0]?.offset, 0)
    assert.ok(Math.abs((arcs[1]?.offset ?? 0) - circumference / 2) < 1e-9)
    assert.equal(arcs[0]?.circumference, circumference)
  })

  it('produces no arcs without a positive total', () => {
    assert.deepEqual(donutArcs(fractions([]), 10), [])
  })
})

describe('columnHeights', () => {
  it('scales columns against the largest value', () => {
    assert.deepEqual(columnHeights([2, 4, 1], 40), [20, 40, 10])
  })

  it('returns flat zeroes when every value is empty', () => {
    assert.deepEqual(columnHeights([0, 0], 40), [0, 0])
    assert.deepEqual(columnHeights([], 40), [])
  })

  it('ignores negative and non-finite values', () => {
    assert.deepEqual(columnHeights([-5, 10, Number.NaN], 20), [0, 20, 0])
  })
})

describe('hitZones', () => {
  it('widens a sliver to the minimum and keeps it centred', () => {
    const zones = hitZones(
      fractions([
        { key: 'big', value: 98 },
        { key: 'sliver', value: 2 },
      ]),
      0.2,
    )
    const sliver = zones.find((zone) => zone.key === 'sliver')
    assert.deepEqual(sliver, { key: 'sliver', value: 2, from: 0.8, to: 1 })
  })

  it('leaves a slice wider than the minimum alone', () => {
    const zones = hitZones(
      fractions([
        { key: 'half', value: 1 },
        { key: 'half', value: 1 },
      ]),
      0.1,
    )
    assert.deepEqual(zones.map((zone) => [zone.key, zone.from, zone.to]), [
      ['half', 0, 0.5],
      ['half', 0.5, 1],
    ])
  })

  it('caps the minimum so every zone still fits in the whole', () => {
    const segments = fractions([
      { key: 'a', value: 1 },
      { key: 'b', value: 1 },
      { key: 'c', value: 1 },
      { key: 'd', value: 1 },
    ])
    const zones = hitZones(segments, 0.9)
    assert.equal(zones.length, 4)
    assert.ok(zones.every((zone) => zone.from >= 0 && zone.to <= 1))
    assert.ok(zones.every((zone) => zone.to - zone.from <= 0.25 + 1e-9))
  })

  it('orders the widest zone first so the narrowest target paints last', () => {
    const zones = hitZones(
      fractions([
        { key: 'dominant', value: 90 },
        { key: 'tiny', value: 5 },
        { key: 'also-tiny', value: 5 },
      ]),
      0.2,
    )
    assert.equal(zones[0]?.key, 'dominant')
  })

  it('has nothing to widen without slices', () => {
    assert.deepEqual(hitZones([], 0.2), [])
  })
})