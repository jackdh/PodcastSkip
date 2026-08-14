import { describe, expect, it } from 'vitest'
import { normalizeScanRecord, scanRecordFromCues } from './transcriptStore'

describe('normalizeScanRecord', () => {
  it('reads the legacy cue array stored in IndexedDB', () => {
    const record = normalizeScanRecord([
      { start: 0, end: 8, text: 'Welcome back.' },
      { start: 8, end: 16, text: 'Today we have a guest.' },
    ])
    expect(record?.cues).toHaveLength(2)
    expect(record?.ranges[0]).toEqual({ start: 0, end: 16 })
  })

  it('keeps Whisper word clocks on a stored cue', () => {
    const record = normalizeScanRecord(scanRecordFromCues([{
      start: 0,
      end: 4,
      text: 'Hello there',
      words: [
        { text: 'Hello', start: 0, end: 1.2 },
        { text: 'there', start: 1.2, end: 4 },
      ],
    }]))
    expect(record?.cues[0].words).toEqual([
      { text: 'Hello', start: 0, end: 1.2 },
      { text: 'there', start: 1.2, end: 4 },
    ])
  })

  it('keeps v2 scan metadata so Scan rest can skip work', () => {
    const record = normalizeScanRecord(scanRecordFromCues(
      [{ start: 0, end: 45, text: 'Sponsor read.' }],
      { sttModel: 'openai/whisper-1', duration: 5400 },
    ))
    expect(record?.sttModel).toBe('openai/whisper-1')
    expect(record?.duration).toBe(5400)
    expect(record?.cues[0].text).toBe('Sponsor read.')
  })

  it('ignores junk', () => {
    expect(normalizeScanRecord(null)).toBeNull()
    expect(normalizeScanRecord({ cues: 'nope' })).toBeNull()
  })
})
