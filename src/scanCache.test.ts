import { describe, expect, it } from 'vitest'
import { createTaskQueue } from './audioTranscript'
import {
  coverageEnd,
  coverageSeconds,
  coveredFraction,
  cuesInRange,
  mergeCues,
  mergeRanges,
  rangesFromCues,
  runPool,
  uncoveredChunks,
} from './scanCache'

describe('mergeRanges', () => {
  it('joins touching scan windows so we do not re-request the seam', () => {
    expect(mergeRanges([
      { start: 0, end: 45 },
      { start: 44.8, end: 90 },
      { start: 200, end: 245 },
    ])).toEqual([
      { start: 0, end: 90 },
      { start: 200, end: 245 },
    ])
  })
})

describe('uncoveredChunks', () => {
  it('skips 45s chunks already in the local scan cache', () => {
    const scanned = [{ start: 0, end: 8 * 60 }]
    const missing = uncoveredChunks(0, 20 * 60, 45, scanned)
    expect(missing[0]?.start).toBe(11 * 45)
    expect(missing.every((chunk) => chunk.start >= 8 * 60 - 45)).toBe(true)
    expect(missing).toHaveLength(Math.ceil((20 * 60 - 11 * 45) / 45))
  })

  it('returns nothing when the requested window is already cached', () => {
    expect(uncoveredChunks(0, 8 * 60, 45, [{ start: 0, end: 8 * 60 }])).toEqual([])
  })

  it('does not skip a chunk that is only barely overlapping the cache', () => {
    const missing = uncoveredChunks(0, 90, 45, [{ start: 0, end: 10 }])
    expect(missing.map((chunk) => [chunk.start, chunk.end])).toEqual([
      [0, 45],
      [45, 90],
    ])
  })
})

describe('mergeCues', () => {
  it('drops a duplicate chunk transcript instead of stacking it twice', () => {
    const existing = [{ start: 0, end: 4, text: 'Welcome back.' }]
    const incoming = [
      { start: 0.2, end: 4.1, text: 'Welcome back.' },
      { start: 45, end: 48, text: 'After the break.' },
    ]
    const merged = mergeCues(existing, incoming)
    expect(merged).toHaveLength(2)
    expect(merged.map((cue) => cue.text)).toEqual(['Welcome back.', 'After the break.'])
  })
})

describe('rangesFromCues', () => {
  it('treats a first-N-minutes transcript as one scanned block', () => {
    const ranges = rangesFromCues([
      { start: 0, end: 4, text: 'Hi' },
      { start: 7 * 60 + 52, end: 8 * 60, text: 'Later' },
    ])
    expect(ranges).toEqual([{ start: 0, end: 8 * 60 }])
  })
})

describe('coverage helpers', () => {
  it('sums scanned seconds and the far edge', () => {
    const ranges = [{ start: 0, end: 120 }, { start: 200, end: 260 }]
    expect(coverageSeconds(ranges)).toBe(180)
    expect(coverageEnd(ranges)).toBe(260)
    expect(coveredFraction({ start: 100, end: 220 }, ranges)).toBeCloseTo(40 / 120)
  })

  it('selects cues that overlap a window with padding', () => {
    const cues = [
      { start: 10, end: 12, text: 'a' },
      { start: 40, end: 50, text: 'b' },
      { start: 80, end: 90, text: 'c' },
    ]
    expect(cuesInRange(cues, 40, 50, 5).map((cue) => cue.text)).toEqual(['b'])
  })
})

describe('runPool', () => {
  it('runs more than one job at a time and keeps result order', async () => {
    const started: number[] = []
    const results = await runPool([10, 20, 30, 40], 2, async (value, index) => {
      started.push(index)
      await new Promise((resolve) => setTimeout(resolve, 15 - index))
      return value * 2
    })
    expect(results).toEqual([20, 40, 60, 80])
    expect(started.slice(0, 2).sort()).toEqual([0, 1])
  })
})

describe('createTaskQueue', () => {
  it('runs queued work one at a time in order', async () => {
    const queue = createTaskQueue()
    const active: number[] = []
    const order: number[] = []
    const job = (id: number) => queue(async () => {
      active.push(id)
      expect(active).toEqual([id])
      await new Promise((resolve) => setTimeout(resolve, 8))
      active.pop()
      order.push(id)
      return id
    })
    expect(await Promise.all([job(1), job(2), job(3)])).toEqual([1, 2, 3])
    expect(order).toEqual([1, 2, 3])
  })
})
