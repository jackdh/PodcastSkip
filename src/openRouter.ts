import { decodeEpisodeAudio, encodeWavChunkAt, wavChunkCount } from './audioTranscript'

export type AdSegment = {
  start: number
  end: number
  label?: string
}

export type TranscriptCue = {
  start: number
  end: number
  text: string
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
  text?: string
}

type TranscriptionResponse = {
  text?: string
  segments?: TranscriptionSegment[]
  error?: { message?: string }
}

const DEFAULT_STT_MODEL = 'openai/whisper-1'
const CHUNK_SECONDS = 45

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

function normalizeSegments(raw: unknown, durationSeconds: number): AdSegment[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { segments?: unknown }).segments)
      ? (raw as { segments: unknown[] }).segments
      : null
  if (!list) throw new Error('Model response was missing ad segments.')

  const segments: AdSegment[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const start = Number(record.start ?? record.startSeconds ?? record.from)
    const end = Number(record.end ?? record.endSeconds ?? record.to)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue
    const clampedStart = Math.max(0, Math.min(start, durationSeconds))
    const clampedEnd = Math.max(clampedStart + 1, Math.min(end, durationSeconds))
    if (clampedEnd - clampedStart < 2) continue
    segments.push({
      start: clampedStart,
      end: clampedEnd,
      label: typeof record.label === 'string' ? record.label : typeof record.type === 'string' ? record.type : undefined,
    })
  }
  return mergeOverlappingSegments(segments.sort((a, b) => a.start - b.start))
}

function mergeOverlappingSegments(segments: AdSegment[]): AdSegment[] {
  if (!segments.length) return []
  const merged: AdSegment[] = [{ ...segments[0] }]
  for (let i = 1; i < segments.length; i += 1) {
    const current = segments[i]
    const last = merged[merged.length - 1]
    if (current.start <= last.end + 1.5) {
      last.end = Math.max(last.end, current.end)
      if (current.label && !last.label) last.label = current.label
    } else {
      merged.push({ ...current })
    }
  }
  return merged
}

function formatCueClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

function formatTranscriptForPrompt(cues: TranscriptCue[]): string {
  return cues
    .map((cue) => `[${formatCueClock(cue.start)}-${formatCueClock(cue.end)}] ${cue.text.trim()}`)
    .filter((line) => line.length > 12)
    .join('\n')
}

async function transcribeChunk(
  apiKey: string,
  base64Wav: string,
  offsetSeconds: number,
  sttModel: string,
): Promise<TranscriptCue[]> {
  const response = await fetch('https://openrouter.ai/api/v1/audio/transcriptions', {
    method: 'POST',
    headers: openRouterHeaders(apiKey),
    body: JSON.stringify({
      model: sttModel,
      language: 'en',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
      input_audio: {
        data: base64Wav,
        format: 'wav',
      },
    }),
  })

  if (response.status === 401) throw new Error('API key is invalid or revoked.')
  if (response.status === 402) throw new Error('OpenRouter credits are exhausted.')
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(detail ? `Transcription failed: ${detail.slice(0, 180)}` : `Transcription failed (${response.status}).`)
  }

  const payload = await response.json() as TranscriptionResponse
  if (payload.error?.message) throw new Error(payload.error.message)

  if (payload.segments?.length) {
    return payload.segments
      .map((segment) => {
        const text = (segment.text ?? '').trim()
        const start = Number(segment.start)
        const end = Number(segment.end)
        if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
        return {
          start: offsetSeconds + start,
          end: offsetSeconds + end,
          text,
        } satisfies TranscriptCue
      })
      .filter((cue): cue is TranscriptCue => Boolean(cue))
  }

  const text = (payload.text ?? '').trim()
  if (!text) return []
  return [{ start: offsetSeconds, end: offsetSeconds + CHUNK_SECONDS, text }]
}

