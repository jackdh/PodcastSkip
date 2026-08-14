import { describe, expect, it } from 'vitest'
import {
  coveredFraction,
  coverageEnd,
  createPool,
  mergeCues,
  mergeRanges,
  rangesFromCues,
  runPool,
  uncoveredChunks,
} from './scanCache'

describe('mergeRanges', () => {
  it('joins touching scan windows', () => {
    expect(mergeRanges([
      { start: 0, end: 45 },
      { start: 44.5, end: 90 },
      { start: 200, end: 245 },
    ])).toEqual([
      { start: 0, end: 90 },
      { start: 200, end: 245 },
    ])
  })
})

describe('uncoveredChunks', () => {
  it('skips the first 8 minutes already in IndexedDB', () => {
    const needed = uncoveredChunks(0, 90 * 60, 45, [{ start: 0, end: 8 * 60 }])
    expect(needed[0]?.start).toBeGreaterThanOrEqual(8 * 60 - 45)
    expect(needed.every((chunk) => chunk.start >= 6 * 60)).toBe(true)
    expect(needed.length).toBeLessThan(Math.ceil((90 * 60) / 45))
  })

  it('returns every chunk when nothing is cached', () => {
    expect(uncoveredChunks(0, 90, 45, [])).toEqual([
      { start: 0, end: 45 },
      { start: 45, end: 90 },
    ])
  })

  it('returns nothing when the window is already covered', () => {
    expect(uncoveredChunks(0, 8 * 60, 45, [{ start: 0, end: 8 * 60 }])).toEqual([])
  })
})

describe('coveredFraction', () => {
  it('treats a 60% overlap as mostly done', () => {
    expect(coveredFraction({ start: 0, end: 45 }, [{ start: 0, end: 30 }])).toBeCloseTo(30 / 45)
    expect(coveredFraction({ start: 0, end: 45 }, [{ start: 0, end: 45 }])).toBe(1)
  })
})

describe('mergeCues', () => {
  it('drops overlapping duplicates from a resumed scan', () => {
    const merged = mergeCues(
      [{ start: 0, end: 8, text: 'Welcome back.' }],
      [
        { start: 0.2, end: 7.8, text: 'Welcome back.' },
        { start: 8, end: 16, text: 'Today we have a guest.' },
      ],
    )
    expect(merged).toHaveLength(2)
    expect(merged[1].text).toBe('Today we have a guest.')
  })
})

describe('rangesFromCues / coverageEnd', () => {
  it('spans the spoken transcript, not a single cue', () => {
    const ranges = rangesFromCues([
      { start: 0, end: 4, text: 'Hi' },
      { start: 4, end: 12, text: 'there' },
    ])
    expect(coverageEnd(ranges)).toBe(12)
  })
})

describe('runPool', () => {
  it('runs a bounded number of workers and keeps order', async () => {
    const seen: number[] = []
    const results = await runPool([1, 2, 3, 4], 2, async (item) => {
      seen.push(item)
      await new Promise((resolve) => setTimeout(resolve, 5))
      return item * 10
    })
    expect(results).toEqual([10, 20, 30, 40])
    expect(seen).toHaveLength(4)
  })

  it('stops starting work when aborted', async () => {
    const controller = new AbortController()
    let started = 0
    const run = runPool([1, 2, 3, 4, 5], 1, async (item) => {
      started += 1
      if (item === 2) controller.abort()
      await new Promise((resolve) => setTimeout(resolve, 5))
      return item
    }, undefined, controller.signal)
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
    expect(started).toBeLessThan(5)
  })

  it('keeps the requested number of workers busy', async () => {
    let inFlight = 0
    let maxInFlight = 0
    await runPool(Array.from({ length: 16 }, (_, index) => index), 8, async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 15))
      inFlight -= 1
    })
    expect(maxInFlight).toBe(8)
  })
})

describe('createPool', () => {
  it('never runs more than the limit at once', async () => {
    const enqueue = createPool(2)
    let inFlight = 0
    let maxInFlight = 0
    await Promise.all(Array.from({ length: 6 }, () => enqueue(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 10))
      inFlight -= 1
    })))
    expect(maxInFlight).toBe(2)
    expect(inFlight).toBe(0)
  })
})
