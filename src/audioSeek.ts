export type SeekKind = 'mp3-frames' | 'mp3-xing' | 'mp4' | 'linear'

export type SeekPoint = {
  time: number
  byte: number
}

export type AudioSeekIndex = {
  kind: SeekKind
  duration: number
  size: number
  audioStart: number
  points: SeekPoint[]
}

const MPEG1_BITRATE = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
const MPEG2_BITRATE = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
const MPEG1_RATE = [44100, 48000, 32000]
const MPEG2_RATE = [22050, 24000, 16000]

export function linearByteAt(size: number, duration: number, time: number, audioStart = 0) {
  if (!(duration > 0) || !(size > audioStart)) return audioStart
  const t = Math.min(Math.max(0, time), duration)
  return audioStart + Math.floor((t / duration) * (size - audioStart))
}

export function byteAtTime(index: AudioSeekIndex, time: number): number {
  const points = index.points
  if (!points.length) return linearByteAt(index.size, index.duration, time, index.audioStart)
  const t = Math.min(Math.max(0, time), index.duration)
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (points[mid].time <= t) lo = mid
    else hi = mid - 1
  }
  const current = points[lo]
  const next = points[lo + 1]
  if (!next || current.time >= t) return current.byte
  const span = next.time - current.time
  const frac = span > 0 ? (t - current.time) / span : 0
  return Math.floor(current.byte + frac * (next.byte - current.byte))
}

export function timeAtByte(index: AudioSeekIndex, byte: number): number {
  const points = index.points
  if (!points.length) {
    if (!(index.size > index.audioStart) || !(index.duration > 0)) return 0
    return Math.max(0, (byte - index.audioStart) / (index.size - index.audioStart)) * index.duration
  }
  const target = Math.min(Math.max(index.audioStart, byte), index.size)
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (points[mid].byte <= target) lo = mid
    else hi = mid - 1
  }
  const current = points[lo]
  const next = points[lo + 1]
  if (!next || current.byte >= target) return current.time
  const span = next.byte - current.byte
  const frac = span > 0 ? (target - current.byte) / span : 0
  return current.time + frac * (next.time - current.time)
}

export function sliceBlobByTime(
  blob: Blob,
  durationSeconds: number,
  startSeconds: number,
  endSeconds: number,
  padSeconds = 0.35,
) {
  return sliceBySeekIndex(blob, linearIndex(blob.size, durationSeconds), startSeconds, endSeconds, padSeconds)
}

export function linearIndex(size: number, duration: number, audioStart = 0): AudioSeekIndex {
  return {
    kind: 'linear',
    duration,
    size,
    audioStart,
    points: [
      { time: 0, byte: audioStart },
      { time: duration, byte: size },
    ],
  }
}

export function sliceBySeekIndex(
  blob: Blob,
  index: AudioSeekIndex,
  startSeconds: number,
  endSeconds: number,
  padSeconds = 0.35,
) {
  const paddedStart = Math.max(0, startSeconds - padSeconds)
  const paddedEnd = Math.min(index.duration, endSeconds + padSeconds)
  const startByte = Math.max(index.audioStart, Math.min(index.size - 1, byteAtTime(index, paddedStart)))
  const endByte = Math.max(startByte + 1024, Math.min(index.size, byteAtTime(index, paddedEnd)))
  return {
    blob: blob.slice(startByte, endByte),
    offsetSeconds: timeAtByte(index, startByte),
    durationSeconds: Math.max(0.5, timeAtByte(index, endByte) - timeAtByte(index, startByte)),
  }
}

export async function indexAudioBlob(blob: Blob, duration: number): Promise<AudioSeekIndex> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return buildAudioSeekIndex(bytes, blob.type, duration)
}

export function buildAudioSeekIndex(bytes: Uint8Array, mime: string, duration: number): AudioSeekIndex {
  const type = (mime || '').toLowerCase()
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) {
    const mp4 = readMp4Index(bytes, duration)
    if (mp4) return mp4
  }
  const mp3 = readMp3Index(bytes, duration)
  if (mp3) return mp3
  return linearIndex(bytes.byteLength, duration)
}

export type MpegFrame = {
  offset: number
  length: number
  samples: number
  sampleRate: number
  version: 1 | 2
  channels: number
}

