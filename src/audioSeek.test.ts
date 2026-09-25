import { describe, expect, it } from 'vitest'
import {
  byteAtTime,
  buildAudioSeekIndex,
  indexAudioBlob,
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
  it('uses chunk offsets so a large early sample does not shift later clocks', async () => {
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
    const streamed = await indexAudioBlob(new Blob([file], { type: 'audio/mp4' }), 10)
    expect(index.kind).toBe('mp4')
    expect(streamed.kind).toBe('mp4')
    expect(streamed.points.map((point) => point.byte)).toEqual(index.points.map((point) => point.byte))
    expect(byteAtTime(index, 0)).toBe(mdatStart)
    expect(byteAtTime(index, 1)).toBe(mdatStart + 8000)
    expect(linearByteAt(file.length, 10, 1)).not.toBe(mdatStart + 8000)
  })
})

function id3(payloadSize: number) {
  const bytes = new Uint8Array(10 + payloadSize)
  bytes.set([0x49, 0x44, 0x33, 4, 0, 0], 0)
  bytes[6] = (payloadSize >> 21) & 0x7f
  bytes[7] = (payloadSize >> 14) & 0x7f
  bytes[8] = (payloadSize >> 7) & 0x7f
  bytes[9] = payloadSize & 0x7f
  bytes.fill(0xab, 10)
  return bytes
}

class CountingBlob extends Blob {
  ranges: Array<{ start: number; end: number }> = []
  slice(start?: number, end?: number, contentType?: string) {
    const from = start ?? 0
    const to = end ?? this.size
    this.ranges.push({ start: from, end: to })
    return super.slice(start, end, contentType)
  }
}

describe('indexAudioBlob memory', () => {
  it('matches an in-memory frame index without reading the whole file at once', async () => {
    const loud = Array.from({ length: 400 }, () => mpegFrame(128))
    const quiet = Array.from({ length: 3400 }, () => mpegFrame(32))
    const bytes = concat([...loud, ...quiet])
    const blob = new CountingBlob([bytes], { type: 'audio/mpeg' })
    const streamed = await indexAudioBlob(blob, 0)
    const full = buildAudioSeekIndex(bytes, 'audio/mpeg', 0)
    expect(streamed.kind).toBe('mp3-frames')
    expect(streamed.duration).toBeCloseTo(full.duration, 5)
    expect(streamed.points.map((point) => point.byte)).toEqual(full.points.map((point) => point.byte))
    expect(blob.size).toBeGreaterThan(256 * 1024)
    expect(blob.ranges.every((range) => range.end - range.start <= 256 * 1024)).toBe(true)
  })

  it('reads a Xing table past a large ID3 tag without loading the tag or the rest of the file', async () => {
    const size = 20_000
    const audio = new Uint8Array(size)
    const header = mpeg1Layer3Header(128)
    audio.set(header, 0)
    const frame = parseMpegFrame(audio, 0)
    if (!frame) throw new Error('expected a frame')
    const tagAt = frame.offset + 4 + 32
    audio.set(Array.from('Xing').map((char) => char.charCodeAt(0)), tagAt)
    audio.set([0, 0, 0, 7], tagAt + 4)
    const frames = 44100
    audio[tagAt + 8] = (frames >> 24) & 0xff
    audio[tagAt + 9] = (frames >> 16) & 0xff
    audio[tagAt + 10] = (frames >> 8) & 0xff
    audio[tagAt + 11] = frames & 0xff
    const tocAt = tagAt + 8 + 8
    for (let percent = 0; percent < 100; percent += 1) {
      audio[tocAt + percent] = percent < 50 ? Math.round((percent / 50) * 32) : 32 + Math.round(((percent - 50) / 50) * 224)
    }
    const prefix = id3(180_000)
    const blob = new CountingBlob([prefix, audio], { type: 'audio/mpeg' })
    const index = await indexAudioBlob(blob, 100)
    const memory = buildAudioSeekIndex(audio, 'audio/mpeg', 100)
    expect(index.kind).toBe('mp3-xing')
    expect(index.audioStart).toBe(prefix.length)
    expect(byteAtTime(index, 50) - prefix.length).toBe(byteAtTime(memory, 50))
    const tagBody = blob.ranges.filter((range) => range.start < prefix.length && range.end > 16)
    expect(tagBody).toEqual([])
    expect(blob.ranges.every((range) => range.end - range.start <= 64 * 1024)).toBe(true)
    expect(blob.size).toBeGreaterThan(64 * 1024)
  })

  it('takes duration from the Xing frame count when playback has not loaded', async () => {
    const audio = new Uint8Array(2048)
    const header = mpeg1Layer3Header(128)
    audio.set(header, 0)
    const frame = parseMpegFrame(audio, 0)
    if (!frame) throw new Error('expected a frame')
    const tagAt = frame.offset + 4 + 32
    audio.set(Array.from('Info').map((char) => char.charCodeAt(0)), tagAt)
    audio.set([0, 0, 0, 5], tagAt + 4)
    const frames = 225244
    audio[tagAt + 8] = (frames >> 24) & 0xff
    audio[tagAt + 9] = (frames >> 16) & 0xff
    audio[tagAt + 10] = (frames >> 8) & 0xff
    audio[tagAt + 11] = frames & 0xff
    for (let percent = 0; percent < 100; percent += 1) audio[tagAt + 12 + percent] = Math.round((percent / 99) * 255)
    const index = await indexAudioBlob(new Blob([audio], { type: 'audio/mpeg' }), 0)
    expect(index.kind).toBe('mp3-xing')
    expect(index.duration).toBeCloseTo((frames * 1152) / 44100, 5)
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
