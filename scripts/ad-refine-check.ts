import { coerceMinuteClocks, refineAdSegments } from '../src/adRefine.ts'
import type { AdSegment, TranscriptCue } from '../src/openRouter.ts'

function assertRange(label: string, start: number, end: number, expectedStart: number, expectedEnd: number, slack = 1) {
  if (Math.abs(start - expectedStart) > slack || Math.abs(end - expectedEnd) > slack) {
    throw new Error(`${label}: expected ${expectedStart}-${expectedEnd}, got ${start}-${end}`)
  }
}

const helioCues: TranscriptCue[] = [
  { start: 18 * 60 + 40, end: 18 * 60 + 55, text: 'So the data actually shows a more complicated picture than the headlines.' },
  { start: 19 * 60 + 5, end: 19 * 60 + 20, text: 'This episode is brought to you by our sponsor, Helio Climate.' },
  { start: 19 * 60 + 20, end: 19 * 60 + 50, text: 'Visit helioclimate.com and use code TINKER for a free trial. Terms apply.' },
  { start: 19 * 60 + 50, end: 20 * 60 + 32, text: 'Support for this show comes from Helio. Visit helioclimate.com today.' },
  { start: 20 * 60 + 32, end: 20 * 60 + 45, text: "Welcome back. Let's pick up with Scott on the ice core record." },
  { start: 20 * 60 + 45, end: 21 * 60 + 10, text: 'The ice cores in Greenland go back more than a hundred thousand years.' },
  { start: 21 * 60 + 10, end: 21 * 60 + 30, text: 'And that is what the data actually shows.' },
]

const helioPredicted: AdSegment[] = [{ start: 20 * 60, end: 21 * 60 + 30, label: 'mid roll' }]
const helio = refineAdSegments(helioPredicted, helioCues)
assertRange('helio 20:00–21:30', helio[0].start, helio[0].end, 19 * 60 + 5, 20 * 60 + 32)

const minutes = coerceMinuteClocks(20, 21.5, 81 * 60)
if (minutes.start !== 20 * 60 || minutes.end !== 21 * 60 + 30) {
  throw new Error(`coerceMinuteClocks: expected 1200–1290, got ${minutes.start}-${minutes.end}`)
}
const fromMinutes = refineAdSegments([{ start: minutes.start, end: minutes.end, label: 'mid roll' }], helioCues)
assertRange('minutes 20–21.5', fromMinutes[0].start, fromMinutes[0].end, 19 * 60 + 5, 20 * 60 + 32)

const alreadySeconds = coerceMinuteClocks(1200, 1290, 81 * 60)
if (alreadySeconds.start !== 1200 || alreadySeconds.end !== 1290) {
  throw new Error('coerceMinuteClocks should leave 20:00–21:30 seconds unchanged')
}

const quoCues: TranscriptCue[] = [
  { start: 19 * 60 + 46, end: 19 * 60 + 53, text: 'state of energy poverty today, from nothing to not reliable and not affordable to them.' },
  { start: 19 * 60 + 53, end: 19 * 60 + 54, text: 'Seven billion people.' },
  { start: 19 * 60 + 54, end: 20 * 60, text: 'A missed call costs you more than just a call. It costs you the company, the referral,' },
  { start: 20 * 60, end: 20 * 60 + 5, text: "and the reputation. The businesses that grow fastest aren't necessarily the best." },
  { start: 20 * 60 + 5, end: 20 * 60 + 9, text: "They're often the most reachable. Today's episode is brought to you by Quo," },
  { start: 20 * 60 + 9, end: 20 * 60 + 13, text: 'Q-U-O, the smarter way to run your business communications.' },
  { start: 20 * 60 + 13, end: 20 * 60 + 20, text: 'Quo lets you and your entire team share one business number,' },
  { start: 20 * 60 + 20, end: 20 * 60 + 31, text: 'handle calls and texts from a single app. Because everyone can see exactly where things stand.' },
  { start: 20 * 60 + 31, end: 20 * 60 + 41, text: 'You can keep your existing number, and the whole thing runs from wherever you are.' },
  { start: 20 * 60 + 41, end: 20 * 60 + 51, text: "And Quo's AI works in the background, automatically logging calls." },
  { start: 20 * 60 + 51, end: 21 * 60 + 4, text: "I've looked at what Quo does and it's genuinely the kind of system I'd want in place." },
  { start: 21 * 60 + 4, end: 21 * 60 + 19, text: "Try Quo for free and get 20% off your first six months when you go to Quo.com slash Trigg." },
  { start: 21 * 60 + 19, end: 21 * 60 + 24, text: 'Quo. No missed calls, no missed customers.' },
  { start: 21 * 60 + 24, end: 21 * 60 + 31, text: "We've touched on it a little bit about the green movement and virtue signaling." },
  { start: 21 * 60 + 31, end: 21 * 60 + 39, text: "What do you think of Britain's net zero policy?" },
]

const quoShort = refineAdSegments([{ start: 20 * 60 + 5, end: 20 * 60 + 9, label: 'sponsor reads' }], quoCues)
assertRange('quo short 20:05–20:09', quoShort[0].start, quoShort[0].end, 19 * 60 + 54, 21 * 60 + 24)

const quoRound = refineAdSegments([{ start: 20 * 60, end: 21 * 60 + 30, label: 'mid roll' }], quoCues)
assertRange('quo round 20:00–21:30', quoRound[0].start, quoRound[0].end, 19 * 60 + 54, 21 * 60 + 24)

console.log('adRefine snap: Helio 20:00–21:30 -> 19:05–20:32 OK')
console.log('adRefine snap: Quo 20:05–20:09 -> 19:54–21:24 OK')
