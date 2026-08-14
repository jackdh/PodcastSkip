import { describe, expect, it } from 'vitest'
import { refineAdSegments, trimAdSegmentToWords, playbackAdSegments } from './adRefine'
import type { TranscriptCue } from './openRouter'

describe('trimAdSegmentToWords', () => {
  it('ends skip at the last ad sentence, not the rest of a mixed cue', () => {
    const cues: TranscriptCue[] = [
      { start: 16, end: 45, text: 'This episode is brought to you by Huel, the complete meal in a bottle.' },
      {
        start: 45,
        end: 90,
        text: 'Visit huel.com today and try it for free. Welcome back. Let us get into the conversation.',
      },
    ]
    const trimmed = trimAdSegmentToWords({ start: 16, end: 90, label: 'Huel' }, cues)
    expect(trimmed.start).toBe(16)
    expect(trimmed.end).toBeLessThan(70)
    expect(trimmed.end).toBeGreaterThan(50)
  })

  it('starts skip at the first ad sentence, not the host lead-in in the same cue', () => {
    const cues: TranscriptCue[] = [
      {
        start: 10,
        end: 40,
        text: 'Anyway that is the inflation story. This episode is brought to you by Huel.',
      },
      { start: 40, end: 70, text: 'Go to huel.com and use code MONEY for a free t-shirt. Terms apply.' },
    ]
    const trimmed = trimAdSegmentToWords({ start: 10, end: 70, label: 'Huel' }, cues)
    expect(trimmed.start).toBeGreaterThan(18)
    expect(trimmed.start).toBeLessThan(28)
    expect(trimmed.end).toBe(70)
  })

  it('leaves a clean commercial cue alone', () => {
    const cues: TranscriptCue[] = [
      { start: 19 * 60 + 5, end: 19 * 60 + 20, text: 'This episode is brought to you by our sponsor, Helio Climate.' },
      { start: 19 * 60 + 20, end: 19 * 60 + 50, text: 'Visit helioclimate.com and use code TINKER for a free trial. Terms apply.' },
    ]
    const trimmed = trimAdSegmentToWords({ start: 19 * 60 + 5, end: 19 * 60 + 50, label: 'Helio' }, cues)
    expect(trimmed.start).toBe(19 * 60 + 5)
    expect(trimmed.end).toBe(19 * 60 + 50)
  })
})

describe('refineAdSegments mixed return', () => {
  it('does not skip the welcome-back copy glued to the last ad sentence', () => {
    const cues: TranscriptCue[] = [
      { start: 18 * 60 + 40, end: 18 * 60 + 55, text: 'So the data actually shows a more complicated picture than the headlines.' },
      { start: 19 * 60 + 5, end: 19 * 60 + 20, text: 'This episode is brought to you by our sponsor, Helio Climate.' },
      { start: 19 * 60 + 20, end: 19 * 60 + 50, text: 'Visit helioclimate.com and use code TINKER for a free trial. Terms apply.' },
      {
        start: 19 * 60 + 50,
        end: 20 * 60 + 45,
        text: 'Support for this show comes from Helio. Visit helioclimate.com today. Welcome back. Let us pick up with Scott on the ice core record.',
      },
    ]
    const refined = refineAdSegments([{ start: 20 * 60, end: 21 * 60 + 30, label: 'mid roll' }], cues)
    expect(refined[0].start).toBe(19 * 60 + 5)
    expect(refined[0].end).toBeLessThan(20 * 60 + 20)
    expect(refined[0].end).toBeGreaterThan(20 * 60)
  })
})

describe('playbackAdSegments', () => {
  it('trims stored skip ranges so an old scan lands on the return line', () => {
    const cues: TranscriptCue[] = [
      { start: 16, end: 45, text: 'This episode is brought to you by Huel, the complete meal in a bottle.' },
      {
        start: 45,
        end: 90,
        text: 'Visit huel.com today and try it for free. Welcome back. Let us get into the conversation.',
      },
    ]
    const ads = playbackAdSegments([{ start: 16, end: 90, label: 'Huel' }], cues)
    expect(ads[0].end).toBeLessThan(70)
  })
})