export function parseMpegFrame(bytes: Uint8Array, offset: number): MpegFrame | null {
  if (offset + 4 > bytes.length) return null
  if (bytes[offset] !== 0xff || (bytes[offset + 1] & 0xe0) !== 0xe0) return null
  const b1 = bytes[offset + 1]
  const b2 = bytes[offset + 2]
  const versionBits = (b1 >> 3) & 0x03
  const layerBits = (b1 >> 1) & 0x03
  if (versionBits === 1 || layerBits !== 1) return null
  const version: 1 | 2 = versionBits === 3 ? 1 : 2
  const bitrateIndex = (b2 >> 4) & 0x0f
  const rateIndex = (b2 >> 2) & 0x03
  const padding = (b2 >> 1) & 0x01
  const bitrateTable = version === 1 ? MPEG1_BITRATE : MPEG2_BITRATE
  const rateTable = version === 1 ? MPEG1_RATE : MPEG2_RATE
  const bitrate = bitrateTable[bitrateIndex]
  const sampleRate = rateTable[rateIndex]
  if (!bitrate || !sampleRate) return null
  const samples = version === 1 ? 1152 : 576
  const length = Math.floor((samples / 8) * (bitrate * 1000) / sampleRate) + padding
  if (length < 24) return null
  const channelBits = (bytes[offset + 3] >> 6) & 0x03
  return {
    offset,
    length,
    samples,
    sampleRate,
    version,
    channels: channelBits === 3 ? 1 : 2,
  }
}

function skipId3(bytes: Uint8Array): number {
  if (bytes.length < 10) return 0
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0
  const size = ((bytes[6] & 0x7f) << 21) | ((bytes[7] & 0x7f) << 14) | ((bytes[8] & 0x7f) << 7) | (bytes[9] & 0x7f)
  return Math.min(bytes.length, 10 + size)
}

function findMpegFrame(bytes: Uint8Array, from: number, until = bytes.length): MpegFrame | null {
  const last = Math.min(bytes.length - 4, until)
  for (let offset = Math.max(0, from); offset <= last; offset += 1) {
    const frame = parseMpegFrame(bytes, offset)
    if (!frame) continue
    const next = parseMpegFrame(bytes, offset + frame.length)
    if (next || offset + frame.length >= bytes.length) return frame
  }
  return null
}

function xingOffset(frame: MpegFrame) {
  return frame.offset + 4 + (frame.version === 1 ? (frame.channels === 1 ? 17 : 32) : (frame.channels === 1 ? 9 : 17))
}

function readXingIndex(bytes: Uint8Array, duration: number): AudioSeekIndex | null {
  const audioStart = skipId3(bytes)
  const limit = Math.min(bytes.length - 4, audioStart + 65536)
  for (let offset = audioStart; offset <= limit; offset += 1) {
    const first = parseMpegFrame(bytes, offset)
    if (!first) continue
    const tagAt = xingOffset(first)
    if (tagAt + 8 > bytes.length) continue
    const tag = String.fromCharCode(bytes[tagAt], bytes[tagAt + 1], bytes[tagAt + 2], bytes[tagAt + 3])
    if (tag !== 'Xing' && tag !== 'Info') continue
    const flags = (bytes[tagAt + 4] << 24) | (bytes[tagAt + 5] << 16) | (bytes[tagAt + 6] << 8) | bytes[tagAt + 7]
    let cursor = tagAt + 8
    if (flags & 0x0001) cursor += 4
    if (flags & 0x0002) cursor += 4
    if (!(flags & 0x0004) || cursor + 100 > bytes.length || !(duration > 0)) return null
    const points: SeekPoint[] = [{ time: 0, byte: first.offset }]
    for (let percent = 1; percent < 100; percent += 1) {
      const frac = bytes[cursor + percent] / 256
      const approx = first.offset + Math.floor(frac * (bytes.length - first.offset))
      const snapped = findMpegFrame(bytes, Math.max(first.offset, approx - 2048), approx + 4096)
      points.push({
        time: (percent / 100) * duration,
        byte: snapped ? snapped.offset : approx,
      })
    }
    points.push({ time: duration, byte: bytes.length })
    return { kind: 'mp3-xing', duration, size: bytes.length, audioStart: first.offset, points }
  }
  return null
}

