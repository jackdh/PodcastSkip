import { useEffect, useRef, useState } from 'react'
import {
  Captions, ChevronDown, Download, LoaderCircle, Moon, MoreHorizontal,
  Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX, WandSparkles,
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

type SeekHandler = (time: number, options?: { allowAds?: boolean }) => void

function Cover({ artwork, label, compact = false }: { artwork?: string; label: string; compact?: boolean }) {
  return (
    <div className={`art lime ${compact ? 'now-art' : ''}`}>
      {artwork ? <img src={artwork} alt="" /> : <><span>{label.slice(0, 2).toUpperCase()}</span><i /></>}
    </div>
  )
}

function SegmentedScrubber({
  currentTime,
  duration,
  fallbackLabel,
  adSegments,
  onSeek,
  variant = 'full',
  hint,
}: {
  currentTime: number
  duration: number
  fallbackLabel: string
  adSegments: AdSegment[]
  onSeek: SeekHandler
  variant?: 'full' | 'slim'
  hint?: string
}) {
  const trackMax = duration || 1
  const segments = buildScrubberSegments(duration, adSegments)
  return (
    <div className={`scrubber scrubber-${variant}`}>
      <div className="scrubber-rail">
        {segments.map((segment) => (
          <i
            key={`${segment.kind}-${segment.start}-${segment.end}`}
            className={`scrubber-seg ${segment.kind}`}
            style={{
              flexGrow: Math.max(segment.end - segment.start, 0.4),
              ['--played' as string]: `${segmentPlayedFraction(segment, currentTime) * 100}%`,
            }}
            title={segment.kind === 'ad' ? (segment.label ? `Ad: ${segment.label}` : 'Ad break') : undefined}
          />
        ))}
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
      {variant === 'full' && (
        <div className="scrubber-meta">
          <span>{formatTime(currentTime)}</span>
          <span className="scrubber-hint">{hint || (duration ? 'Scrub to jump' : fallbackLabel)}</span>
          <span>{duration ? formatRemaining(currentTime, duration) : fallbackLabel}</span>
        </div>
      )}
    </div>
  )
}

function TranscriptFollow({
  cues,
  adSegments,
  currentTime,
  title,
  pastCoverage,
  onSeek,
}: {
  cues: TranscriptCue[]
  adSegments: AdSegment[]
  currentTime: number
  title: string
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
      <h2>{title}</h2>
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
  const onPauseRef = useRef(onPause)
  onPauseRef.current = onPause

  useEffect(() => {
    if (!expanded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [expanded])

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
  const adHint = adSegments.length
    ? `${adSegments.length} ad ${adSegments.length === 1 ? 'break' : 'breaks'}`
    : undefined

  if (!expanded) {
    return (
      <div className="player-bar">
        <div className="player-progress-slim">
          <SegmentedScrubber
            currentTime={currentTime}
            duration={duration}
            fallbackLabel={episode.duration}
            adSegments={adSegments}
            onSeek={onSeek}
            variant="slim"
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
    <div className="now-playing">
      <button className="now-grab" onClick={() => onExpandedChange(false)} aria-label="Close now playing">
        <span />
      </button>

      <div className="now-card">
        <Cover artwork={episode.artwork} label={episode.show} compact />
        <div>
          <b>{episode.title}</b>
          <span>{episode.show}</span>
        </div>
        <button className="now-more" aria-label="Close now playing" onClick={() => onExpandedChange(false)}>
          <MoreHorizontal size={18} />
        </button>
      </div>

      {cues.length > 0 ? (
        <TranscriptFollow
          cues={cues}
          adSegments={adSegments}
          currentTime={currentTime}
          title={episode.title}
          pastCoverage={pastCoverage}
          onSeek={onSeek}
        />
      ) : (
        <div className="now-transcript now-transcript-empty">
          <h2>{episode.title}</h2>
          <p>
            {adSegments.length
              ? 'Ads are marked but the spoken transcript was not saved. Re-scan audio to follow the words here — tap any word to jump.'
              : downloaded
                ? 'Highlight ads transcribes the downloaded audio. The current sentence stays in the middle as it plays.'
                : 'Download this episode, then Highlight ads to transcribe the audio, skip breaks, and follow the words.'}
          </p>
        </div>
      )}

      {(scanRest || pastCoverage) && (
        <div className="now-coverage">
          <span>
            {pastCoverage
              ? `Transcript ends at ${formatTime(coverageEnd)} — you are at ${formatTime(currentTime)}`
              : `Ads and transcript only cover ${formatTime(0)}–${formatTime(coverageEnd || analysisWindowEnd(analyseMinutes, duration))}`}
          </span>
          <button type="button" disabled={detecting || !downloaded} onClick={() => onHighlightAds?.({ windowMinutes: 0 })}>
            {detecting ? 'Scanning…' : 'Scan entire episode'}
          </button>
        </div>
      )}

      <SegmentedScrubber
        currentTime={currentTime}
        duration={duration}
        fallbackLabel={episode.duration}
        adSegments={adSegments}
        onSeek={onSeek}
        hint={adHint ?? (detecting ? 'Scanning for ads…' : 'Highlight ads to mark breaks')}
      />

      <div className="now-transport">
        <button className="now-rate" onClick={cycleRate} aria-label="Playback speed">{playbackRate}x</button>
        <button className="now-skip" onClick={() => onSeek(Math.max(0, currentTime - 15))} aria-label="Back 15 seconds">
          <RotateCcw size={28} strokeWidth={1.7} /><span>15</span>
        </button>
        <button className="now-play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause fill="currentColor" size={36} /> : <Play fill="currentColor" size={36} />}
        </button>
        <button className="now-skip" onClick={() => onSeek(Math.min(duration || currentTime + 30, currentTime + 30))} aria-label="Forward 30 seconds">
          <RotateCw size={28} strokeWidth={1.7} /><span>30</span>
        </button>
        <button className={`now-sleep ${sleepMinutes ? 'on' : ''}`} onClick={cycleSleep} aria-label="Sleep timer">
          <Moon size={22} strokeWidth={1.7} />
          {sleepMinutes ? <em>{sleepMinutes}m</em> : null}
        </button>
      </div>

      <div className="now-volume">
        {volume <= 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
        <input
          aria-label="Volume"
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
        />
        <Volume2 size={20} />
      </div>

      <div className="now-dock">
        <button className="now-dock-btn on" aria-label="Transcript" type="button">
          <Captions size={20} />
        </button>
        <button className={`now-dock-btn ${skipAds ? 'on' : ''}`} onClick={() => onSkipAdsChange(!skipAds)}>
          Skip ads {skipAds ? 'on' : 'off'}
        </button>
        {downloaded ? (
          <button className="now-dock-btn" disabled={detecting} onClick={() => onHighlightAds?.()}>
            {detecting ? <LoaderCircle className="spin" size={16} /> : <WandSparkles size={16} />}
            {detecting ? 'Scanning' : adSegments.length ? 'Re-scan' : 'Highlight'}
          </button>
        ) : (
          <button className="now-dock-btn" disabled={downloading} onClick={onDownload}>
            {downloading ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}
            {downloading ? 'Saving' : 'Download'}
          </button>
        )}
      </div>
    </div>
  )
}
