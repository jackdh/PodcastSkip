import { describe, expect, it } from 'vitest'
import { scanProgressCopy } from './scanProgress'

describe('scanProgressCopy', () => {
  it('keeps downloaded-audio progress and concurrency', () => {
    expect(scanProgressCopy('Transcribing downloaded audio 0/11 · 8 at once…')).toEqual({
      title: 'Transcribing downloaded audio',
      detail: '0/11 · 8 at once',
      player: 'Downloaded audio 0/11 · 8 at once',
    })
  })

  it('keeps remaining-chunk progress and the saved count', () => {
    expect(scanProgressCopy('Transcribing 32/40 remaining chunks (11 already saved)…')).toEqual({
      title: 'Transcribing 32/40',
      detail: 'remaining chunks · 11 already saved',
      player: '32/40 · 11 already saved',
    })
  })

  it('passes other scan stages through as a single line', () => {
    expect(scanProgressCopy('Reading downloaded audio…').player).toBe('Reading downloaded audio')
  })
})