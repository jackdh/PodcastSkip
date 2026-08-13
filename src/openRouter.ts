import { decodeEpisodeAudio, encodeWavChunkAt, wavChunkCount, arrayBufferToBase64, encodeWav, readAudioDuration, audioFormatFromBlob, createAudioContext } from './audioTranscript'
import { indexAudioBlob, sliceBySeekIndex } from './audioSeek'
import { refineAdSegments } from './adRefine'
import { mergeOverlappingSegments, normalizeSegments } from './adParse'
import { appLog, memorySnapshot } from './appLog'
import {
  abortError,
  createTaskQueue,
  isAbortError,
  mergeCues,
  mergeRanges,
  runPool,
  uncoveredChunks,
  type TimeRange,
} from './scanCache'

export type { TimeRange }

export type AdSegment = {
  start: number
  end: number
  label?: string
}

export type TranscriptWord = {
  start: number
  end: number
  text: string
}

export type TranscriptCue = {
  start: number
  end: number
  text: string
  words?: TranscriptWord[]
}

export type KeyStatus = {
  label: string
  limitRemaining: number | null
  usage: number
  isFreeTier: boolean
}

type KeyResponse = {
  data?: {
    label?: string
    limit_remaining?: number | null
    usage?: number
    is_free_tier?: boolean
  }
}

type ChatResponse = {
  choices?: Array<{ message?: { content?: string | null } }>
  error?: { message?: string }
}

type TranscriptionSegment = {
  start?: number
  end?: number
  begin_time?: number
  end_time?: number
  text?: string
}

type TranscriptionResponse = {
  text?: string
  segments?: TranscriptionSegment[]
  sentences?: TranscriptionSegment[]
  words?: Array<{ start?: number; end?: number; word?: string; text?: string }>
  error?: { message?: string }
}

export const DEFAULT_STT_MODEL = 'openai/whisper-1'
export const QWEN_STT_MODEL = 'qwen/qwen3-asr-flash-2026-02-10'
export const DEFAULT_ANALYSIS_MODEL = 'deepseek/deepseek-v4-flash'
export const DEEPSEEK_ANALYSIS_MODEL = 'deepseek/deepseek-v4-flash'
const WHISPER_CHUNK_SECONDS = 45
const UNTIMED_STT_CHUNK_SECONDS = 15
const STT_CONCURRENCY = 4
const ANALYSIS_CONCURRENCY = 2

const openRouterHeaders = (apiKey: string, contentType = 'application/json') => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': contentType,
  'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://podcastskip.pages.dev',
  'X-OpenRouter-Title': 'Podflow',
})

export async function checkOpenRouterKey(apiKey: string): Promise<KeyStatus> {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('Add an OpenRouter API key first.')

  const response = await fetch('https://openrouter.ai/api/v1/key', {
    headers: openRouterHeaders(trimmed),
  })
  if (response.status === 401) throw new Error('API key is invalid or revoked.')
  if (!response.ok) throw new Error(`Could not reach OpenRouter (${response.status}).`)

  const payload = await response.json() as KeyResponse
  if (!payload.data) throw new Error('Unexpected response from OpenRouter.')

  return {
    label: payload.data.label ?? 'OpenRouter key',
    limitRemaining: payload.data.limit_remaining ?? null,
    usage: payload.data.usage ?? 0,
    isFreeTier: Boolean(payload.data.is_free_tier),
  }
}

export function parseDurationToSeconds(duration: string): number | undefined {
  const hours = duration.match(/(\d+)\s*h/i)
  const minutes = duration.match(/(\d+)\s*m/i)
  if (!hours && !minutes) return undefined
  return (hours ? Number(hours[1]) * 3600 : 0) + (minutes ? Number(minutes[1]) * 60 : 0)
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('Model did not return valid JSON.')
  }
}

function formatCueClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

function formatTranscriptForPrompt(cues: TranscriptCue[]): string {
  return cues
    .map((cue, index) => `#${index + 1} [${formatCueClock(cue.start)}-${formatCueClock(cue.end)}] ${cue.text.trim()}`)
    .join('\n')
}

export function cuesOverlappingRange(cues: TranscriptCue[], start: number, end: number): TranscriptCue[] {
  return cues.filter((cue) => cue.start < end && cue.end > start)
}