function readMp3FrameIndex(bytes: Uint8Array, duration: number): AudioSeekIndex | null {
  const audioStart = skipId3(bytes)
  let frame: MpegFrame | null = findMpegFrame(bytes, audioStart, audioStart + 65536)
  if (!frame) return null
  const points: SeekPoint[] = []
  let time = 0
  let counted = 0
  let lastPush = -1
  while (frame) {
    if (time - lastPush >= 0.25 || lastPush < 0) {
      points.push({ time, byte: frame.offset })
      lastPush = time
    }
    time += frame.samples / frame.sampleRate
    counted += 1
    const nextAt: number = frame.offset + frame.length
    const next: MpegFrame | null = parseMpegFrame(bytes, nextAt) ?? findMpegFrame(bytes, nextAt, nextAt + 8192)
    if (!next) break
    frame = next
    if (counted > 400_000) break
  }
  if (counted < 8 || points.length < 3) return null
  const measured = time > 0 ? time : duration
  const scale = duration > 0 && measured > 0 ? duration / measured : 1
  const scaled = scale === 1 ? points : points.map((point) => ({ time: point.time * scale, byte: point.byte }))
  scaled.push({ time: duration > 0 ? duration : measured, byte: bytes.length })
  return { kind: 'mp3-frames', duration: duration > 0 ? duration : measured, size: bytes.length, audioStart: scaled[0].byte, points: scaled }
}

function readMp3Index(bytes: Uint8Array, duration: number): AudioSeekIndex | null {
  return readXingIndex(bytes, duration) ?? readMp3FrameIndex(bytes, duration)
}

function readU32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
}

function readU64(bytes: Uint8Array, offset: number) {
  return readU32(bytes, offset) * 2 ** 32 + readU32(bytes, offset + 4)
}

type Box = { type: string; start: number; payload: number; end: number }

function readBox(bytes: Uint8Array, offset: number, limit: number): Box | null {
  if (offset + 8 > limit) return null
  let size = readU32(bytes, offset)
  const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7])
  let payload = offset + 8
  if (size === 1) {
    if (offset + 16 > limit) return null
    size = readU64(bytes, offset + 8)
    payload = offset + 16
  } else if (size === 0) {
    size = limit - offset
  }
  if (size < 8 || offset + size > limit) return null
  return { type, start: offset, payload, end: offset + size }
}

function walkBoxes(bytes: Uint8Array, start: number, end: number, visit: (box: Box) => void) {
  let offset = start
  while (offset + 8 <= end) {
    const box = readBox(bytes, offset, end)
    if (!box) return
    visit(box)
    offset = box.end
  }
}

function findBox(bytes: Uint8Array, start: number, end: number, type: string): Box | undefined {
  let found: Box | undefined
  walkBoxes(bytes, start, end, (box) => {
    if (!found && box.type === type) found = box
  })
  return found
}

function findDeep(bytes: Uint8Array, start: number, end: number, path: string[]): Box | undefined {
  let from = start
  let to = end
  let box: Box | undefined
  for (const type of path) {
    box = findBox(bytes, from, to, type)
    if (!box) return undefined
    from = box.payload
    to = box.end
  }
  return box
}

