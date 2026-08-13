import { describe, expect, it } from 'vitest'
import { resumePosition } from './playbackState'

describe('resumePosition', () => {
  it('restores a mid-episode place', () => {
    expect(resumePosition(12 * 60, 50 * 60)).toBe(12 * 60)
  })

  it('starts over when the last session finished the episode', () => {
    expect(resumePosition(50 * 60, 50 * 60)).toBe(0)
    expect(resumePosition(50 * 60 - 2, 50 * 60)).toBe(0)
  })

  it('ignores empty or invalid clocks', () => {
    expect(resumePosition(0, 50 * 60)).toBe(0)
    expect(resumePosition(-4, 50 * 60)).toBe(0)
    expect(resumePosition(Number.NaN, 50 * 60)).toBe(0)
  })
})