export function excerptAroundSegment(
  cues: TranscriptCue[],
  start: number,
  end: number,
  padSeconds = 12,
): { before: TranscriptCue[]; during: TranscriptCue[]; after: TranscriptCue[] } {
  return {
    before: cuesOverlappingRange(cues, Math.max(0, start - padSeconds), start),
    during: cuesOverlappingRange(cues, start, end),
    after: cuesOverlappingRange(cues, end, end + padSeconds),
  }
}

function sttChunkSeconds(sttModel: string) {
  return /qwen/i.test(sttModel) && /asr/i.test(sttModel) ? UNTIMED_STT_CHUNK_SECONDS : WHISPER_CHUNK_SECONDS
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(abortError())
    }, { once: true })
  })
}

async function openRouterPost(apiKey: string, path: string, body: object, signal?: AbortSignal) {
  throwIfAborted(signal)
  const post = () => fetch(`https://openrouter.ai/api/v1/${path}`, {
    method: 'POST',
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify(body),
    signal,
  })
  let response = await post()
  for (let attempt = 0; attempt < 3 && (response.status === 429 || response.status === 502 || response.status === 503); attempt += 1) {
    await sleep(800 * 2 ** attempt, signal)
    response = await post()
  }
  return response
}

function cueTime(value: unknown, fallbackUnit: 'seconds' | 'ms' = 'seconds'): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return Number.NaN
  if (fallbackUnit === 'ms' || n > 3600 * 4) return n / 1000
  return n
}

function cuesFromTimedParts(
  parts: TranscriptionSegment[] | undefined,
  offsetSeconds: number,
): TranscriptCue[] {
  if (!parts?.length) return []
  return parts
    .map((part) => {
      const text = (part.text ?? '').trim()
      const start = cueTime(part.start ?? part.begin_time)
      const end = cueTime(part.end ?? part.end_time)
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
      return {
        start: offsetSeconds + start,
        end: offsetSeconds + end,
        text,
      } satisfies TranscriptCue
    })
    .filter((cue): cue is TranscriptCue => Boolean(cue))
}

function wordsFromTimedParts(
  parts: TranscriptionResponse['words'] | undefined,
  offsetSeconds: number,
): TranscriptWord[] {
  if (!parts?.length) return []
  return parts
    .map((part) => {
      const text = (part.word ?? part.text ?? '').trim()
      const start = cueTime(part.start)
      const end = cueTime(part.end)
      if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
      return {
        start: offsetSeconds + start,
        end: offsetSeconds + end,
        text,
      } satisfies TranscriptWord
    })
    .filter((word): word is TranscriptWord => Boolean(word))
}

export function attachWordsToCues(cues: TranscriptCue[], words: TranscriptWord[]): TranscriptCue[] {
  if (!cues.length || !words.length) return cues
  return cues.map((cue) => {
    const owned = words.filter((word) => word.start < cue.end - 0.01 && word.end > cue.start + 0.01)
    return owned.length ? { ...cue, words: owned } : cue
  })
}

async function transcribeChunk(
  apiKey: string,
  base64Audio: string,
  offsetSeconds: number,
  chunkDurationSeconds: number,
  sttModel: string,
  format = 'wav',
  signal?: AbortSignal,
): Promise<TranscriptCue[]> {
  // Send the downloaded audio bytes. Never a publisher transcript URL or remote
  // file URL — official transcripts omit ads, which would make skip-ads trivial
  // to defeat.
  const audio = { data: base64Audio, format }
  const timedWordBody = {
    model: sttModel,
    language: 'en',
    response_format: 'verbose_json',
    timestamp_granularities: ['word', 'segment'],
    input_audio: audio,
  }
  const timedBody = {
    model: sttModel,
    language: 'en',
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
    input_audio: audio,
  }
  const plainBody = {
    model: sttModel,
    input_audio: audio,
  }

  throwIfAborted(signal)
  let response = await openRouterPost(apiKey, 'audio/transcriptions', timedWordBody, signal)
  if (response.status === 400) response = await openRouterPost(apiKey, 'audio/transcriptions', timedBody, signal)
  if (response.status === 400) response = await openRouterPost(apiKey, 'audio/transcriptions', plainBody, signal)

  if (response.status === 401) throw new Error('API key is invalid or revoked.')
  if (response.status === 402) throw new Error('OpenRouter credits are exhausted.')
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail ? `Transcription failed: ${detail.slice(0, 180)}` : `Transcription failed (${response.status}).`)
  }

  const payload = await response.json() as TranscriptionResponse
  if (payload.error?.message) throw new Error(payload.error.message)

  const words = wordsFromTimedParts(payload.words, offsetSeconds)
  const timed = attachWordsToCues(cuesFromTimedParts(payload.segments, offsetSeconds), words)
  if (timed.length) return timed
  const sentenceCues = attachWordsToCues(cuesFromTimedParts(payload.sentences, offsetSeconds), words)
  if (sentenceCues.length) return sentenceCues

  const text = (payload.text ?? '').trim()
  if (!text) return []
  const fallback: TranscriptCue = {
    start: offsetSeconds,
    end: offsetSeconds + Math.max(1, chunkDurationSeconds),
    text,
  }
  return attachWordsToCues([fallback], words)
}

