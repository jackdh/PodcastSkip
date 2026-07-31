/** Convert decoded audio to 16 kHz mono float samples for Whisper-friendly chunks. */
export function downsampleToMono16k(buffer: AudioBuffer): Float32Array {
  const targetRate = 16000
  const channels = buffer.numberOfChannels
  const length = buffer.length
  const mono = new Float32Array(length)
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) mono[i] += data[i] / channels
  }

  if (buffer.sampleRate === targetRate) return mono

  const ratio = buffer.sampleRate / targetRate
  const newLength = Math.max(1, Math.floor(mono.length / ratio))
  const resampled = new Float32Array(newLength)
  for (let i = 0; i < newLength; i += 1) {
    const start = Math.floor(i * ratio)
    const end = Math.min(mono.length, Math.floor((i + 1) * ratio))
    let sum = 0
    const count = Math.max(1, end - start)
    for (let j = start; j < end; j += 1) sum += mono[j]
    resampled[i] = sum / count
  }
  return resampled
}

/** Encode mono float samples as 16-bit PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataLength = samples.length * 2
  const buffer = new ArrayBuffer(44 + dataLength)
  const view = new DataView(buffer)
  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataLength, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataLength, true)

  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return buffer
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x2000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunkSize) as unknown as number[],
    )
  }
  return btoa(binary)
}

export async function decodeEpisodeAudio(blob: Blob): Promise<Float32Array> {
  const context = new AudioContext()
  try {
    const raw = await blob.arrayBuffer()
    const decoded = await context.decodeAudioData(raw.slice(0))
    return downsampleToMono16k(decoded)
  } finally {
    await context.close().catch(() => undefined)
  }
}

export function wavChunkCount(sampleCount: number, sampleRate = 16000, chunkSeconds = 45): number {
  const chunkSamples = Math.max(1, Math.floor(chunkSeconds * sampleRate))
  return Math.ceil(sampleCount / chunkSamples)
}

export function encodeWavChunkAt(
  samples: Float32Array,
  chunkIndex: number,
  sampleRate = 16000,
  chunkSeconds = 45,
): { offsetSeconds: number; base64Wav: string } | null {
  const chunkSamples = Math.max(1, Math.floor(chunkSeconds * sampleRate))
  const start = chunkIndex * chunkSamples
  if (start >= samples.length) return null
  const slice = samples.subarray(start, Math.min(samples.length, start + chunkSamples))
  if (!slice.length) return null
  return {
    offsetSeconds: chunkIndex * chunkSeconds,
    base64Wav: arrayBufferToBase64(encodeWav(slice, sampleRate)),
  }
}
