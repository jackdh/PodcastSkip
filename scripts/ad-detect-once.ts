/**
 * One-off real OpenRouter ad-detection run (manual only — not CI).
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-... npm run test:ad-detect -- --query "Up First" --max-minutes 3
 *
 * Writes a JSON report the agent can inspect (cues + ad segments + key usage).
 */
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import {
  checkOpenRouterKey,
  detectAdSegmentsFromSamples,
  excerptAroundSegment,
  formatCredits,
  type AdSegment,
  type TranscriptCue,
} from '../src/openRouter.ts'
import { searchCatalog, type Episode } from '../src/podcastApi.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const SAMPLE_RATE = 16_000
const DEFAULT_MODEL = 'deepseek/deepseek-v4-flash'
const DEFAULT_MAX_MINUTES = 3
const DEFAULT_QUERY = 'NPR Up First'

type Args = {
  query: string
  maxMinutes: number
  startMinutes: number
  model: string
  sttModel: string
  audioUrl?: string
  title?: string
  show?: string
  out: string
  help: boolean
}

function printHelp() {
  console.log(`One-off OpenRouter podcast ad detection (manual; burns credits).

Required env:
  OPENROUTER_API_KEY   OpenRouter key with credits

Options:
  --query <text>         Apple Podcasts search (default: "${DEFAULT_QUERY}")
  --max-minutes <n>      Only analyse N minutes (default: ${DEFAULT_MAX_MINUTES})
  --start-minutes <n>    Skip the first N minutes before analysing (default: 0)
  --model <id>           Analysis model (default: ${DEFAULT_MODEL})
  --stt-model <id>       Speech-to-text model (default: openai/whisper-1)
  --audio-url <url>      Skip search; download this episode URL directly
  --title <text>         Episode title when using --audio-url
  --show <text>          Show name when using --audio-url
  --out <path>           Report JSON path (default: tmp/ad-detect-report.json)
  --help                 Show this help

Example:
  OPENROUTER_API_KEY=sk-or-... npm run test:ad-detect -- --query "The Daily" --max-minutes 2
`)
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    query: DEFAULT_QUERY,
    maxMinutes: DEFAULT_MAX_MINUTES,
    startMinutes: 0,
    model: DEFAULT_MODEL,
    sttModel: 'openai/whisper-1',
    out: join(root, 'tmp', 'ad-detect-report.json'),
    help: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const next = argv[i + 1]
    if (flag === '--help' || flag === '-h') {
      args.help = true
    } else if (flag === '--query' && next) {
      args.query = next
      i += 1
    } else if (flag === '--max-minutes' && next) {
      args.maxMinutes = Number(next)
      i += 1
    } else if (flag === '--start-minutes' && next) {
      args.startMinutes = Number(next)
      i += 1
    } else if (flag === '--model' && next) {
      args.model = next
      i += 1
    } else if (flag === '--stt-model' && next) {
      args.sttModel = next
      i += 1
    } else if (flag === '--audio-url' && next) {
      args.audioUrl = next
      i += 1
    } else if (flag === '--title' && next) {
      args.title = next
      i += 1
    } else if (flag === '--show' && next) {
      args.show = next
      i += 1
    } else if (flag === '--out' && next) {
      args.out = resolve(next)
      i += 1
    } else {
      throw new Error(`Unknown or incomplete argument: ${flag}`)
    }
  }

  if (!Number.isFinite(args.maxMinutes) || args.maxMinutes <= 0) {
    throw new Error('--max-minutes must be a positive number')
  }
  if (!Number.isFinite(args.startMinutes) || args.startMinutes < 0) {
    throw new Error('--start-minutes must be zero or a positive number')
  }
  return args
}