export async function transcribeEpisodeSamples(options: {
  apiKey: string
  samples: Float32Array
  sttModel?: string
  maxMinutes?: number
  startMinutes?: number
  signal?: AbortSignal
  onProgress?: (message: string) => void
}): Promise<{ cues: TranscriptCue[]; durationSeconds: number }> {
  const trimmed = options.apiKey.trim()
  if (!trimmed) throw new Error('Add an OpenRouter API key in Settings first.')

  let samples = options.samples
  let offsetSeconds = 0
  if (options.startMinutes && options.startMinutes > 0) {
    const startSamples = Math.floor(options.startMinutes * 60 * 16000)
    offsetSeconds = startSamples / 16000
    if (startSamples < samples.length) samples = samples.subarray(startSamples)
  }
  if (options.maxMinutes && options.maxMinutes > 0) {
    const maxSamples = Math.floor(options.maxMinutes * 60 * 16000)
    if (samples.length > maxSamples) samples = samples.subarray(0, maxSamples)
  }

  const durationSeconds = offsetSeconds + samples.length / 16000
  if (samples.length / 16000 < 15) throw new Error('This episode is too short to analyse for ads.')

  const sttModel = options.sttModel ?? DEFAULT_STT_MODEL
  const chunkSeconds = sttChunkSeconds(sttModel)
  const totalChunks = wavChunkCount(samples.length, 16000, chunkSeconds)
  const indexes = Array.from({ length: totalChunks }, (_, index) => index)

  const batches = await runPool(indexes, STT_CONCURRENCY, async (index) => {
    const chunk = encodeWavChunkAt(samples, index, 16000, chunkSeconds)
    if (!chunk) return [] as TranscriptCue[]
    return transcribeChunk(
      trimmed,
      chunk.base64Wav,
      offsetSeconds + chunk.offsetSeconds,
      chunk.durationSeconds,
      sttModel,
      'wav',
      options.signal,
    )
  }, (done, total) => {
    options.onProgress?.(`Transcribing downloaded audio ${done}/${total}…`)
  }, options.signal)

  const cues = batches.flat()
  if (!cues.length) throw new Error('Transcription returned no speech to analyse.')
  return { cues, durationSeconds }
}

export async function transcribeEpisodeAudio(options: {
  apiKey: string
  audioBlob: Blob
  sttModel?: string
  maxMinutes?: number
  existingCues?: TranscriptCue[]
  existingRanges?: TimeRange[]
  signal?: AbortSignal
  onProgress?: (message: string) => void
  onPartial?: (update: { cues: TranscriptCue[]; ranges: TimeRange[] }) => void
}): Promise<{ cues: TranscriptCue[]; durationSeconds: number }> {
  return transcribeEpisodeBlob(options)
}

