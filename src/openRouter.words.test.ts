import { describe, expect, it } from 'vitest'
import { attachWordsToCues } from './openRouter'

describe('attachWordsToCues', () => {
  it('pins Whisper words onto the segment they were spoken in', () => {
    const cues = attachWordsToCues(
      [
        { start: 10, end: 14, text: 'hello there' },
        { start: 14, end: 18, text: 'friends' },
      ],
      [
        { start: 10, end: 12, text: 'hello' },
        { start: 12, end: 14, text: 'there' },
        { start: 14, end: 18, text: 'friends' },
      ],
    )
    expect(cues[0].words?.map((word) => word.text)).toEqual(['hello', 'there'])
    expect(cues[1].words?.map((word) => word.text)).toEqual(['friends'])
  })
})