async function loadDotEnvLocal() {
  for (const name of ['.env.local', '.env']) {
    try {
      const text = await readFile(join(root, name), 'utf8')
      for (const line of text.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq <= 0) continue
        const key = trimmed.slice(0, eq).trim()
        let value = trimmed.slice(eq + 1).trim()
        if (
          (value.startsWith('"') && value.endsWith('"'))
          || (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1)
        }
        if (!(key in process.env)) process.env[key] = value
      }
    } catch {
      // optional
    }
  }
}

async function downloadFile(url: string, destination: string) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'PodflowAdDetectHarness/0.1' },
    redirect: 'follow',
  })
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) for ${url}`)
  }
  await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(destination))
}

async function decodeToMono16k(inputPath: string): Promise<Float32Array> {
  const chunks: Buffer[] = []
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-ac',
      '1',
      '-ar',
      String(SAMPLE_RATE),
      '-f',
      'f32le',
      'pipe:1',
    ], { stdio: ['ignore', 'pipe', 'inherit'] })
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolvePromise()
      else reject(new Error(`ffmpeg decode failed (exit ${code})`))
    })
  })
  const buffer = Buffer.concat(chunks)
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4)
}

function formatClock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function pickEpisode(episodes: Episode[], query: string): Episode {
  const withAudio = episodes.filter((episode) => episode.audioUrl)
  if (!withAudio.length) throw new Error('No searchable episodes with audio URLs were found.')
  const tokens = query.toLowerCase().split(/\s+/).filter((token) => token.length > 3)
  const scored = [...withAudio].sort((a, b) => {
    const score = (episode: Episode) => {
      const hay = `${episode.title} ${episode.show}`.toLowerCase()
      return tokens.reduce((total, token) => total + (hay.includes(token) ? 1 : 0), 0)
    }
    const byTitle = score(b) - score(a)
    if (byTitle !== 0) return byTitle
    const aMinutes = Number((a.duration.match(/(\d+)\s*m/) ?? [])[1] ?? 999)
    const bMinutes = Number((b.duration.match(/(\d+)\s*m/) ?? [])[1] ?? 999)
    return aMinutes - bMinutes
  })
  return scored[0]
}

function summarizeCues(cues: TranscriptCue[]) {
  return cues.map((cue) => ({
    start: Number(cue.start.toFixed(2)),
    end: Number(cue.end.toFixed(2)),
    clock: `${formatClock(cue.start)}–${formatClock(cue.end)}`,
    text: cue.text,
  }))
}

function summarizeSegments(segments: AdSegment[], cues: TranscriptCue[]) {
  return segments.map((segment) => {
    const excerpt = excerptAroundSegment(cues, segment.start, segment.end)
    return {
      ...segment,
      clock: `${formatClock(segment.start)}–${formatClock(segment.end)}`,
      durationSeconds: Number((segment.end - segment.start).toFixed(1)),
      excerpt: {
        before: summarizeCues(excerpt.before),
        during: summarizeCues(excerpt.during),
        after: summarizeCues(excerpt.after),
      },
    }
  })
}

async function main() {
  await loadDotEnvLocal()
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const apiKey = process.env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) {
    printHelp()
    throw new Error('Set OPENROUTER_API_KEY (env secret or .env.local) before running.')
  }

  console.log('Checking OpenRouter key…')
  const keyBefore = await checkOpenRouterKey(apiKey)
  console.log(`Key OK · ${keyBefore.label} · ${formatCredits(keyBefore.limitRemaining)}`)

  let episode: Episode
  if (args.audioUrl) {
    episode = {
      id: 'manual',
      showId: 0,
      show: args.show ?? 'Manual show',
      author: 'Unknown',
      title: args.title ?? 'Manual episode',
      date: 'Manual',
      duration: `${args.maxMinutes}m`,
      audioUrl: args.audioUrl,
      description: '',
    }
  } else {
    console.log(`Searching Apple Podcasts for “${args.query}”…`)
    const catalog = await searchCatalog(args.query)
    episode = pickEpisode(catalog.episodes, args.query)
  }

  if (!episode.audioUrl) throw new Error('Selected episode has no audio URL.')
  console.log(`Episode: ${episode.show} — ${episode.title} (${episode.duration})`)
  console.log(`Audio: ${episode.audioUrl}`)
  console.log(`STT: ${args.sttModel} · analysis: ${args.model}`)
  console.log(`Analysing ${args.startMinutes > 0 ? `minutes ${args.startMinutes}–${args.startMinutes + args.maxMinutes}` : `first ${args.maxMinutes} minute(s)`} to limit credit use.`)

  const workDir = await mkdtemp(join(tmpdir(), 'podflow-ad-detect-'))
  const audioPath = join(workDir, 'episode.bin')
  try {
    console.log('Downloading episode audio…')
    await downloadFile(episode.audioUrl, audioPath)

    console.log('Decoding to 16 kHz mono with ffmpeg…')
    const samples = await decodeToMono16k(audioPath)
    const fullDurationSeconds = samples.length / SAMPLE_RATE
    console.log(`Decoded ${fullDurationSeconds.toFixed(1)}s; analysing a ${args.maxMinutes}m window${args.startMinutes ? ` starting at ${args.startMinutes}m` : ''}.`)

    const { segments, cues, durationSeconds } = await detectAdSegmentsFromSamples({
      apiKey,
      model: args.model,
      sttModel: args.sttModel,
      title: episode.title,
      show: episode.show,
      description: episode.description,
      samples,
      maxMinutes: args.maxMinutes,
      startMinutes: args.startMinutes || undefined,
      onProgress: (message) => console.log(message),
    })

    const keyAfter = await checkOpenRouterKey(apiKey).catch(() => null)
    const report = {
      ranAt: new Date().toISOString(),
      query: args.audioUrl ? null : args.query,
      maxMinutes: args.maxMinutes,
      startMinutes: args.startMinutes,
      model: args.model,
      sttModel: args.sttModel,
      episode: {
        id: episode.id,
        show: episode.show,
        title: episode.title,
        durationLabel: episode.duration,
        audioUrl: episode.audioUrl,
        description: episode.description?.slice(0, 500) ?? '',
      },
      analysis: {
        fullDurationSeconds,
        analysedDurationSeconds: durationSeconds,
        cueCount: cues.length,
        segmentCount: segments.length,
        adSeconds: Number(segments.reduce((sum, segment) => sum + (segment.end - segment.start), 0).toFixed(1)),
      },
      key: {
        before: keyBefore,
        after: keyAfter,
      },
      segments: summarizeSegments(segments, cues),
      cues: summarizeCues(cues),
    }

    await mkdir(dirname(args.out), { recursive: true })
    await writeFile(args.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

    // Also drop a copy where cloud walkthroughs commonly look.
    const artifactCopy = join('/opt/cursor/artifacts', 'ad-detect-report.json')
    try {
      await mkdir(dirname(artifactCopy), { recursive: true })
      await writeFile(artifactCopy, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
      console.log(`Artifact copy: ${artifactCopy}`)
    } catch {
      // local machines may not have this path
    }

    console.log('\n=== Ad detection result ===')
    console.log(`Cues: ${cues.length}`)
    console.log(`Ad segments: ${segments.length}`)
    for (const segment of report.segments) {
      console.log(`- ${segment.clock} (${segment.durationSeconds}s)${segment.label ? ` · ${segment.label}` : ''}`)
      const during = segment.excerpt.during.map((cue) => cue.text.trim()).join(' ')
      if (during) console.log(`  during: ${during.slice(0, 220)}${during.length > 220 ? '…' : ''}`)
      const after = segment.excerpt.after[0]
      if (after) console.log(`  next: ${after.clock} ${after.text.trim().slice(0, 120)}`)
    }
    if (!segments.length) console.log('- (none found in analysed window)')
    console.log(`Report: ${args.out}`)
    if (keyAfter) console.log(`Key after: ${formatCredits(keyAfter.limitRemaining)}`)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