async function analyseCueWindow(
  options: {
    apiKey: string
    model: string
    title: string
    show: string
    description?: string
    durationSeconds: number
  },
  windowCues: TranscriptCue[],
  windowIndex: number,
  signal?: AbortSignal,
): Promise<AdSegment[]> {
  const lastCueId = windowCues.length
  const transcript = formatTranscriptForPrompt(windowCues)
  const prompt = `You are analysing a numbered podcast transcript to find advertisement and sponsor-read segments.

Return ONLY JSON:
{"segments":[{"startCue":13,"endCue":19,"label":"sponsor reads"}]}

Rules:
- startCue and endCue are inclusive cue ids from the # numbers below (1 through ${lastCueId})
- Those ids are NOT clock minutes or seconds: #20 is cue twenty, not 0:20 or 20:00
- start/end are also allowed if they copy those # ids or the [m:ss] clocks printed on each line
- Do not invent ids or round to whole minutes; copy ids or clocks from the transcript
- Mark the FULL sponsor read: cold-open sales copy, "brought to you by", the product pitch, discount/URL closer, and the last commercial sentence
- Do NOT mark show intros/outros, headlines, or news/host copy that is not selling something
- Stop at the last commercial sentence. The first cue that returns to the story/news is NOT part of the ad
- Merge contiguous commercial cues into one segment — never mark only the "brought to you by" line
- If unsure, omit the segment
- If none found, return {"segments":[]}

Show: ${options.show}
Title: ${options.title}
Description: ${(options.description ?? '').slice(0, 1200)}
Analysed duration: ${options.durationSeconds.toFixed(1)} seconds

Transcript:
${transcript}`

  const response = await openRouterPost(options.apiKey, 'chat/completions', {
    model: options.model,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You detect podcast advertisements from numbered transcript cues. Reply with JSON only using startCue/endCue ids. Never treat cue ids as clock minutes.' },
      { role: 'user', content: prompt },
    ],
  }, signal)

  if (response.status === 401) throw new Error('API key is invalid or revoked.')
  if (response.status === 402) throw new Error('OpenRouter credits are exhausted.')
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail ? `OpenRouter error: ${detail.slice(0, 180)}` : `OpenRouter request failed (${response.status}).`)
  }

  const payload = await response.json() as ChatResponse
  if (payload.error?.message) throw new Error(payload.error.message)
  const content = payload.choices?.[0]?.message?.content
  if (!content) throw new Error('OpenRouter returned an empty response.')

  const parsed = normalizeSegments(extractJsonObject(content), options.durationSeconds, windowCues)
  appLog('info', 'ad analysis model reply', {
    window: windowIndex + 1,
    raw: content.slice(0, 1200),
    parsed: parsed.map((segment) => ({
      start: Number(segment.start.toFixed(1)),
      end: Number(segment.end.toFixed(1)),
      label: segment.label,
    })),
  })
  return parsed
}

export async function detectAdSegmentsFromTranscript(options: {
  apiKey: string
  model: string
  title: string
  show: string
  description?: string
  durationSeconds: number
  cues: TranscriptCue[]
  signal?: AbortSignal
  onProgress?: (message: string) => void
}): Promise<AdSegment[]> {
  const trimmed = options.apiKey.trim()
  if (!trimmed) throw new Error('Add an OpenRouter API key in Settings first.')
  if (!options.cues.length) throw new Error('No transcript available for ad detection.')

  const windows = splitCuesForPrompt(options.cues)
  appLog('info', 'ad analysis start', {
    model: options.model,
    cues: options.cues.length,
    windows: windows.length,
    duration: Number(options.durationSeconds.toFixed(1)),
    coverage: options.cues.length
      ? `${formatCueClock(options.cues[0].start)}-${formatCueClock(options.cues[options.cues.length - 1].end)}`
      : 'none',
  })

  const collected = await runPool(windows, ANALYSIS_CONCURRENCY, async (windowCues, index) => {
    if (windows.length > 1) options.onProgress?.(`Finding ad breaks ${index + 1}/${windows.length}…`)
    return analyseCueWindow({ ...options, apiKey: trimmed }, windowCues, index, options.signal)
  }, undefined, options.signal)

  const merged = refineAdSegments(mergeOverlappingSegments(collected.flat().sort((a, b) => a.start - b.start)), options.cues)
  appLog('info', 'ad analysis done', { raw: collected.flat().length, refined: merged.length })
  return merged
}

function splitCuesForPrompt(cues: TranscriptCue[], maxChars = 80_000): TranscriptCue[][] {
  const full = formatTranscriptForPrompt(cues)
  if (full.length <= maxChars) return [cues]

  const windows: TranscriptCue[][] = []
  let current: TranscriptCue[] = []
  let chars = 0
  for (const cue of cues) {
    const line = formatTranscriptForPrompt([cue]).length + 1
    if (current.length && chars + line > maxChars) {
      windows.push(current)
      const overlap = current.slice(-8)
      current = [...overlap, cue]
      chars = formatTranscriptForPrompt(current).length
    } else {
      current.push(cue)
      chars += line
    }
  }
  if (current.length) windows.push(current)
  return windows.length ? windows : [cues]
}

