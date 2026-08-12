import { useEffect, useRef } from 'react'
import {
  ChevronDown, Download, LoaderCircle, Pause, Play,
  RotateCcw, RotateCw, WandSparkles,
} from 'lucide-react'
import type { Episode } from './podcastApi'
import type { AdSegment, TranscriptCue } from './openRouter'

const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2]

type SeekHandler = (time: number, options?: { allowAds?: boolean }) => void

function Cover({ artwork, label, large = false }: { artwork?: string; label: string; large?: boolean }) {
  return (
    <div className={`art lime ${large ? 'large' : ''}`}>
      {artwork ? <img src={artwork} alt="" /> : <><span>{label.slice(0, 2).toUpperCase()}</span><i /></>}
    </div>
  )
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function wordsFromCue(cue: TranscriptCue) {
  const tokens = cue.text.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return []
  const duration = Math.max(0.05, cue.end - cue.start)
  return tokens.map((text, index) => {
    const start = cue.start + (index / tokens.length) * duration
    const end = cue.start + ((index + 1) / tokens.length) * duration
    return { text, start, end }
  })
}

function ProgressTrack({
  currentTime,
  duration,
  fallbackLabel,
  adSegments,
  onSeek,
  showTimes = false,
}: {
  currentTime: number
  duration: number
  fallbackLabel: string
  adSegments: AdSegment[]
  onSeek: SeekHandler
  showTimes?: boolean
}) {
  const trackMax = duration || 1
  return (
    <div className="track">
      {showTimes && <span>{formatTime(currentTime)}</span>}
      <div className="track-rail">
        {duration > 0 && adSegments.map((segment) => {
          const widthPct = Math.max(((segment.end - segment.start) / trackMax) * 100, 1.2)
          return (
            <i
              key={`${segment.start}-${segment.end}`}
              className="ad-marker"
              style={{
                left: `${(segment.start / trackMax) * 100}%`,
                width: `${widthPct}%`,
              }}
              title={segment.label ? `Ad: ${segment.label}` : 'Ad segment'}
            />
          )
        })}
        <i className="progress-fill" style={{ width: `${Math.min(100, (currentTime / trackMax) * 100)}%` }} />
        <input
          aria-label="Playback progress"
          type="range"
          min="0"
          max={trackMax}
          step="0.1"
          value={Math.min(currentTime, trackMax)}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
      </div>
      {showTimes && <span>{duration ? formatTime(duration) : fallbackLabel}</span>}
    </div>
  )
}

function TranscriptFollow({
  cues,
  adSegments,
  currentTime,
  onSeek,
}: {
  cues: TranscriptCue[]
  adSegments: AdSegment[]
  currentTime: number
  onSeek: SeekHandler
}) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const currentRef = useRef<HTMLDivElement | null>(null)
  const userScrollAt = useRef(0)
  const currentIndex = cues.findIndex((cue) => currentTime >= cue.start && currentTime < cue.end)

  useEffect(() => {
    if (currentIndex < 0) return
    if (Date.now() - userScrollAt.current < 2800) return
    currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [currentIndex])

  return (
    <div
      className="transcript-card player-transcript"
      ref={listRef}
      onScroll={() => { userScrollAt.current = Date.now() }}
      onTouchStart={() => { userScrollAt.current = Date.now() }}
    >
      <div className="transcript-list">
        {cues.map((cue, index) => {
          const ad = adSegments.find((segment) => cue.start < segment.end && cue.end > segment.start)
          const current = index === currentIndex
          const words = wordsFromCue(cue)
          return (
            <div
              key={`${cue.start}-${cue.end}-${index}`}
              ref={current ? currentRef : undefined}
              className={`transcript-line ${ad ? 'ad' : ''} ${current ? 'current' : ''}`}
            >
              <time>{formatTime(cue.start)}</time>
              <p>
                {ad && <span className="ad-inline">AD </span>}
                {words.map((word, wordIndex) => {
                  const active = current && currentTime >= word.start && currentTime < word.end
                  return (
                    <button
                      type="button"
                      key={`${word.start}-${wordIndex}`}
                      className={`transcript-word ${active ? 'current' : ''}`}
                      onClick={() => onSeek(word.start, { allowAds: true })}
                    >
                      {word.text}
                    </button>
                  )
                })}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function PlayerBar({
  episode,
  playing,
  onPlay,
  currentTime,
  duration,
  onSeek,
  adSegments,
  cues = [],
  downloaded = false,
  skipAds,
  onSkipAdsChange,
  detecting = false,
  onHighlightAds,
  onDownload,
  downloading = false,
  playbackRate,
  onPlaybackRateChange,
  expanded,
  onExpandedChange,
}: {
  episode: Episode | null
  playing: boolean
  onPlay: () => void
  currentTime: number
  duration: number
  onSeek: SeekHandler
  adSegments: AdSegment[]
  cues?: TranscriptCue[]
  downloaded?: boolean
  skipAds: boolean
  onSkipAdsChange: (value: boolean) => void
  detecting?: boolean
  onHighlightAds?: () => void
  onDownload?: () => void
  downloading?: boolean
  playbackRate: number
  onPlaybackRateChange: (value: number) => void
  expanded: boolean
  onExpandedChange: (value: boolean) => void
}) {
  useEffect(() => {
    if (!expanded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [expanded])

  if (!episode) return null

  const cycleRate = () => {
    const index = PLAYBACK_RATES.indexOf(playbackRate)
    onPlaybackRateChange(PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length])
  }

  const adCaption = adSegments.length
    ? (skipAds
      ? `Red marks ${adSegments.length} ad ${adSegments.length === 1 ? 'break' : 'breaks'} — skipped automatically`
      : `Red marks ${adSegments.length} ad ${adSegments.length === 1 ? 'break' : 'breaks'} — skip is off`)
    : 'Highlight ads to mark breaks on this bar'

  if (!expanded) {
    return (
      <div className="player-bar">
        <div className="player-progress-slim">
          <ProgressTrack
            currentTime={currentTime}
            duration={duration}
            fallbackLabel={episode.duration}
            adSegments={adSegments}
            onSeek={onSeek}
          />
        </div>
        <div className="player-bar-main">
          <button className="now" onClick={() => onExpandedChange(true)} aria-expanded={false} aria-label="Open now playing">
            <Cover artwork={episode.artwork} label={episode.show} />
            <div>
              <b>{episode.title}</b>
              <span>
                {episode.show}
                {adSegments.length ? ` · ${adSegments.length} ads` : ''}
                {skipAds && adSegments.length ? ' · skipping' : ''}
                {downloaded ? ' · Downloaded' : ''}
              </span>
            </div>
            <ChevronDown size={16} />
          </button>
          <button className="player-play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause fill="currentColor" size={18} /> : <Play fill="currentColor" size={18} />}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`now-playing ${cues.length ? 'has-transcript' : ''}`}>
      <div className="now-playing-head">
        <button className="now-playing-collapse" onClick={() => onExpandedChange(false)} aria-label="Close now playing">
          <ChevronDown className="chevron-up" size={22} />
        </button>
        <span>{episode.show}</span>
      </div>
      <Cover artwork={episode.artwork} label={episode.show} large={!cues.length} />
      <div className="now-playing-copy">
        <h2>{episode.title}</h2>
        <p>{episode.author}{downloaded ? ' · Downloaded' : ''}</p>
      </div>
      <ProgressTrack
        currentTime={currentTime}
        duration={duration}
        fallbackLabel={episode.duration}
        adSegments={adSegments}
        onSeek={onSeek}
        showTimes
      />
      <p className="ad-caption">{adCaption}</p>
      <div className="controls">
        <button className="skip-control" onClick={() => onSeek(Math.max(0, currentTime - 15))} aria-label="Back 15 seconds">
          <RotateCcw size={28} strokeWidth={1.75} /><span>15</span>
        </button>
        <button className="player-play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause fill="currentColor" size={22} /> : <Play fill="currentColor" size={22} />}
        </button>
        <button className="skip-control" onClick={() => onSeek(Math.min(duration || currentTime + 30, currentTime + 30))} aria-label="Forward 30 seconds">
          <RotateCw size={28} strokeWidth={1.75} /><span>30</span>
        </button>
      </div>
      <div className="player-chips">
        <button className={`player-chip ${skipAds ? 'on' : ''}`} onClick={() => onSkipAdsChange(!skipAds)}>
          Skip ads {skipAds ? 'on' : 'off'}
        </button>
        <button className="player-chip" onClick={cycleRate}>{playbackRate}x</button>
        {downloaded ? (
          <button className={`player-chip ${adSegments.length ? 'on' : 'ad'}`} disabled={detecting} onClick={onHighlightAds}>
            {detecting ? <LoaderCircle className="spin" size={14} /> : <WandSparkles size={14} />}
            {detecting ? 'Scanning…' : adSegments.length ? 'Re-scan ads' : 'Highlight ads'}
          </button>
        ) : (
          <button className="player-chip" disabled={downloading} onClick={onDownload}>
            {downloading ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />}
            {downloading ? 'Saving…' : 'Download to scan'}
          </button>
        )}
      </div>
      {cues.length > 0 ? (
        <TranscriptFollow cues={cues} adSegments={adSegments} currentTime={currentTime} onSeek={onSeek} />
      ) : (
        <p className="transcript-empty">
          {downloaded
            ? 'Highlight ads to transcribe this episode. The words will scroll here as it plays — tap any word to jump.'
            : 'Download this episode, then Highlight ads to skip breaks and follow the transcript.'}
        </p>
      )}
    </div>
  )
}
