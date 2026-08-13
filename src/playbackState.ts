import type { Episode } from './podcastApi'
import { readJson, writeJson } from './storage'

const NOW_PLAYING_KEY = 'podflow-now-playing'
const FINISHED_SLACK = 5

export type NowPlayingState = {
  version: 1
  episode: Episode
  position: number
  updatedAt: number
  finished?: boolean
}

/** Start over when the last session ended (or was within a few seconds of the end). */
export function resumePosition(position: number, duration: number): number {
  if (!Number.isFinite(position) || position <= 0) return 0
  if (!Number.isFinite(duration) || duration <= 0) return position
  if (position >= duration - FINISHED_SLACK) return 0
  return position
}

export function readNowPlaying(): NowPlayingState | null {
  const parsed = readJson<NowPlayingState | null>(NOW_PLAYING_KEY, null)
  if (!parsed || typeof parsed !== 'object' || !parsed.episode?.audioUrl) return null
  const position = Number(parsed.position)
  return {
    version: 1,
    episode: parsed.episode,
    position: Number.isFinite(position) ? position : 0,
    updatedAt: Number(parsed.updatedAt) || Date.now(),
    finished: Boolean(parsed.finished),
  }
}

export function writeNowPlaying(episode: Episode, position: number, finished = false) {
  writeJson(NOW_PLAYING_KEY, {
    version: 1,
    episode,
    position: Number.isFinite(position) ? Math.max(0, position) : 0,
    updatedAt: Date.now(),
    finished,
  } satisfies NowPlayingState)
}

export function playbackErrorMessage(kind: 'cached' | 'stream') {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return kind === 'cached'
      ? 'This download could not be played. Try removing it and downloading again.'
      : 'You are offline. Download an episode first to listen without a connection.'
  }
  return kind === 'cached'
    ? 'This download could not be played. Try downloading the episode again.'
    : 'This episode could not be streamed. Download it to listen on this device.'
}