export async function detectAdSegmentsFromSamples(options: {
  apiKey: string
  model: string
  title: string
  show: string
  description?: string
  samples: Float32Array
  sttModel?: string
  maxMinutes?: number
  startMinutes?: number
  signal?: AbortSignal
  onProgress?: (message: string) => void
}): Promise<{ segments: AdSegment[]; cues: TranscriptCue[]; durationSeconds: number }> {
  const { cues, durationSeconds } = await transcribeEpisodeSamples({
    apiKey: options.apiKey,
    samples: options.samples,
    sttModel: options.sttModel,
    maxMinutes: options.maxMinutes,
    startMinutes: options.startMinutes,
    signal: options.signal,
    onProgress: options.onProgress,
  })
  options.onProgress?.('Finding ad breaks in the spoken transcript…')
  const segments = await detectAdSegmentsFromTranscript({
    apiKey: options.apiKey,
    model: options.model,
    title: options.title,
    show: options.show,
    description: options.description,
    durationSeconds,
    cues,
    signal: options.signal,
    onProgress: options.onProgress,
  })
  return { segments, cues, durationSeconds }
}

export async function detectAdSegmentsFromAudio(options: {
  apiKey: string
  model: string
  title: string
  show: string
  description?: string
  audioBlob: Blob
  sttModel?: string
  maxMinutes?: number
  existingCues?: TranscriptCue[]
  existingRanges?: TimeRange[]
  signal?: AbortSignal
  onProgress?: (message: string) => void
  onPartial?: (update: { cues: TranscriptCue[]; ranges: TimeRange[] }) => void
}): Promise<{ segments: AdSegment[]; cues: TranscriptCue[]; durationSeconds: number; ranges: TimeRange[] }> {
  const { cues, durationSeconds, ranges } = await transcribeEpisodeBlob({
    apiKey: options.apiKey,
    audioBlob: options.audioBlob,
    sttModel: options.sttModel,
    maxMinutes: options.maxMinutes,
    existingCues: options.existingCues,
    existingRanges: options.existingRanges,
    signal: options.signal,
    onProgress: options.onProgress,
    onPartial: options.onPartial,
  })
  options.onProgress?.('Finding ad breaks in the spoken transcript…')
  const segments = await detectAdSegmentsFromTranscript({
    apiKey: options.apiKey,
    model: options.model,
    title: options.title,
    show: options.show,
    description: options.description,
    durationSeconds,
    cues,
    signal: options.signal,
    onProgress: options.onProgress,
  })
  return { segments, cues, durationSeconds, ranges }
}

