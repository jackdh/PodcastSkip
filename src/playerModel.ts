import type { AdSegment, TranscriptCue } from './openRouter'
import { coverageEnd, coverageSeconds, mergeRanges, rangesFromCues, type TimeRange } from './scanCache'

export type ScrubberKind = 'content' | 'ad' | 'unscanned'

export type ScrubberSegment = {
  start: number
  end: number
  kind: ScrubberKind
  label?: string
}

export const SLEEP_TIMER_MINUTES = [15, 30, 45, 60] as const
export type SleepMinutes = (typeof SLEEP_TIMER_MINUTES)[number]

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const secs = total % 60
  return `${minutes}:${secs.toString().padStart(2, '0')}`
}

export function formatRemaining(currentTime: number, duration: number): string {
  if (!Number.isFinite(duration) || duration <= 0) return '0:00'
  const elapsed = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0
  return `-${formatTime(Math.max(0, duration - elapsed))}`
}

/** Last cue whose start is at or before `time`. Gaps keep the previous line current. */
export function activeCueIndex(cues: TranscriptCue[], time: number): number {
  if (!cues.length || !Number.isFinite(time)) return -1
  let index = -1
  for (let i = 0; i < cues.length; i += 1) {
    if (cues[i].start <= time) index = i
    else break
  }
  return index
}

export function transcriptCoverageEnd(cues: TranscriptCue[]): number {
  if (!cues.length) return 0
  return cues.reduce((max, cue) => Math.max(max, cue.end), 0)
}

export function isPlayheadPastTranscript(cues: TranscriptCue[], time: number, slack = 2): boolean {
  if (!cues.length || !Number.isFinite(time)) return false
  return time > transcriptCoverageEnd(cues) + slack
}

export function analysisWindowEnd(analyseMinutes: number, duration: number): number {
  if (!(analyseMinutes > 0)) return duration > 0 ? duration : 0
  const windowEnd = analyseMinutes * 60
  return duration > 0 ? Math.min(windowEnd, duration) : windowEnd
}

export function needsFullEpisodeScan(
  cues: TranscriptCue[],
  _analyseMinutes: number,
  duration: number,
  scannedRanges?: TimeRange[] | null,
): boolean {
  if (!(duration > 15)) return false
  const covered = scannedRanges?.length ? coverageEnd(scannedRanges) : (cues.length ? transcriptCoverageEnd(cues) : 0)
  if (covered <= 0) return false
  return covered < duration - 15
}

export function scanCoverageLabel(ranges: TimeRange[], duration: number): string | null {
  const scanned = coverageSeconds(ranges)
  if (scanned < 1) return null
  if (duration > 0 && scanned >= duration - 15) return null
  return `${formatTime(scanned)} scanned`
}

export function wordsFromCue(cue: TranscriptCue) {
  const tokens = cue.text.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  const duration = Math.max(0.05, cue.end - cue.start)
  return tokens.map((text, index) => {
    const start = cue.start + (index / tokens.length) * duration
    const end = cue.start + ((index + 1) / tokens.length) * duration
    return { text, start, end }
  })
}

export function cueOverlapsAd(cue: TranscriptCue, ads: AdSegment[]): AdSegment | undefined {
  return ads.find((segment) => cue.start < segment.end && cue.end > segment.start)
}

export function mergeAdSegments(ads: AdSegment[]): AdSegment[] {
  const sorted = ads
    .filter((ad) => Number.isFinite(ad.start) && Number.isFinite(ad.end) && ad.end > ad.start)
    .map((ad) => ({ ...ad }))
    .sort((a, b) => a.start - b.start)

  const merged: AdSegment[] = []
  for (const ad of sorted) {
    const last = merged[merged.length - 1]
    if (last && ad.start <= last.end + 0.35) {
      last.end = Math.max(last.end, ad.end)
      if (ad.label && !last.label) last.label = ad.label
    } else {
      merged.push(ad)
    }
  }
  return merged
}

