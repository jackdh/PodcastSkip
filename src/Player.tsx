import { useEffect, useRef, useState } from 'react'
import {
  Captions, ChevronDown, Download, Headphones, LoaderCircle, Moon, MoreHorizontal,
  Pause, Play, RotateCcw, RotateCw, Volume2, WandSparkles,
} from 'lucide-react'
import type { Episode } from './podcastApi'
import type { AdSegment, TranscriptCue } from './openRouter'
import {
  activeCueIndex,
  analysisWindowEnd,
  buildScrubberSegments,
  cueOverlapsAd,
  formatRemaining,
  formatTime,
  isPlayheadPastTranscript,
  needsFullEpisodeScan,
  nextSleepMinutes,
  segmentPlayedFraction,
  transcriptCoverageEnd,
  wordsFromCue,
} from './playerModel'

const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2]
const DISMISS_DISTANCE = 120
const DISMISS_VELOCITY = 0.65

type SeekHandler = (time: number, options?: { allowAds?: boolean }) => void

function Cover({ artwork, label, size = 'card' }: { artwork?: string; label: string; size?: 'mini' | 'card' | 'hero' }) {
  return (
    <div className={`art ${size}`}>
      {artwork ? <img src={artwork} alt="" /> : <span>{label.slice(0, 2).toUpperCase()}</span>}
    </div>
  )
}

function valueFromClientX(clientX: number, el: HTMLElement, max: number) {
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0) return 0
  return Math.min(max, Math.max(0, ((clientX - rect.left) / rect.width) * max))
}

function SegmentedScrubber({
  currentTime,
  duration,
  fallbackLabel,
  title,
  adSegments,
  onSeek,
  variant = 'full',
}: {
  currentTime: number
  duration: number
  fallbackLabel: string
  title?: string
  adSegments: AdSegment[]
  onSeek: SeekHandler
  variant?: 'full' | 'slim'
}) {
  const railRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const [seeking, setSeeking] = useState(false)
  const [seekTime, setSeekTime] = useState(currentTime)
  const trackMax = duration > 0 && Number.isFinite(duration) ? duration : 1
  const displayTime = seeking ? seekTime : currentTime
  const progress = Math.min(1, Math.max(0, displayTime / trackMax))
  const segments = buildScrubberSegments(duration, adSegments)
  const tooltip = title || fallbackLabel

  const commit = (value: number) => {
    setSeekTime(value)
    onSeek(value)
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !railRef.current) return
    dragging.current = true
    setSeeking(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    commit(valueFromClientX(event.clientX, railRef.current, trackMax))
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !railRef.current) return
    commit(valueFromClientX(event.clientX, railRef.current, trackMax))
  }
  const onPointerUp = () => {
    dragging.current = false
    setSeeking(false)
  }

  return (
    <div className={`scrubber scrubber-${variant} ${seeking ? 'seeking' : ''}`}>
      {variant === 'full' && seeking && (
        <div className="scrubber-tooltip" style={{ left: `${Math.min(92, Math.max(8, progress * 100))}%` }}>
          <b>{tooltip}</b>
          <span>{formatTime(displayTime)}</span>
        </div>
      )}
      <div
        ref={railRef}
        className="scrubber-rail"
        role="slider"
        tabIndex={0}
        aria-label="Playback progress"
        aria-valuemin={0}
        aria-valuemax={trackMax}
        aria-valuenow={Math.min(displayTime, trackMax)}
        aria-valuetext={formatTime(displayTime)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 15 : 5
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault()
            commit(Math.min(trackMax, displayTime + step))
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault()
            commit(Math.max(0, displayTime - step))
          }
        }}
      >
        <div className="scrubber-track">
          {segments.map((segment) => (
            <i
              key={`${segment.kind}-${segment.start}-${segment.end}`}
              className={`scrubber-seg ${segment.kind}`}
              style={{
                flexGrow: Math.max(segment.end - segment.start, 0.4),
                ['--played' as string]: `${segmentPlayedFraction(segment, displayTime) * 100}%`,
              }}
              title={segment.kind === 'ad' ? (segment.label ? `Ad: ${segment.label}` : 'Ad break') : undefined}
            />
          ))}
        </div>
        {variant === 'full' && <span className="scrubber-thumb" style={{ left: `clamp(6px, ${progress * 100}%, calc(100% - 6px))` }} />}
      </div>
      {variant === 'full' && (
        <div className="scrubber-meta">
          <span>{formatTime(displayTime)}</span>
          <span>{duration ? formatRemaining(displayTime, duration) : fallbackLabel}</span>
        </div>
      )}
    </div>
  )
}

function VolumeSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const railRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const fill = Math.min(1, Math.max(0, value))

  const commit = (clientX: number) => {
    if (!railRef.current) return
    onChange(valueFromClientX(clientX, railRef.current, 1))
  }

  return (
    <div className="now-volume">
      <Volume2 size={13} strokeWidth={1.8} aria-hidden />
      <div
        ref={railRef}
        className="now-volume-rail"
        role="slider"
        tabIndex={0}
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={fill}
        onPointerDown={(event) => {
          if (event.button !== 0) return
          dragging.current = true
          event.currentTarget.setPointerCapture(event.pointerId)
          commit(event.clientX)
        }}
        onPointerMove={(event) => { if (dragging.current) commit(event.clientX) }}
        onPointerUp={() => { dragging.current = false }}
        onPointerCancel={() => { dragging.current = false }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
            event.preventDefault()
            onChange(Math.min(1, fill + 0.05))
          } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
            event.preventDefault()
            onChange(Math.max(0, fill - 0.05))
          }
        }}
      >
        <span className="now-volume-fill" style={{ width: `${fill * 100}%` }} />
        <span className="now-volume-thumb" style={{ left: `clamp(7px, ${fill * 100}%, calc(100% - 7px))` }} />
      </div>
      <Volume2 size={18} strokeWidth={1.8} aria-hidden />
    </div>
  )
}

function TranscriptFollow({
  cues,
  adSegments,
  currentTime,
  pastCoverage,
  onSeek,
}: {
  cues: TranscriptCue[]
  adSegments: AdSegment[]
  currentTime: number
  pastCoverage: boolean
  onSeek: SeekHandler
}) {
  const currentRef = useRef<HTMLParagraphElement | null>(null)
  const userScrollAt = useRef(0)
  const followedIndex = pastCoverage ? -1 : activeCueIndex(cues, currentTime)

  useEffect(() => {
    if (followedIndex < 0) return
    if (Date.now() - userScrollAt.current < 2800) return
    currentRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [followedIndex])

  return (
    <div
      className="now-transcript"
      onScroll={() => { userScrollAt.current = Date.now() }}
      onTouchStart={() => { userScrollAt.current = Date.now() }}
    >
      {cues.map((cue, index) => {
        const ad = cueOverlapsAd(cue, adSegments)
        const current = index === followedIndex
        const spoken = !pastCoverage && followedIndex >= 0 && index <= followedIndex
        const words = wordsFromCue(cue)
        return (
          <p
            key={`${cue.start}-${cue.end}-${index}`}
            ref={current ? currentRef : undefined}
            className={`now-line ${ad ? 'ad' : ''} ${current ? 'current' : ''} ${spoken && !current ? 'spoken' : ''}`}
          >
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
        )
      })}
    </div>
  )
}

function useSheetDismiss(active: boolean, onClose: () => void) {
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ startY: number; lastY: number; lastT: number; vy: number; pointerId: number; moved: boolean } | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!active) {
      setOffset(0)
      setDragging(false)
      drag.current = null
    }
  }, [active])

  const onPointerDown = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    const target = event.target as HTMLElement
    if (target.closest('button, a, input, select, textarea') && !target.closest('.now-grab')) return
    drag.current = {
      startY: event.clientY,
      lastY: event.clientY,
      lastT: performance.now(),
      vy: 0,
      pointerId: event.pointerId,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current
    if (!state || event.pointerId !== state.pointerId) return
    const dy = event.clientY - state.startY
    if (!state.moved && Math.abs(dy) < 8) return
    if (!state.moved && dy < 0) return
    state.moved = true
    const now = performance.now()
    state.vy = (event.clientY - state.lastY) / Math.max(1, now - state.lastT)
    state.lastY = event.clientY
    state.lastT = now
    setDragging(true)
    setOffset(Math.max(0, dy))
  }

  const onPointerUp = (event: React.PointerEvent<HTMLElement>) => {
    const state = drag.current
    if (state && event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    drag.current = null
    setDragging(false)
    if (!state) return
    const dy = Math.max(0, event.clientY - state.startY)
    const tappedGrabber = !state.moved && !!(event.target as HTMLElement).closest('.now-grab')
    if (tappedGrabber || (state.moved && (dy > DISMISS_DISTANCE || state.vy > DISMISS_VELOCITY))) {
      onCloseRef.current()
      return
    }
    setOffset(0)
  }

  return {
    offset,
    dragging,
    bind: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  }
}

