import { describe, expect, it } from 'vitest'
import type { AdSegment, TranscriptCue } from './openRouter'
import {
  activeCueIndex,
  analysisWindowEnd,
  buildScrubberSegments,
  cueOverlapsAd,
  formatRemaining,
  formatTime,
  isPlayheadPastTranscript,
  needsFullEpisodeScan,
  nextSleepMinutes,
  segmentPlayedFraction,
  transcriptCoverageEnd,
  wordOverlapsAd,
  wordsFromCue,
} from './playerModel'

/** TRIGGERnometry screenshot: 50:30 into a 90:27 episode, transcript only through ~8 min. */
const TRIGGER_DURATION = 90 * 60 + 27
const TRIGGER_PLAYHEAD = 50 * 60 + 30

const eightMinuteCues: TranscriptCue[] = [
  { start: 0, end: 4, text: 'Welcome back to TRIGGERnometry.' },
  { start: 4, end: 55, text: 'This episode is brought to you by our sponsor.' },
  { start: 7 * 60 + 45, end: 7 * 60 + 46, text: 'And that is the claim.' },
  { start: 7 * 60 + 46, end: 7 * 60 + 52, text: 'Let us look at the evidence.' },
  { start: 7 * 60 + 52, end: 8 * 60, text: 'We will pick this up after the break.' },
]

describe('formatTime', () => {
  it('formats the screenshot clocks', () => {
    expect(formatTime(TRIGGER_PLAYHEAD)).toBe('50:30')
    expect(formatTime(TRIGGER_DURATION)).toBe('90:27')
  })

  it('pads seconds and keeps hours as total minutes like the player bar', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(9)).toBe('0:09')
    expect(formatTime(61)).toBe('1:01')
    expect(formatTime(3600 + 5)).toBe('60:05')
    expect(formatTime(Number.NaN)).toBe('0:00')
  })
})

describe('formatRemaining', () => {
  it('shows remaining as a negative clock like Apple Podcasts', () => {
    expect(formatRemaining(2 * 60 + 24, 39 * 60 + 26)).toBe('-37:02')
    expect(formatRemaining(TRIGGER_PLAYHEAD, TRIGGER_DURATION)).toBe('-39:57')
  })
})

describe('activeCueIndex', () => {
  it('keeps the previous line current across Whisper gaps', () => {
    const cues: TranscriptCue[] = [
      { start: 10, end: 12, text: 'one' },
      { start: 18, end: 20, text: 'two' },
    ]
    expect(activeCueIndex(cues, 11)).toBe(0)
    expect(activeCueIndex(cues, 15)).toBe(0)
    expect(activeCueIndex(cues, 18.5)).toBe(1)
  })

  it('does not treat the 7:45 line as current at 50:30', () => {
    expect(activeCueIndex(eightMinuteCues, TRIGGER_PLAYHEAD)).toBe(eightMinuteCues.length - 1)
    expect(isPlayheadPastTranscript(eightMinuteCues, TRIGGER_PLAYHEAD)).toBe(true)
  })

  it('returns -1 before the first cue', () => {
    expect(activeCueIndex(eightMinuteCues, -1)).toBe(-1)
    expect(activeCueIndex([], 10)).toBe(-1)
  })
})

describe('transcript coverage', () => {
  it('flags an 8-minute scan on a 90-minute episode', () => {
    expect(transcriptCoverageEnd(eightMinuteCues)).toBe(8 * 60)
    expect(analysisWindowEnd(8, TRIGGER_DURATION)).toBe(8 * 60)
    expect(needsFullEpisodeScan(eightMinuteCues, 8, TRIGGER_DURATION)).toBe(true)
    expect(needsFullEpisodeScan(eightMinuteCues, 0, TRIGGER_DURATION)).toBe(true)
    expect(needsFullEpisodeScan(eightMinuteCues, 0, 8 * 60)).toBe(false)
  })

  it('does not nag when there is no transcript yet, or the cues already cover the episode', () => {
    expect(needsFullEpisodeScan([], 0, TRIGGER_DURATION)).toBe(false)
    expect(needsFullEpisodeScan([], 8, TRIGGER_DURATION)).toBe(false)
    expect(needsFullEpisodeScan(eightMinuteCues, 8, 8 * 60)).toBe(false)
  })
})

