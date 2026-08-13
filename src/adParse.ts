import { cueLooksLikeAd } from './adRefine'
import type { AdSegment, TranscriptCue } from './openRouter'

export function cueIndexFromRaw(raw: unknown, cueCount: number): number | undefined {
  let value: unknown = raw
  if (typeof value === 'string') {
    const match = value.trim().match(/^#?\s*(\d+)\s*$/)
    if (match) value = Number(match[1])
  }
  const numeric = Number(value)
  if (!Number.isInteger(numeric)) return undefined
  // Prompt uses 1-based #ids. Accept 0-based only when the value cannot be 1-based.
  if (numeric >= 1 && numeric <= cueCount) return numeric - 1
  if (numeric === 0) return 0
  return undefined
}

export function parseTimeField(raw: unknown): number {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    const clock = trimmed.match(/^(\d+):([0-5]?\d)(?:\.\d+)?$/)
    if (clock) return Number(clock[1]) * 60 + Number(clock[2])
    const cueLike = trimmed.match(/^#?\s*(\d+)\s*$/)
    if (cueLike) return Number(cueLike[1])
  }
  return Number(raw)
}

function segmentFromCueRange(
  startIndex: number,
  endIndex: number,
  cues: TranscriptCue[],
  label?: string,
): AdSegment | null {
  if (startIndex < 0 || endIndex < startIndex || endIndex >= cues.length) return null
  const start = cues[startIndex].start
  const end = cues[endIndex].end
  if (!(end > start)) return null
  return { start, end, label }
}

function clampSegment(segment: AdSegment, durationSeconds: number): AdSegment | null {
  const duration = durationSeconds > 0 ? durationSeconds : segment.end
  const start = Math.max(0, Math.min(segment.start, duration))
  const end = Math.max(start + 1, Math.min(segment.end, duration))
  if (end - start < 2) return null
  return { start, end, label: segment.label }
}

function scoreRange(start: number, end: number, cues: TranscriptCue[]): number {
  const span = end - start
  if (!(span >= 2) || !Number.isFinite(span)) return Number.NEGATIVE_INFINITY
  let adHits = 0
  let overlap = 0
  for (const cue of cues) {
    const hit = Math.max(0, Math.min(end, cue.end) - Math.max(start, cue.start))
    if (hit <= 0) continue
    overlap += hit
    if (cueLooksLikeAd(cue.text)) adHits += 1
  }
  return adHits * 1000 + Math.min(span, 240) + overlap * 0.05
}

function consider(candidates: AdSegment[], segment: AdSegment | null) {
  if (segment && segment.end - segment.start >= 2) candidates.push(segment)
}

function pickBestSegment(candidates: AdSegment[], cues: TranscriptCue[], durationSeconds: number): AdSegment | null {
  let best: AdSegment | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const candidate of candidates) {
    const clamped = clampSegment(candidate, durationSeconds)
    if (!clamped) continue
    const score = scoreRange(clamped.start, clamped.end, cues)
    if (score > bestScore) {
      best = clamped
      bestScore = score
    }
  }
  return best
}

function recordLabel(record: Record<string, unknown>): string | undefined {
  if (typeof record.label === 'string') return record.label
  if (typeof record.type === 'string') return record.type
  if (typeof record.sponsor === 'string') return record.sponsor
  return undefined
}

export function findSegmentList(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>
  for (const key of ['segments', 'ads', 'ad_segments', 'advertisements', 'adBreaks', 'ad_breaks']) {
    if (Array.isArray(record[key])) return record[key] as unknown[]
  }
  for (const value of Object.values(record)) {
    if (!value || typeof value !== 'object') continue
    const nested = findSegmentList(value)
    if (nested) return nested
  }
  return null
}

function candidatesFromRecord(
  record: Record<string, unknown>,
  durationSeconds: number,
  cues: TranscriptCue[],
): AdSegment[] {
  const label = recordLabel(record)
  const candidates: AdSegment[] = []
  const startCue = cueIndexFromRaw(
    record.startCue ?? record.start_cue ?? record.fromCue ?? record.from_cue,
    cues.length,
  )
  const endCue = cueIndexFromRaw(
    record.endCue ?? record.end_cue ?? record.toCue ?? record.to_cue,
    cues.length,
  )
  if (startCue !== undefined && endCue !== undefined) {
    consider(candidates, segmentFromCueRange(startCue, endCue, cues, label))
  }

  const rawStart = record.start ?? record.startSeconds ?? record.start_time ?? record.startTime ?? record.from
  const rawEnd = record.end ?? record.endSeconds ?? record.end_time ?? record.endTime ?? record.to
  const startAsCue = cueIndexFromRaw(rawStart, cues.length)
  const endAsCue = cueIndexFromRaw(rawEnd, cues.length)
  if (startAsCue !== undefined && endAsCue !== undefined) {
    consider(candidates, segmentFromCueRange(startAsCue, endAsCue, cues, label))
  }

  const startSeconds = parseTimeField(rawStart)
  const endSeconds = parseTimeField(rawEnd)
  if (Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && endSeconds > startSeconds) {
    consider(candidates, { start: startSeconds, end: endSeconds, label })
    const minuteSpan = endSeconds - startSeconds
    if (endSeconds <= 180 && minuteSpan <= 30 && startSeconds * 60 < (durationSeconds || startSeconds * 60) + 5) {
      consider(candidates, { start: startSeconds * 60, end: endSeconds * 60, label })
    }
  }

  if (Array.isArray(record.cues) && record.cues.length >= 2) {
    const first = cueIndexFromRaw(record.cues[0], cues.length)
    const last = cueIndexFromRaw(record.cues[record.cues.length - 1], cues.length)
    if (first !== undefined && last !== undefined) {
      consider(candidates, segmentFromCueRange(first, last, cues, label))
    }
  }

  return candidates
}

export function mergeOverlappingSegments(segments: AdSegment[]): AdSegment[] {
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

/** Turn a DeepSeek/OpenRouter JSON payload into skippable audio ranges. */
export function normalizeSegments(raw: unknown, durationSeconds: number, cues: TranscriptCue[] = []): AdSegment[] {
  const list = findSegmentList(raw)
  if (!list) throw new Error('Model response was missing ad segments.')

  const segments: AdSegment[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const picked = pickBestSegment(
      candidatesFromRecord(item as Record<string, unknown>, durationSeconds, cues),
      cues,
      durationSeconds,
    )
    if (picked) segments.push(picked)
  }
  return mergeOverlappingSegments(segments.sort((a, b) => a.start - b.start))
}

/** If playback is in (or just entering) an ad, return the time to jump to. */
export function adSkipTarget(time: number, segments: AdSegment[], lead = 0.2): number | null {
  if (!Number.isFinite(time) || !segments.length) return null
  const hit = segments.find((segment) => (
    segment.end - segment.start >= 2
    && time >= segment.start - lead
    && time < segment.end - 0.35
  ))
  return hit ? hit.end : null
}