export function PlayerBar({
  episode,
  playing,
  onPlay,
  onPause,
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
  volume,
  onVolumeChange,
  analyseMinutes = 0,
  expanded,
  onExpandedChange,
}: {
  episode: Episode | null
  playing: boolean
  onPlay: () => void
  onPause: () => void
  currentTime: number
  duration: number
  onSeek: SeekHandler
  adSegments: AdSegment[]
  cues?: TranscriptCue[]
  downloaded?: boolean
  skipAds: boolean
  onSkipAdsChange: (value: boolean) => void
  detecting?: boolean
  onHighlightAds?: (options?: { windowMinutes?: number }) => void
  onDownload?: () => void
  downloading?: boolean
  playbackRate: number
  onPlaybackRateChange: (value: number) => void
  volume: number
  onVolumeChange: (value: number) => void
  analyseMinutes?: number
  expanded: boolean
  onExpandedChange: (value: boolean) => void
}) {
  const [sleepMinutes, setSleepMinutes] = useState<number | null>(null)
  const [sleepUntil, setSleepUntil] = useState<number | null>(null)
  const [showTranscript, setShowTranscript] = useState(true)
  const onPauseRef = useRef(onPause)
  onPauseRef.current = onPause
  const sheet = useSheetDismiss(expanded, () => onExpandedChange(false))

  useEffect(() => {
    if (!expanded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onExpandedChange(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [expanded, onExpandedChange])

  useEffect(() => {
    if (cues.length) setShowTranscript(true)
  }, [episode?.id, cues.length])

  useEffect(() => {
    if (!sleepUntil) return
    const wait = sleepUntil - Date.now()
    if (wait <= 0) {
      onPauseRef.current()
      setSleepMinutes(null)
      setSleepUntil(null)
      return
    }
    const timer = window.setTimeout(() => {
      onPauseRef.current()
      setSleepMinutes(null)
      setSleepUntil(null)
    }, wait)
    return () => window.clearTimeout(timer)
  }, [sleepUntil])

  if (!episode) return null

  const cycleRate = () => {
    const index = PLAYBACK_RATES.indexOf(playbackRate)
    onPlaybackRateChange(PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length])
  }

  const cycleSleep = () => {
    const next = nextSleepMinutes(sleepMinutes)
    setSleepMinutes(next)
    setSleepUntil(next ? Date.now() + next * 60 * 1000 : null)
  }

  const pastCoverage = isPlayheadPastTranscript(cues, currentTime)
  const scanRest = needsFullEpisodeScan(cues, analyseMinutes, duration)
  const coverageEnd = transcriptCoverageEnd(cues)
  const transcriptOpen = showTranscript && cues.length > 0

  if (!expanded) {
    return (
      <div className="player-bar">
        <div className="player-progress-slim">
          <SegmentedScrubber
            currentTime={currentTime}
            duration={duration}
            fallbackLabel={episode.duration}
            title={episode.title}
            adSegments={adSegments}
            onSeek={onSeek}
            variant="slim"
          />
        </div>
        <div className="player-bar-main">
          <button className="now" onClick={() => onExpandedChange(true)} aria-expanded={false} aria-label="Open now playing">
            <Cover artwork={episode.artwork} label={episode.show} size="mini" />
            <div>
              <b>{episode.title}</b>
              <span>
                {episode.show}
                {adSegments.length ? ` · ${adSegments.length} ads` : ''}
                {skipAds && adSegments.length ? ' · skipping' : ''}
              </span>
            </div>
          </button>
          <button className="player-play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause fill="currentColor" size={22} /> : <Play fill="currentColor" size={22} />}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={`now-playing ${sheet.dragging ? 'dragging' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      style={{ transform: sheet.offset ? `translateY(${sheet.offset}px)` : undefined }}
    >
      {episode.artwork ? (
        <div className="now-backdrop" aria-hidden>
          <img src={episode.artwork} alt="" />
        </div>
      ) : null}

      <div className="now-chrome" {...sheet.bind}>
        <div
          className="now-grab"
          role="button"
          tabIndex={0}
          aria-label="Close now playing"
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              onExpandedChange(false)
            }
          }}
        >
          <span />
        </div>

        <div className="now-card">
          <Cover artwork={episode.artwork} label={episode.show} size="card" />
          <div>
            <b>{episode.show}</b>
            {episode.author && episode.author !== 'Unknown creator' ? <span>{episode.author}</span> : <span>Podcast</span>}
          </div>
          <button className="now-more" aria-label="Close now playing" onClick={() => onExpandedChange(false)}>
            <MoreHorizontal size={18} />
          </button>
          <button
            className="now-episode-title"
            type="button"
            onClick={() => { if (cues.length) setShowTranscript((open) => !open) }}
            aria-expanded={transcriptOpen}
          >
            <span>{episode.title}</span>
            {cues.length ? <ChevronDown size={18} className={transcriptOpen ? '' : 'chevron-up'} /> : null}
          </button>
        </div>
      </div>

      {transcriptOpen ? (
        <TranscriptFollow
          cues={cues}
          adSegments={adSegments}
          currentTime={currentTime}
          pastCoverage={pastCoverage}
          onSeek={onSeek}
        />
      ) : (
        <div className="now-artwork-stage" {...sheet.bind}>
          <Cover artwork={episode.artwork} label={episode.show} size="hero" />
        </div>
      )}

      <div className="now-controls">
        {(scanRest || pastCoverage) && (
          <div className="now-coverage">
            <span>
              {pastCoverage
                ? `Past transcript · ${formatTime(coverageEnd)}`
                : `Transcript ${formatTime(0)}–${formatTime(coverageEnd || analysisWindowEnd(analyseMinutes, duration))}`}
            </span>
            <button type="button" disabled={detecting || !downloaded} onClick={() => onHighlightAds?.({ windowMinutes: 0 })}>
              {detecting ? 'Scanning…' : 'Scan rest'}
            </button>
          </div>
        )}

        <SegmentedScrubber
          currentTime={currentTime}
          duration={duration}
          fallbackLabel={episode.duration}
          title={episode.title}
          adSegments={adSegments}
          onSeek={onSeek}
        />

        <div className="now-transport">
          <button className="now-rate" onClick={cycleRate} aria-label="Playback speed">{playbackRate}x</button>
          <button className="now-skip" onClick={() => onSeek(Math.max(0, currentTime - 15))} aria-label="Back 15 seconds">
            <RotateCcw size={26} strokeWidth={1.6} /><span>15</span>
          </button>
          <button className="now-play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause fill="currentColor" size={38} /> : <Play fill="currentColor" size={38} />}
          </button>
          <button className="now-skip" onClick={() => onSeek(Math.min(duration || currentTime + 30, currentTime + 30))} aria-label="Forward 30 seconds">
            <RotateCw size={26} strokeWidth={1.6} /><span>30</span>
          </button>
          <button className={`now-sleep ${sleepMinutes ? 'on' : ''}`} onClick={cycleSleep} aria-label="Sleep timer">
            <Moon size={20} strokeWidth={1.6} />
            {sleepMinutes ? <em>{sleepMinutes}m</em> : null}
          </button>
        </div>

        <VolumeSlider value={volume} onChange={onVolumeChange} />

        <div className="now-dock">
          <button
            className={`now-dock-btn icon ${transcriptOpen ? 'on' : ''}`}
            aria-label="Transcript"
            type="button"
            onClick={() => setShowTranscript((open) => !open)}
            disabled={!cues.length}
          >
            <Captions size={22} />
          </button>
          <button className={`now-dock-device ${skipAds ? 'on' : ''}`} onClick={() => onSkipAdsChange(!skipAds)}>
            <Headphones size={20} strokeWidth={1.7} />
            <span>Skip ads {skipAds ? 'on' : 'off'}</span>
          </button>
          {downloaded ? (
            <button className="now-dock-btn icon" disabled={detecting} onClick={() => onHighlightAds?.({ windowMinutes: 0 })} aria-label={detecting ? 'Scanning' : adSegments.length ? 'Re-scan' : 'Highlight ads'}>
              {detecting ? <LoaderCircle className="spin" size={20} /> : <WandSparkles size={20} />}
            </button>
          ) : (
            <button className="now-dock-btn icon" disabled={downloading} onClick={onDownload} aria-label={downloading ? 'Saving' : 'Download'}>
              {downloading ? <LoaderCircle className="spin" size={20} /> : <Download size={20} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
