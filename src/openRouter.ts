export type AdSegment = {
  start: number
  end: number
  label?: string
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

const openRouterHeaders = (apiKey: string) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
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
  return segments.sort((a, b) => a.start - b.start)
}

export async function detectAdSegments(options: {
  apiKey: string
  model: string
  title: string
  show: string
  description?: string
  durationSeconds: number
}): Promise<AdSegment[]> {
  const trimmed = options.apiKey.trim()
  if (!trimmed) throw new Error('Add an OpenRouter API key in Settings first.')
  if (!options.durationSeconds || options.durationSeconds < 30) {
    throw new Error('Episode duration is needed before ads can be detected.')
  }

  const durationMinutes = Math.round(options.durationSeconds / 60)
  const prompt = `You analyse podcast episode metadata to estimate advertisement / sponsor break timestamps.

Return ONLY JSON of the form:
{"segments":[{"start":0,"end":45,"label":"pre-roll"}]}

Rules:
- start and end are seconds from the beginning of the episode
- episode length is ${options.durationSeconds} seconds (~${durationMinutes} minutes)
- Prefer explicit sponsor or ad cues in the description when present
- Otherwise estimate typical podcast ad placement (short pre-roll, mid-rolls, optional post-roll)
- Keep segments between 15 and 120 seconds each
- Do not invent segments that cover more than ~25% of the episode total
- If no ads seem likely, return {"segments":[]}

Show: ${options.show}
Title: ${options.title}
Description:
${(options.description ?? 'No description provided.').slice(0, 3500)}`

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: openRouterHeaders(trimmed),
    body: JSON.stringify({
      model: options.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a podcast ad-break detector. Reply with JSON only.' },
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