describe('buildScrubberSegments', () => {
  it('keeps a long episode as one continuous bar, not a 12-block graph', () => {
    const segments = buildScrubberSegments(TRIGGER_DURATION, [])
    expect(segments).toEqual([{ start: 0, end: TRIGGER_DURATION, kind: 'content' }])
  })

  it('splits only on ads, like Apple chapter gaps', () => {
    const segments = buildScrubberSegments(TRIGGER_DURATION, [{ start: 0, end: 45, label: 'preroll' }])
    expect(segments.map((segment) => segment.kind)).toEqual(['ad', 'content'])
    expect(segments).toHaveLength(2)
  })

  it('renders a preroll ad as its own block so the bar can paint it red', () => {
    const ads: AdSegment[] = [{ start: 4, end: 55, label: 'preroll' }]
    const segments = buildScrubberSegments(TRIGGER_DURATION, ads)
    const adBlocks = segments.filter((segment) => segment.kind === 'ad')
    expect(adBlocks).toHaveLength(1)
    expect(adBlocks[0].start).toBe(4)
    expect(adBlocks[0].end).toBe(55)
    expect(segments[0].kind).toBe('content')
    expect(segments.some((segment) => segment.kind === 'content' && segment.end === TRIGGER_DURATION)).toBe(true)
  })

  it('keeps mid-rolls as distinct red blocks instead of burying them in a thin overlay', () => {
    const ads: AdSegment[] = [
      { start: 0, end: 45, label: 'preroll' },
      { start: 19 * 60 + 54, end: 21 * 60 + 24, label: 'Quo' },
      { start: 44 * 60, end: 45 * 60 + 30, label: 'midroll 2' },
    ]
    const segments = buildScrubberSegments(TRIGGER_DURATION, ads)
    const adBlocks = segments.filter((segment) => segment.kind === 'ad')
    expect(adBlocks).toHaveLength(3)
    expect(adBlocks.map((block) => [block.start, block.end, block.label])).toEqual([
      [0, 45, 'preroll'],
      [19 * 60 + 54, 21 * 60 + 24, 'Quo'],
      [44 * 60, 45 * 60 + 30, 'midroll 2'],
    ])
  })

  it('merges overlapping ads before painting', () => {
    const segments = buildScrubberSegments(600, [
      { start: 10, end: 20 },
      { start: 19, end: 30 },
    ])
    const adBlocks = segments.filter((segment) => segment.kind === 'ad')
    expect(adBlocks).toHaveLength(1)
    expect(adBlocks[0].start).toBe(10)
    expect(adBlocks[0].end).toBe(30)
  })

  it('fills played fraction across a segment', () => {
    const segment = { start: 10, end: 20, kind: 'content' as const }
    expect(segmentPlayedFraction(segment, 5)).toBe(0)
    expect(segmentPlayedFraction(segment, 15)).toBe(0.5)
    expect(segmentPlayedFraction(segment, 20)).toBe(1)
  })
})

describe('wordsFromCue', () => {
  it('spreads words across the cue clock', () => {
    const words = wordsFromCue({ start: 10, end: 12, text: 'hello there' })
    expect(words).toHaveLength(2)
    expect(words[0]).toMatchObject({ text: 'hello', start: 10, end: 11 })
    expect(words[1]).toMatchObject({ text: 'there', start: 11, end: 12 })
  })

  it('prefers timed words from Whisper over even interpolation', () => {
    const words = wordsFromCue({
      start: 10,
      end: 14,
      text: 'hello there friend',
      words: [
        { text: 'hello', start: 10, end: 10.4 },
        { text: 'there', start: 10.4, end: 11.1 },
        { text: 'friend', start: 12.8, end: 14 },
      ],
    })
    expect(words[1].end).toBe(11.1)
    expect(words[2].start).toBe(12.8)
  })
})

describe('wordOverlapsAd', () => {
  it('does not treat a whole cue as an ad when only the last words overlap skip', () => {
    const cue = { start: 10, end: 30, text: 'Anyway that is the inflation story this episode is brought to you by Huel' }
    const ads = [{ start: 24, end: 50, label: 'Huel' }]
    expect(cueOverlapsAd(cue, ads)).toBeTruthy()
    const words = wordsFromCue(cue)
    const labeled = words.filter((word) => wordOverlapsAd(word, ads))
    expect(labeled.length).toBeGreaterThan(0)
    expect(labeled.length).toBeLessThan(words.length)
    expect(wordOverlapsAd(words[0], ads)).toBeUndefined()
  })
})

describe('nextSleepMinutes', () => {
  it('cycles 15 → 30 → 45 → 60 → off', () => {
    expect(nextSleepMinutes(null)).toBe(15)
    expect(nextSleepMinutes(15)).toBe(30)
    expect(nextSleepMinutes(30)).toBe(45)
    expect(nextSleepMinutes(45)).toBe(60)
    expect(nextSleepMinutes(60)).toBe(null)
  })
})