export async function transcribeEpisodeBlob(options: {
  apiKey: string
  audioBlob: Blob
  sttModel?: string
  maxMinutes?: number
  existingCues?: TranscriptCue[]
  existingRanges?: TimeRange[]
  signal?: AbortSignal
  onProgress?: (message: string) => void
  onPartial?: (update: { cues: TranscriptCue[]; ranges: TimeRange[] }) => void
}): Promise<{ cues: TranscriptCue[]; durationSeconds: number; ranges: TimeRange[] }> {
  const trimmed = options.apiKey.trim()
  if (!trimmed) throw new Error('Add an OpenRouter API key in Settings first.')

  const blob = options.audioBlob
  appLog('info', 'transcribe blob', {
    bytes: blob.size,
    type: blob.type || 'unknown',
    maxMinutes: options.maxMinutes ?? 0,
    stt: options.sttModel ?? DEFAULT_STT_MODEL,
    memory: memorySnapshot(),
  })
  throwIfAborted(options.signal)
  options.onProgress?.('Reading downloaded audio…')
  const fullDuration = await readAudioDuration(blob)
  const windowSeconds = options.maxMinutes && options.maxMinutes > 0
    ? Math.min(fullDuration, options.maxMinutes * 60)
    : fullDuration
  if (windowSeconds < 15) throw new Error('This episode is too short to analyse for ads.')

  const sttModel = options.sttModel ?? DEFAULT_STT_MODEL
  const chunkSeconds = sttChunkSeconds(sttModel)
  const format = audioFormatFromBlob(blob)
  const cached = options.existingRanges ?? []
  const needed = uncoveredChunks(0, windowSeconds, chunkSeconds, cached)
  const skippedChunks = Math.max(0, Math.ceil(windowSeconds / chunkSeconds) - needed.length)

  appLog('info', 'audio duration ready', {
    fullDuration: Number(fullDuration.toFixed(1)),
    windowSeconds: Number(windowSeconds.toFixed(1)),
    chunks: needed.length,
    skipped: skippedChunks,
    chunkSeconds,
    format,
    memory: memorySnapshot(),
  })

  if (!needed.length) {
    const cues = options.existingCues ?? []
    if (!cues.length) throw new Error('Transcription returned no speech to analyse.')
    options.onProgress?.('Using the transcript already saved on this device…')
    return { cues, durationSeconds: windowSeconds, ranges: mergeRanges(cached) }
  }

  options.onProgress?.('Indexing episode audio…')
  const seekIndex = await indexAudioBlob(blob, fullDuration)
  appLog('info', 'audio index', { kind: seekIndex.kind, points: seekIndex.points.length })

  options.onProgress?.(skippedChunks
    ? `Transcribing ${needed.length} remaining chunks (${skippedChunks} already saved)…`
    : `Transcribing downloaded audio 0/${needed.length}…`)

  let context: AudioContext | undefined
  try {
    context = createAudioContext()
  } catch {
    context = undefined
  }
  const decodeOne = createTaskQueue()
  const mergeOne = createTaskQueue()
  let accumulated = options.existingCues ?? []
  const completed: TimeRange[] = []

  try {
    await runPool(needed, STT_CONCURRENCY, async (range) => {
      throwIfAborted(options.signal)
      const slice = sliceBySeekIndex(blob, seekIndex, range.start, range.end)
      appLog('info', 'chunk', {
        start: Number(range.start.toFixed(1)),
        end: Number(range.end.toFixed(1)),
        offset: Number(slice.offsetSeconds.toFixed(1)),
        sliceBytes: slice.blob.size,
        seek: seekIndex.kind,
        memory: memorySnapshot(),
      })
      let chunkCues: TranscriptCue[] = []
      let wav: string | undefined
      try {
        if (!context) throw new Error('AudioContext unavailable')
        const samples = await decodeOne(() => decodeEpisodeAudio(slice.blob, context))
        wav = arrayBufferToBase64(encodeWav(samples, 16000))
      } catch (error) {
        if (isAbortError(error)) throw error
        appLog('warn', 'chunk decode failed, sending compressed audio', {
          message: error instanceof Error ? error.message : String(error),
        })
      }
      if (wav) {
        chunkCues = await transcribeChunk(trimmed, wav, slice.offsetSeconds, slice.durationSeconds, sttModel, 'wav', options.signal)
      } else {
        const compressed = arrayBufferToBase64(await slice.blob.arrayBuffer())
        chunkCues = await transcribeChunk(
          trimmed,
          compressed,
          slice.offsetSeconds,
          slice.durationSeconds,
          sttModel,
          format,
          options.signal,
        )
      }
      await mergeOne(async () => {
        accumulated = mergeCues(accumulated, chunkCues)
        completed.push(range)
        options.onPartial?.({ cues: accumulated, ranges: mergeRanges([...cached, ...completed]) })
      })
      return chunkCues
    }, (done, total) => {
      options.onProgress?.(skippedChunks
        ? `Transcribing ${done}/${total} remaining chunks…`
        : `Transcribing downloaded audio ${done}/${total}…`)
    }, options.signal)

    const cues = accumulated
    if (!cues.length) throw new Error('Transcription returned no speech to analyse.')
    const ranges = mergeRanges([...cached, ...needed])
    appLog('info', 'transcription complete', {
      cues: cues.length,
      transcribed: needed.length,
      skipped: skippedChunks,
      memory: memorySnapshot(),
    })
    return { cues, durationSeconds: windowSeconds, ranges }
  } finally {
    if (context) await context.close().catch(() => undefined)
  }
}

export function formatCredits(value: number | null): string {
  if (value === null) return 'Unlimited key limit'
  if (value >= 1) return `$${value.toFixed(2)} remaining on key`
  return `$${value.toFixed(4)} remaining on key`
}

export function formatMinutesSaved(seconds: number): string {
  const totalSeconds = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(totalSeconds / 60)
  const remainder = totalSeconds % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }
  if (minutes === 0) return `${remainder}s`
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`
}
