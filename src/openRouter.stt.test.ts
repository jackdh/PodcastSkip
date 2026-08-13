import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STT_MODEL,
  QWEN_STT_MODEL,
  isQwenAsr,
  sttChunkSeconds,
  sttConcurrency,
} from './openRouter'

describe('stt plan', () => {
  it('keeps Qwen on short clips and overlaps more requests than Whisper', () => {
    expect(isQwenAsr(QWEN_STT_MODEL)).toBe(true)
    expect(sttChunkSeconds(QWEN_STT_MODEL)).toBe(15)
    expect(sttConcurrency(QWEN_STT_MODEL)).toBe(12)

    expect(isQwenAsr(DEFAULT_STT_MODEL)).toBe(false)
    expect(sttChunkSeconds(DEFAULT_STT_MODEL)).toBe(45)
    expect(sttConcurrency(DEFAULT_STT_MODEL)).toBe(8)
  })
})
