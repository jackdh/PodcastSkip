import { describe, expect, it } from 'vitest'
import {
  byteAtTime,
  buildAudioSeekIndex,
  linearByteAt,
  parseMpegFrame,
  sliceBySeekIndex,
  timeAtByte,
  type AudioSeekIndex,
} from './audioSeek'

function mpeg1Layer3Header(bitrateKbps: number, sampleRate = 44100) {
  const bitrateIndex: Record<number, number> = {
    32: 1, 40: 2, 48: 3, 56: 4, 64: 5, 80: 6, 96: 7, 112: 8, 128: 9, 160: 10, 192: 11, 224: 12, 256: 13, 320: 14,
  }
  const rateIndex = sampleRate === 44100 ? 0 : sampleRate === 48000 ? 1 : 2
  const bytes = new Uint8Array(4)
  bytes[0] = 0xff
  bytes[1] = 0xfb
  bytes[2] = ((bitrateIndex[bitrateKbps] ?? 9) << 4) | (rateIndex << 2)
  bytes[3] = 0x04
  return bytes
}

function mpegFrame(bitrateKbps: number) {
  const header = mpeg1Layer3Header(bitrateKbps)
  const parsed = parseMpegFrame(header, 0)
  if (!parsed) throw new Error('test header was not a valid MPEG frame')
  const frame = new Uint8Array(parsed.length)
  frame.set(header)
  return frame
}

function concat(parts: Uint8Array[]) {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.length
  }
  return bytes
}

function box(type: string, payload: Uint8Array) {
  const bytes = new Uint8Array(8 + payload.length)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, bytes.length)
  bytes.set(Array.from(type).map((char) => char.charCodeAt(0)), 4)
  bytes.set(payload, 8)
  return bytes
}

function u32(value: number) {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

describe('linearByteAt vs a VBR-like index', () => {
  it('does not treat mid-episode time as mid-file when early audio is denser', () => {
    const duration = 100
    const size = 10_000
    const index: AudioSeekIndex = {
      kind: 'mp3-frames',
      duration,
      size,
      audioStart: 0,
      points: [
        { time: 0, byte: 0 },
        { time: 10, byte: 8000 },
        { time: 100, byte: 10_000 },
      ],
    }
    expect(linearByteAt(size, duration, 50)).toBe(5000)
    expect(byteAtTime(index, 50)).toBeGreaterThan(8500)
    expect(timeAtByte(index, 8000)).toBeCloseTo(10, 5)
  })
})

describe('MP3 frame scan', () => {
  it('maps a 50s clock onto the low-bitrate tail instead of the file midpoint', () => {
    const loud = Array.from({ length: 400 }, () => mpegFrame(128))
    const quiet = Array.from({ length: 3400 }, () => mpegFrame(32))
    const bytes = concat([...loud, ...quiet])
    const index = buildAudioSeekIndex(bytes, 'audio/mpeg', 0)
    expect(index.kind).toBe('mp3-frames')
    const midpoint = bytes.length / 2
    const atFifty = byteAtTime(index, 50)
    expect(atFifty).toBeGreaterThan(midpoint)
    const slice = sliceBySeekIndex(new Blob([bytes], { type: 'audio/mpeg' }), index, 50, 51, 0)
    expect(slice.offsetSeconds).toBeGreaterThan(48)
    expect(slice.offsetSeconds).toBeLessThan(52)
  })
})

describe('Xing TOC', () => {
  it('reads a nonlinear table of contents instead of byte-linear clocks', () => {
    const size = 20_000
    const bytes = new Uint8Array(size)
    const header = mpeg1Layer3Header(128)
    bytes.set(header, 0)
    const frame = parseMpegFrame(bytes, 0)
    if (!frame) throw new Error('expected a frame')
    const tagAt = frame.offset + 4 + 32
    bytes.set(Array.from('Xing').map((char) => char.charCodeAt(0)), tagAt)
    bytes.set([0, 0, 0, 7], tagAt + 4)
    const tocAt = tagAt + 8 + 8
    for (let percent = 0; percent < 100; percent += 1) {
      bytes[tocAt + percent] = percent < 50 ? Math.round((percent / 50) * 32) : 32 + Math.round(((percent - 50) / 50) * 224)
    }
    const index = buildAudioSeekIndex(bytes, 'audio/mpeg', 100)
    expect(index.kind).toBe('mp3-xing')
    expect(byteAtTime(index, 50)).toBeLessThan(linearByteAt(size, 100, 50) - 1000)
  })
})

describe('M4A sample table', () => {
  it('uses chunk offsets so a large early sample does not shift later clocks', () => {
    const mdhdPayload = concat([
      new Uint8Array(4),
      u32(0), u32(0),
      u32(1000),
      u32(10_000),
      new Uint8Array([0x55, 0xc4, 0, 0]),
    ])
    const hdlrPayload = concat([
      new Uint8Array(8),
      new Uint8Array([0x73, 0x6f, 0x75, 0x6e]),
      new Uint8Array(12),
      new Uint8Array([0]),
    ])
    const mdatStart = 2048
    const stts = box('stts', concat([new Uint8Array(4), u32(1), u32(10), u32(1000)]))
    const stsc = box('stsc', concat([new Uint8Array(4), u32(1), u32(1), u32(1), u32(1)]))
    const sizes = concat([u32(8000), ...Array.from({ length: 9 }, () => u32(200))])
    const stsz = box('stsz', concat([new Uint8Array(4), u32(0), u32(10), sizes]))
    const offsets = concat(Array.from({ length: 10 }, (_, index) => u32(mdatStart + (index === 0 ? 0 : 8000 + (index - 1) * 200))))
    const stco = box('stco', concat([new Uint8Array(4), u32(10), offsets]))
    const stbl = box('stbl', concat([stts, stsc, stsz, stco]))
    const minf = box('minf', stbl)
    const mdhd = box('mdhd', mdhdPayload)
    const hdlr = box('hdlr', hdlrPayload)
    const mdia = box('mdia', concat([mdhd, hdlr, minf]))
    const trak = box('trak', mdia)
    const moov = box('moov', trak)
    expect(moov.length).toBeLessThan(mdatStart)
    const file = new Uint8Array(mdatStart + 8000 + 9 * 200)
    file.set(moov, 0)
    const index = buildAudioSeekIndex(file, 'audio/mp4', 10)
    expect(index.kind).toBe('mp4')
    expect(byteAtTime(index, 0)).toBe(mdatStart)
    expect(byteAtTime(index, 1)).toBe(mdatStart + 8000)
    expect(linearByteAt(file.length, 10, 1)).not.toBe(mdatStart + 8000)
  })
})

describe('sliceBySeekIndex clocks', () => {
  it('labels a compressed fallback slice with the seek-table time, not a byte fraction', () => {
    const index: AudioSeekIndex = {
      kind: 'mp3-frames',
      duration: 100,
      size: 10_000,
      audioStart: 0,
      points: [
        { time: 0, byte: 0 },
        { time: 20, byte: 8000 },
        { time: 100, byte: 10_000 },
      ],
    }
    const slice = sliceBySeekIndex(new Blob([new Uint8Array(10_000)]), index, 20, 25, 0)
    expect(slice.offsetSeconds).toBeCloseTo(20, 5)
    expect(linearByteAt(10_000, 100, 20)).toBe(2000)
  })
})
