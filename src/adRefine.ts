import { wordsFromCue } from './playerModel'
import type { AdSegment, TranscriptCue, TranscriptWord } from './openRouter'

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

function joinWords(words: TranscriptWord[]): string {
  return words.map((word) => word.text).join(' ')
}

function isReturnToShow(text: string): boolean {
  return AD_END_PATTERN.test(text) && !AD_PATTERN.test(text)
}

function sentencesFromWords(words: TranscriptWord[]): TranscriptWord[][] {
  const sentences: TranscriptWord[][] = []
  let bucket: TranscriptWord[] = []
  const flush = () => {
    if (!bucket.length) return
    sentences.push(bucket)
    bucket = []
  }
  for (const word of words) {
    bucket.push(word)
    if (/[.!?]"?$/.test(word.text)) flush()
  }
  flush()
  return sentences
}

function sentenceClock(sentence: TranscriptWord[]): { text: string; start: number; end: number } {
  return {
    text: joinWords(sentence),
    start: sentence[0].start,
    end: sentence[sentence.length - 1].end,
  }
}

function firstCommercialStart(words: TranscriptWord[]): number | null {
  const sentences = sentencesFromWords(words)
  if (sentences.length > 1) {
    const index = sentences.findIndex((sentence) => {
      const text = joinWords(sentence)
      return cueLooksLikeAd(text) && !isReturnToShow(text)
    })
    if (index > 0) return sentences[index][0].start
    return null
  }
  for (let index = 0; index < words.length; index += 1) {
    const window = joinWords(words.slice(index, index + 8))
    if (isReturnToShow(window)) continue
    if (cueLooksLikeAd(window)) return index > 0 ? words[index].start : null
  }
  return null
}

function lastCommercialEnd(words: TranscriptWord[]): number | null {
  const sentences = sentencesFromWords(words)
  if (sentences.length > 1) {
    let cut: number | null = null
    let seenAd = false
    for (const sentence of sentences) {
      const clock = sentenceClock(sentence)
      if (isReturnToShow(clock.text) || (seenAd && !cueLooksLikeAd(clock.text))) {
        return cut ?? clock.start
      }
      if (cueLooksLikeAd(clock.text)) {
        seenAd = true
        cut = clock.end
      }
    }
    return null
  }
  for (let index = 0; index < words.length; index += 1) {
    const window = joinWords(words.slice(index, Math.min(words.length, index + 8)))
    if (isReturnToShow(window)) return index === 0 ? words[0].start : words[index - 1].end
  }
  return null
}

/**
 * Skip and caption labels share this clock. Cue-level ranges swallow the
 * show copy that starts in the same Whisper/Qwen segment as the last ad line.
 */
export function trimAdSegmentToWords(segment: AdSegment, cues: TranscriptCue[]): AdSegment {
  const overlapping = cues.filter((cue) => cue.start < segment.end && cue.end > segment.start)
  if (!overlapping.length) return segment

  const first = overlapping[0]
  const last = overlapping[overlapping.length - 1]
  const startWords = wordsFromCue(first)
  const endWords = first === last ? startWords : wordsFromCue(last)
  let start = segment.start
  let end = segment.end

  const commercialStart = startWords.length ? firstCommercialStart(startWords) : null
  if (commercialStart != null) start = Math.max(start, commercialStart)
  const commercialEnd = endWords.length ? lastCommercialEnd(endWords) : null
  if (commercialEnd != null && commercialEnd < last.end - 0.05) end = Math.min(end, commercialEnd)

  if (!(end > start + 1.5)) return segment
  return { ...segment, start, end }
}

export function playbackAdSegments(ads: AdSegment[], cues: TranscriptCue[]): AdSegment[] {
  if (!ads.length) return []
  if (!cues.length) return ads
  return ads.map((ad) => trimAdSegmentToWords(ad, cues))
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

  return refined.map((segment) => trimAdSegmentToWords(segment, cues))
}