function readMp4Index(bytes: Uint8Array, duration: number): AudioSeekIndex | null {
  const moov = findBox(bytes, 0, bytes.length, 'moov')
  if (!moov) return null
  let audio: Box | undefined
  walkBoxes(bytes, moov.payload, moov.end, (trak) => {
    if (audio || trak.type !== 'trak') return
    const hdlr = findDeep(bytes, trak.payload, trak.end, ['mdia', 'hdlr'])
    if (!hdlr || hdlr.payload + 16 > hdlr.end) return
    const handler = String.fromCharCode(bytes[hdlr.payload + 8], bytes[hdlr.payload + 9], bytes[hdlr.payload + 10], bytes[hdlr.payload + 11])
    if (handler === 'soun') audio = trak
  })
  if (!audio) return null
  const mdhd = findDeep(bytes, audio.payload, audio.end, ['mdia', 'mdhd'])
  const stbl = findDeep(bytes, audio.payload, audio.end, ['mdia', 'minf', 'stbl'])
  if (!mdhd || !stbl) return null
  const version = bytes[mdhd.payload]
  const timescale = version === 1 ? readU32(bytes, mdhd.payload + 20) : readU32(bytes, mdhd.payload + 12)
  if (!(timescale > 0)) return null
  const stts = findBox(bytes, stbl.payload, stbl.end, 'stts')
  const stsc = findBox(bytes, stbl.payload, stbl.end, 'stsc')
  const stsz = findBox(bytes, stbl.payload, stbl.end, 'stsz')
  const stco = findBox(bytes, stbl.payload, stbl.end, 'stco') ?? findBox(bytes, stbl.payload, stbl.end, 'co64')
  if (!stts || !stsc || !stsz || !stco) return null

  const sttsCount = readU32(bytes, stts.payload + 4)
  const sampleDeltas: number[] = []
  let cursor = stts.payload + 8
  for (let i = 0; i < sttsCount && cursor + 8 <= stts.end; i += 1) {
    const count = readU32(bytes, cursor)
    const delta = readU32(bytes, cursor + 4)
    cursor += 8
    for (let n = 0; n < count && sampleDeltas.length < 400_000; n += 1) sampleDeltas.push(delta)
  }

  const defaultSize = readU32(bytes, stsz.payload + 4)
  const sampleCount = readU32(bytes, stsz.payload + 8)
  const sizes: number[] = []
  cursor = stsz.payload + 12
  for (let i = 0; i < sampleCount && sizes.length < 400_000; i += 1) {
    if (defaultSize) sizes.push(defaultSize)
    else if (cursor + 4 <= stsz.end) {
      sizes.push(readU32(bytes, cursor))
      cursor += 4
    }
  }

  const stscCount = readU32(bytes, stsc.payload + 4)
  const chunkRuns: Array<{ firstChunk: number; samplesPerChunk: number }> = []
  cursor = stsc.payload + 8
  for (let i = 0; i < stscCount && cursor + 12 <= stsc.end; i += 1) {
    chunkRuns.push({ firstChunk: readU32(bytes, cursor), samplesPerChunk: readU32(bytes, cursor + 4) })
    cursor += 12
  }

  const co64 = stco.type === 'co64'
  const chunkCount = readU32(bytes, stco.payload + 4)
  const chunkOffsets: number[] = []
  cursor = stco.payload + 8
  const step = co64 ? 8 : 4
  for (let i = 0; i < chunkCount && cursor + step <= stco.end; i += 1) {
    chunkOffsets.push(co64 ? readU64(bytes, cursor) : readU32(bytes, cursor))
    cursor += step
  }
  if (!sizes.length || !chunkOffsets.length || !sampleDeltas.length) return null

  const samplesPerChunk: number[] = []
  for (let chunk = 1; chunk <= chunkOffsets.length; chunk += 1) {
    let run = chunkRuns[0]
    for (const candidate of chunkRuns) {
      if (candidate.firstChunk <= chunk) run = candidate
    }
    samplesPerChunk.push(run?.samplesPerChunk || 1)
  }

  const points: SeekPoint[] = []
  let sample = 0
  let mediaTime = 0
  let lastPush = -1
  for (let chunk = 0; chunk < chunkOffsets.length; chunk += 1) {
    let byte = chunkOffsets[chunk]
    const count = samplesPerChunk[chunk] ?? 1
    for (let i = 0; i < count && sample < sizes.length; i += 1) {
      const time = mediaTime / timescale
      if (time - lastPush >= 0.25 || lastPush < 0) {
        points.push({ time, byte })
        lastPush = time
      }
      byte += sizes[sample] ?? 0
      mediaTime += sampleDeltas[sample] ?? sampleDeltas[sampleDeltas.length - 1] ?? 0
      sample += 1
    }
  }
  if (points.length < 2) return null
  const measured = mediaTime / timescale
  const total = duration > 0 ? duration : measured
  points.push({ time: total, byte: bytes.length })
  return { kind: 'mp4', duration: total, size: bytes.length, audioStart: points[0].byte, points }
}
