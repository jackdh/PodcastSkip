import type { AdSegment, TranscriptCue } from './openRouter'

const AD_PATTERN = /this message comes from|brought to you by|paid (?:partner|for by)|our sponsor|today'?s sponsor|episode is sponsored|mid-?roll|ad break|commercial break|promo code|discount code|use (?:the )?code |visit [^\s,]+\.(?:com|org|net|io)\b|free trial|terms(?: and conditions)? apply|our (?:friends|partner)s? at\b|support (?:for )?this (?:show|episode) comes from|this show is sponsored|i want to tell you about|a word from our|sponsor message|check out .{0,48}\.(?:com|org|net|io)\b/i

const AD_END_PATTERN = /welcome back|we(?:'| a)?re back|now back to|back to (?:the )?(?:show|conversation|interview)|after the break/i

export function cueLooksLikeAd(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (AD_END_PATTERN.test(trimmed) && !AD_PATTERN.test(trimmed)) return false
  return AD_PATTERN.test(trimmed)
}

function clusterAdCues(cues: TranscriptCue[], gapSeconds = 4): TranscriptCue[][] {
  const adCues = cues.filter((cue) => cueLooksLikeAd(cue.text))
  if (!adCues.length) return []
  const clusters: TranscriptCue[][] = [[adCues[0]]]
  for (let i = 1; i < adCues.length; i += 1) {
    const prev = clusters[clusters.length - 1]
    const last = prev[prev.length - 1]
    if (adCues[i].start <= last.end + gapSeconds) prev.push(adCues[i])
    else clusters.push([adCues[i]])
  }
  return clusters
}

function overlapSeconds(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart))
}

/** Models sometimes return 20 / 21.5 meaning 20:00–21:30 instead of cue ids. */
export function coerceMinuteClocks(start: number, end: number, durationSeconds: number): { start: number; end: number } {
  if (
    durationSeconds >= 600
    && start >= 0
    && end > start
    && end <= 180
    && end - start <= 30
  ) {
    return { start: start * 60, end: end * 60 }
  }
  return { start, end }
}

/** Snap model ranges onto nearby commercial cues so round clocks (20:00–21:30) become the real read. */
export function refineAdSegments(segments: AdSegment[], cues: TranscriptCue[], padSeconds = 90): AdSegment[] {
  if (!segments.length || !cues.length) return segments
  const refined: AdSegment[] = []

  for (const segment of segments) {
    const windowCues = cues.filter(
      (cue) => cue.start < segment.end + padSeconds && cue.end > segment.start - padSeconds,
    )
    const clusters = clusterAdCues(windowCues)
    if (!clusters.length) {
      refined.push(segment)
      continue
    }

    let best = clusters[0]
    let bestOverlap = -1
    for (const cluster of clusters) {
      const start = cluster[0].start
      const end = cluster[cluster.length - 1].end
      const overlap = overlapSeconds(segment.start, segment.end, start, end)
      const near = Math.abs(start - segment.start) + Math.abs(end - segment.end)
      const score = overlap > 0 ? overlap + 1000 : -near
      if (score > bestOverlap) {
        bestOverlap = score
        best = cluster
      }
    }

    const start = best[0].start
    const end = best[best.length - 1].end
    if (end - start < 2) {
      refined.push(segment)
      continue
    }
    refined.push({ ...segment, start, end })
  }

  return refined
}
