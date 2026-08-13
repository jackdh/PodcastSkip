import { describe, expect, it } from 'vitest'
import { adSkipTarget, normalizeSegments } from './adParse'
import type { TranscriptCue } from './openRouter'

function cuesFrom(rows: Array<[number, number, string]>): TranscriptCue[] {
  return rows.map(([start, end, text]) => ({ start, end, text }))
}

/** First 8 minutes of a typical episode: intro, preroll ad, then conversation. */
const prerollCues = cuesFrom([
  [0, 8, 'Welcome back to TRIGGERnometry.'],
  [8, 16, 'I am your host and today we have a special guest.'],
  [16, 28, 'Before we start I want to tell you about our sponsor.'],
  [28, 45, 'This episode is brought to you by Huel, the complete meal in a bottle.'],
  [45, 70, 'Go to huel.com and use code TRIGGER for a free t-shirt. Terms apply.'],
  [70, 88, 'Visit huel.com today and try it for free.'],
  [88, 100, 'Welcome back. Let us get into the conversation.'],
  [100, 130, 'Professor, tell us how Western civilisation actually rose.'],
  [130, 160, 'It begins with a set of institutions that are easy to take for granted.'],
  [160, 190, 'And that is the claim we are going to test in this interview.'],
])

describe('normalizeSegments', () => {
  it('maps startCue/endCue onto the sponsor read, not the intro', () => {
    const segments = normalizeSegments({
      segments: [{ startCue: 3, endCue: 6, label: 'Huel' }],
    }, 8 * 60, prerollCues)
    expect(segments).toHaveLength(1)
    expect(segments[0].start).toBe(16)
    expect(segments[0].end).toBe(88)
  })

  it('treats DeepSeek start/end integers as cue ids, not seconds', () => {
    // Model copies the example shape but names the fields start/end.
    // Cue 3–6 is 16s–88s. As seconds, 3–6 would be a 3s blip skip never hits.
    const segments = normalizeSegments({
      segments: [{ start: 3, end: 6, label: 'sponsor reads' }],
    }, 8 * 60, prerollCues)
    expect(segments).toHaveLength(1)
    expect(segments[0].start).toBe(16)
    expect(segments[0].end).toBe(88)
    expect(segments[0].end - segments[0].start).toBeGreaterThan(30)
  })

  it('keeps real second clocks when they overlap the ad', () => {
    const segments = normalizeSegments({
      segments: [{ start: 16, end: 88, label: 'Huel' }],
    }, 8 * 60, prerollCues)
    expect(segments[0].start).toBe(16)
    expect(segments[0].end).toBe(88)
  })

  it('parses MM:SS clocks from the numbered transcript', () => {
    const segments = normalizeSegments({
      segments: [{ start: '0:16', end: '1:28', label: 'Huel' }],
    }, 8 * 60, prerollCues)
    expect(segments[0].start).toBe(16)
    expect(segments[0].end).toBe(88)
  })

  it('parses start_time/end_time aliases', () => {
    const segments = normalizeSegments({
      ads: [{ start_time: 28, end_time: 88, sponsor: 'Huel' }],
    }, 8 * 60, prerollCues)
    expect(segments[0].start).toBe(28)
    expect(segments[0].end).toBe(88)
  })

  it('prefers minute clocks over tiny cue-id spans on an 8-minute window', () => {
    const segments = normalizeSegments({
      segments: [{ start: 0.5, end: 1.5, label: 'preroll' }],
    }, 8 * 60, prerollCues)
    expect(segments[0].start).toBe(30)
    expect(segments[0].end).toBe(90)
  })

  it('does not throw away an accurate ad read when wrapping JSON', () => {
    const segments = normalizeSegments({
      analysis: 'Found one sponsor read',
      result: { segments: [{ startCue: '#3', endCue: '#6', label: 'Huel sponsor read' }] },
    }, 8 * 60, prerollCues)
    expect(segments).toHaveLength(1)
    expect(segments[0].label).toBe('Huel sponsor read')
    expect(segments[0].end - segments[0].start).toBeGreaterThan(30)
  })
})

describe('adSkipTarget', () => {
  const ads = [{ start: 16, end: 88, label: 'Huel' }]

  it('jumps to the end of the sponsor read while inside it', () => {
    expect(adSkipTarget(0, ads)).toBeNull()
    expect(adSkipTarget(16, ads)).toBe(88)
    expect(adSkipTarget(50, ads)).toBe(88)
    expect(adSkipTarget(88, ads)).toBeNull()
  })

  it('does not skip a 3-second index-as-seconds blip once playback is in the real ad', () => {
    const blip = [{ start: 3, end: 6, label: 'wrong' }]
    expect(adSkipTarget(50, blip)).toBeNull()
    expect(adSkipTarget(4, blip)).toBe(6)
  })
})
