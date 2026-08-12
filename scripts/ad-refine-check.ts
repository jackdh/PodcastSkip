import { coerceMinuteClocks, refineAdSegments } from '../src/adRefine.ts'
import type { AdSegment, TranscriptCue } from '../src/openRouter.ts'

const cues: TranscriptCue[] = [
  { start: 18 * 60 + 40, end: 18 * 60 + 55, text: 'So the data actually shows a more complicated picture than the headlines.' },
  { start: 19 * 60 + 5, end: 19 * 60 + 20, text: 'This episode is brought to you by our sponsor, Helio Climate.' },
  { start: 19 * 60 + 20, end: 19 * 60 + 50, text: 'Visit helioclimate.com and use code TINKER for a free trial. Terms apply.' },
  { start: 19 * 60 + 50, end: 20 * 60 + 32, text: 'Support for this show comes from Helio. Visit helioclimate.com today.' },
  { start: 20 * 60 + 32, end: 20 * 60 + 45, text: "Welcome back. Let's pick up with Scott on the ice core record." },
  { start: 20 * 60 + 45, end: 21 * 60 + 10, text: 'The ice cores in Greenland go back more than a hundred thousand years.' },
  { start: 21 * 60 + 10, end: 21 * 60 + 30, text: 'And that is what the data actually shows.' },
]

function assertClock(label: string, start: number, end: number, expectedStart: number, expectedEnd: number) {
  if (Math.abs(start - expectedStart) > 0.5 || Math.abs(end - expectedEnd) > 0.5) {
    throw new Error(`${label}: expected 19:05–20:32, got ${start}-${end}`)
  }
}

const predicted: AdSegment[] = [{ start: 20 * 60, end: 21 * 60 + 30, label: 'mid roll' }]
const refined = refineAdSegments(predicted, cues)
assertClock('seconds 20:00–21:30', refined[0].start, refined[0].end, 19 * 60 + 5, 20 * 60 + 32)

const minutes = coerceMinuteClocks(20, 21.5, 81 * 60)
if (minutes.start !== 20 * 60 || minutes.end !== 21 * 60 + 30) {
  throw new Error(`coerceMinuteClocks: expected 1200–1290, got ${minutes.start}-${minutes.end}`)
}
const fromMinutes = refineAdSegments([{ start: minutes.start, end: minutes.end, label: 'mid roll' }], cues)
assertClock('minutes 20–21.5', fromMinutes[0].start, fromMinutes[0].end, 19 * 60 + 5, 20 * 60 + 32)

const alreadySeconds = coerceMinuteClocks(1200, 1290, 81 * 60)
if (alreadySeconds.start !== 1200 || alreadySeconds.end !== 1290) {
  throw new Error('coerceMinuteClocks should leave 20:00–21:30 seconds unchanged')
}

console.log('adRefine snap: 20:00–21:30 -> 19:05–20:32 OK')
