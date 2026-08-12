import type { AdSegment, TranscriptCue } from './openRouter'

const AD_PATTERN = /this message comes from|brought to you by|paid (?:partner|for by)|our sponsor|today'?s sponsor|episode is sponsored|mid-?roll|ad break|commercial break|promo code|discount code|use (?:the )?code |\d+%\s*off|try \w+ for free|(?:visit|go to)\s+[\w.-]+\.(?:com|org|net|io)\b|[\w-]+\.(?:com|org|net|io)(?:\/\S+)?|free trial|terms(?: and conditions)? apply|our (?:friends|partner)s? at\b|support (?:for )?this (?:show|episode) comes from|this show is sponsored|i want to tell you about|a word from our|sponsor message|check out .{0,48}\.(?:com|org|net|io)\b|no missed (?:calls|customers)/i

const AD_END_PATTERN = /welcome back|we(?:'| a)?re back|now back to|back to (?:the )?(?:show|conversation|interview)|after the break/i

const COMMERCIAL_VOICE = /\b(?:you|your|business(?:es)?|customers?|team(?:mates)?|calls?|texts?|app|discount|for free|no missed|existing number|after hours)\b/i

export function cueLooksLikeAd(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (AD_END_PATTERN.test(trimmed) && !AD_PATTERN.test(trimmed)) return false
  return AD_PATTERN.test(trimmed)
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

function extractSponsorTokens(text: string): string[] {
  const tokens = new Set<string>()
  for (const match of text.matchAll(/\b[a-z0-9-]+\.(?:com|org|net|io)\b/gi)) {
    tokens.add(match[0].split('.')[0].toLowerCase())
  }
  const by = text.match(/brought to you by\s+([A-Za-z][\w]*)/i)
  if (by) tokens.add(by[1].toLowerCase())
  const spelled = text.match(/\b([A-Z](?:-[A-Z]){1,8})\b/)
  if (spelled) tokens.add(spelled[1].replace(/-/g, '').toLowerCase())
  return [...tokens].filter((token) => token.length >= 3)
}

function cueHasSponsor(text: string, tokens: string[]): boolean {
  const lower = text.toLowerCase()
  return tokens.some((token) => lower.includes(token))
}

function expandCommercialSpan(cues: TranscriptCue[], seeds: TranscriptCue[]): TranscriptCue[] {
  if (!seeds.length || !cues.length) return seeds
  const tokens = seeds.flatMap((seed) => extractSponsorTokens(seed.text))
  const isCommercialSeed = (cue: TranscriptCue) => (
    cueLooksLikeAd(cue.text) || cueHasSponsor(cue.text, tokens)
  )

  const seedIndices = cues.map((cue, index) => (isCommercialSeed(cue) ? index : -1)).filter((index) => index >= 0)
  if (!seedIndices.length) return seeds

  let startIdx = Math.min(...seedIndices)
  let endIdx = Math.max(...seedIndices)
  const firstSeedStart = cues[startIdx].start
  const lastSeedEnd = cues[endIdx].end

  while (startIdx > 0) {
    const prev = cues[startIdx - 1]
    const current = cues[startIdx]
    if (current.start - prev.end > 3) break
    if (firstSeedStart - prev.start > 25) break
    if (AD_END_PATTERN.test(prev.text) && !isCommercialSeed(prev)) break
    if (isCommercialSeed(prev) || COMMERCIAL_VOICE.test(prev.text)) {
      startIdx -= 1
      continue
    }
    break
  }

  while (endIdx + 1 < cues.length) {
    const next = cues[endIdx + 1]
    const current = cues[endIdx]
    if (next.start - current.end > 3) break
    if (next.end - lastSeedEnd > 25) break
    if (AD_END_PATTERN.test(next.text) && !isCommercialSeed(next)) break
    if (isCommercialSeed(next) || COMMERCIAL_VOICE.test(next.text)) {
      endIdx += 1
      continue
    }
    break
  }

  return cues.slice(startIdx, endIdx + 1)
}

/** Snap model ranges onto nearby commercial cues so round clocks (20:00–21:30) become the real read. */
export function refineAdSegments(segments: AdSegment[], cues: TranscriptCue[], padSeconds = 120): AdSegment[] {
  if (!segments.length || !cues.length) return segments
  const refined: AdSegment[] = []

  for (const segment of segments) {
    const windowCues = cues.filter(
      (cue) => cue.start < segment.end + padSeconds && cue.end > segment.start - padSeconds,
    )
    const seeds = windowCues.filter((cue) => cueLooksLikeAd(cue.text))
    const expanded = expandCommercialSpan(windowCues, seeds.length ? seeds : windowCues.filter((cue) => (
      cue.start < segment.end && cue.end > segment.start
    )))
    if (!expanded.length) {
      refined.push(segment)
      continue
    }

    const start = expanded[0].start
    const end = expanded[expanded.length - 1].end
    if (end - start < 8 && segment.end - segment.start >= 20) {
      refined.push(segment)
      continue
    }
    if (end - start < 2) {
      refined.push(segment)
      continue
    }

    const overlap = overlapSeconds(segment.start, segment.end, start, end)
    const nearStart = Math.abs(segment.start - start) <= 20
    const next = { ...segment, start, end }
    if (overlap > 0 && nearStart && segment.start < start) next.start = segment.start
    refined.push(next)
  }

  return refined
}