function splitByCoverage(start: number, end: number, scanned: TimeRange[]): Array<{ start: number; end: number; scanned: boolean }> {
  if (end - start <= 0.05) return []
  const blocks = mergeRanges(scanned)
  if (!blocks.length) return [{ start, end, scanned: false }]

  const parts: Array<{ start: number; end: number; scanned: boolean }> = []
  let cursor = start
  for (const block of blocks) {
    if (block.end <= cursor) continue
    if (block.start >= end) break
    if (block.start > cursor + 0.05) parts.push({ start: cursor, end: Math.min(block.start, end), scanned: false })
    const coveredStart = Math.max(cursor, block.start)
    const coveredEnd = Math.min(end, block.end)
    if (coveredEnd > coveredStart + 0.05) parts.push({ start: coveredStart, end: coveredEnd, scanned: true })
    cursor = Math.max(cursor, coveredEnd)
    if (cursor >= end) break
  }
  if (cursor < end - 0.05) parts.push({ start: cursor, end, scanned: false })
  return parts
}

function contentSegment(start: number, end: number, kind: ScrubberKind = 'content'): ScrubberSegment | null {
  if (end - start <= 0.05) return null
  return { start, end, kind }
}

/** Chapter-style gaps: ads, scanned content, and dim unscanned audio. */
export function buildScrubberSegments(
  duration: number,
  adSegments: AdSegment[],
  scannedRanges?: TimeRange[] | null,
): ScrubberSegment[] {
  const track = duration > 0 && Number.isFinite(duration) ? duration : 1
  const ads = mergeAdSegments(adSegments)
    .map((ad) => ({
      ...ad,
      start: Math.max(0, Math.min(ad.start, track)),
      end: Math.max(0, Math.min(ad.end, track)),
    }))
    .filter((ad) => ad.end - ad.start >= 0.05)

  const scanned = scannedRanges ? mergeRanges(scannedRanges) : null
  const segments: ScrubberSegment[] = []
  let cursor = 0
  for (const ad of ads) {
    if (ad.start > cursor + 0.05) {
      if (scanned) {
        for (const part of splitByCoverage(cursor, ad.start, scanned)) {
          const piece = contentSegment(part.start, part.end, part.scanned ? 'content' : 'unscanned')
          if (piece) segments.push(piece)
        }
      } else {
        const before = contentSegment(cursor, ad.start)
        if (before) segments.push(before)
      }
    }
    const adStart = Math.max(cursor, ad.start)
    if (ad.end > adStart + 0.05) {
      segments.push({ start: adStart, end: ad.end, kind: 'ad', label: ad.label })
      cursor = ad.end
    }
  }
  if (cursor < track - 0.05) {
    if (scanned) {
      for (const part of splitByCoverage(cursor, track, scanned)) {
        const piece = contentSegment(part.start, part.end, part.scanned ? 'content' : 'unscanned')
        if (piece) segments.push(piece)
      }
    } else {
      const after = contentSegment(cursor, track)
      if (after) segments.push(after)
    }
  }
  if (!segments.length) {
    segments.push({ start: 0, end: track, kind: scanned && !scanned.length ? 'unscanned' : 'content' })
  }
  return segments
}

export function scannedRangesForEpisode(cues: TranscriptCue[], ranges?: TimeRange[] | null): TimeRange[] {
  if (ranges?.length) return mergeRanges(ranges)
  return rangesFromCues(cues)
}

export function segmentPlayedFraction(segment: ScrubberSegment, currentTime: number): number {
  if (!Number.isFinite(currentTime) || currentTime <= segment.start) return 0
  if (currentTime >= segment.end) return 1
  const span = segment.end - segment.start
  return span > 0 ? (currentTime - segment.start) / span : 0
}

export function nextSleepMinutes(current: number | null): number | null {
  if (current == null) return SLEEP_TIMER_MINUTES[0]
  const index = SLEEP_TIMER_MINUTES.indexOf(current as SleepMinutes)
  if (index < 0 || index >= SLEEP_TIMER_MINUTES.length - 1) return null
  return SLEEP_TIMER_MINUTES[index + 1]
}