export async function transcribeEpisodeSamples(options: {
  apiKey: string
  samples: Float32Array
  sttModel?: string
  onProgress?: (message: string) => void
}): Promise<{ cues: TranscriptCue[]; durationSeconds: number }> {
  const trimmed = options.apiKey.trim()
  if (!trimmed) throw new Error('Add an OpenRouter API key in Settings first.')

  const durationSeconds = options.samples.length / 16000
  if (durationSeconds < 15) throw new Error('This episode is too short to analyse for ads.')

  const totalChunks = wavChunkCount(options.samples.length, 16000, CHUNK_SECONDS)
  const sttModel = options.sttModel ?? DEFAULT_STT_MODEL
  const cues: TranscriptCue[] = []

  for (let index = 0; index < totalChunks; index += 1) {
    const chunk = encodeWavChunkAt(options.samples, index, 16000, CHUNK_SECONDS)
    if (!chunk) continue
    options.onProgress?.(`Transcribing audio ${index + 1}/${totalChunks}…`)
    const chunkCues = await transcribeChunk(trimmed, chunk.base64Wav, chunk.offsetSeconds, sttModel)
    cues.push(...chunkCues)
  }

  if (!cues.length) throw new Error('Transcription returned no speech to analyse.')
  return { cues, durationSeconds }
}

export async function transcribeEpisodeAudio(options: {
  apiKey: string
  audioBlob: Blob
  sttModel?: string
  onProgress?: (message: string) => void
}): Promise<{ cues: TranscriptCue[]; durationSeconds: number }> {
  options.onProgress?.('Decoding downloaded audio…')
  const samples = await decodeEpisodeAudio(options.audioBlob)
  return transcribeEpisodeSamples({
    apiKey: options.apiKey,
    samples,
    sttModel: options.sttModel,
    onProgress: options.onProgress,
  })
}

export async function detectAdSegmentsFromTranscript(options: {
  apiKey: string
  model: string
  title: string
  show: string
  description?: string
  durationSeconds: number
  cues: TranscriptCue[]
}): Promise<AdSegment[]> {
  const trimmed = options.apiKey.trim()
  if (!trimmed) throw new Error('Add an OpenRouter API key in Settings first.')
  if (!options.cues.length) throw new Error('No transcript available for ad detection.')

  const transcript = formatTranscriptForPrompt(options.cues).slice(0, 100_000)
  const prompt = `You are analysing a timed podcast transcript to find advertisement and sponsor-read segments.

Return ONLY JSON:
{"segments":[{"start":12.5,"end":67.0,"label":"sponsor read"}]}

Rules:
- start/end are seconds from episode start
- episode length is ${options.durationSeconds.toFixed(1)} seconds
- Use the transcript timestamps; do not invent times outside spoken cues
- Mark host-read ads, sponsored messages, network ads, "this show is brought to you by", discount codes, and similar commercial reads
- Do NOT mark show intros/outros that are not selling something
- Merge contiguous ad copy into one segment
- If unsure, omit the segment
- If none found, return {"segments":[]}

Show: ${options.show}
Title: ${options.title}
Description: ${(options.description ?? '').slice(0, 1200)}

Transcript:
${transcript}`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: openRouterHeaders(trimmed),
    body: JSON.stringify({
      model: options.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You detect podcast advertisements from timed transcripts. Reply with JSON only.' },
        { role: 'user', content: prompt },
      ],
    }),
  })

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

  return normalizeSegments(extractJsonObject(content), options.durationSeconds)
}

export async function detectAdSegmentsFromSamples(options: {
  apiKey: string
  model: string
  title: string
  show: string
  description?: string
  samples: Float32Array
  sttModel?: string
  onProgress?: (message: string) => void
}): Promise<{ segments: AdSegment[]; cues: TranscriptCue[]; durationSeconds: number }> {
  const { cues, durationSeconds } = await transcribeEpisodeSamples({
    apiKey: options.apiKey,
    samples: options.samples,
    sttModel: options.sttModel,
    onProgress: options.onProgress,
  })
  options.onProgress?.('Finding ad breaks in the transcript…')
  const segments = await detectAdSegmentsFromTranscript({
    apiKey: options.apiKey,
    model: options.model,
    title: options.title,
    show: options.show,
    description: options.description,
    durationSeconds,
    cues,
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
  onProgress?: (message: string) => void
}): Promise<AdSegment[]> {
  options.onProgress?.('Decoding downloaded audio…')
  const samples = await decodeEpisodeAudio(options.audioBlob)
  const { segments } = await detectAdSegmentsFromSamples({
    apiKey: options.apiKey,
    model: options.model,
    title: options.title,
    show: options.show,
    description: options.description,
    samples,
    sttModel: options.sttModel,
    onProgress: options.onProgress,
  })
  return segments
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
