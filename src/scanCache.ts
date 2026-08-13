export type TimeRange = { start: number; end: number }

export type CueLike = {
  start: number
  end: number
  text: string
}

const RANGE_JOIN_GAP = 0.75
const DUPLICATE_OVERLAP = 0.55

export function mergeRanges(ranges: TimeRange[], joinGap = RANGE_JOIN_GAP): TimeRange[] {
  const sorted = ranges
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .map((range) => ({ start: range.start, end: range.end }))
    .sort((a, b) => a.start - b.start)

  const merged: TimeRange[] = []
  for (const range of sorted) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end + joinGap) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

export function rangesFromCues(cues: CueLike[]): TimeRange[] {
  if (!cues.length) return []
  const start = cues.reduce((min, cue) => Math.min(min, cue.start), cues[0].start)
  const end = cues.reduce((max, cue) => Math.max(max, cue.end), cues[0].end)
  return [{ start, end }]
}

export function coverageEnd(ranges: TimeRange[]): number {
  if (!ranges.length) return 0
  return ranges.reduce((max, range) => Math.max(max, range.end), 0)
}

export function coverageSeconds(ranges: TimeRange[]): number {
  return mergeRanges(ranges).reduce((total, range) => total + (range.end - range.start), 0)
}

/** How much of `range` sits inside `scanned`. */
export function coveredFraction(range: TimeRange, scanned: TimeRange[]): number {
  const span = range.end - range.start
  if (span <= 0) return 1
  let covered = 0
  for (const block of mergeRanges(scanned)) {
    const start = Math.max(range.start, block.start)
    const end = Math.min(range.end, block.end)
    if (end > start) covered += end - start
  }
  return Math.min(1, covered / span)
}

export function uncoveredChunks(
  windowStart: number,
  windowEnd: number,
  chunkSeconds: number,
  scanned: TimeRange[],
  skipIfCovered = 0.6,
): TimeRange[] {
  if (!(windowEnd > windowStart) || !(chunkSeconds > 0)) return []
  const blocks = mergeRanges(scanned)
  const chunks: TimeRange[] = []
  for (let start = windowStart; start < windowEnd - 0.05; start += chunkSeconds) {
    const chunk = { start, end: Math.min(windowEnd, start + chunkSeconds) }
    if (coveredFraction(chunk, blocks) < skipIfCovered) chunks.push(chunk)
  }
  return chunks
}

export function mergeCues<T extends CueLike>(existing: T[], incoming: T[]): T[] {
  const merged = [...existing]
  for (const cue of incoming) {
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.end <= cue.start) continue
    const span = cue.end - cue.start
    const duplicate = merged.some((other) => {
      const overlap = Math.min(cue.end, other.end) - Math.max(cue.start, other.start)
      return overlap > span * DUPLICATE_OVERLAP
    })
    if (!duplicate) merged.push(cue)
  }
  return merged.sort((a, b) => a.start - b.start || a.end - b.end)
}

export function cuesInRange<T extends CueLike>(cues: T[], start: number, end: number, pad = 0): T[] {
  const from = Math.max(0, start - pad)
  const to = end + pad
  return cues.filter((cue) => cue.start < to && cue.end > from)
}

export async function runPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  if (!items.length) return []
  const limit = Math.max(1, Math.min(concurrency, items.length))
  const results = new Array<R>(items.length)
  let next = 0
  let done = 0

  const run = async () => {
    while (true) {
      const index = next
      next += 1
      if (index >= items.length) return
      results[index] = await worker(items[index], index)
      done += 1
      onProgress?.(done, items.length)
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()))
  return results
}
