import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { PlayerBar } from './Player'
import type { Episode } from './podcastApi'
import type { AdSegment, TranscriptCue } from './openRouter'

const episode: Episode = {
  id: 'story-episode',
  showId: 1,
  show: 'The Daily',
  author: 'The New York Times',
  title: 'What the Latest Jobs Report Really Means',
  date: 'Aug 13, 2026',
  duration: '1h 30m',
  artwork: 'https://picsum.photos/seed/podflow/600/600',
}

const cues: TranscriptCue[] = Array.from({ length: 32 }, (_, index) => {
  const start = index * 15
  return { start, end: start + 15, text: `Spoken line ${index + 1} from the follow-along transcript.` }
})

const adSegments: AdSegment[] = [
  { start: 20, end: 55, label: 'Sponsor' },
  { start: 240, end: 300, label: 'Mid-roll' },
]

function ExpandedPlayer({
  currentTime = 260,
  duration = 5427,
  analyseMinutes = 8,
  withTranscript = true,
}: {
  currentTime?: number
  duration?: number
  analyseMinutes?: number
  withTranscript?: boolean
}) {
  const [playing, setPlaying] = useState(true)
  const [skipAds, setSkipAds] = useState(true)
  const [rate, setRate] = useState(1)
  const [volume, setVolume] = useState(0.82)
  const [open, setOpen] = useState(true)

  return (
    <PlayerBar
      episode={episode}
      playing={playing}
      onPlay={() => setPlaying((value) => !value)}
      onPause={() => setPlaying(false)}
      currentTime={currentTime}
      duration={duration}
      onSeek={() => {}}
      adSegments={adSegments}
      cues={withTranscript ? cues : []}
      downloaded
      skipAds={skipAds}
      onSkipAdsChange={setSkipAds}
      onHighlightAds={() => {}}
      playbackRate={rate}
      onPlaybackRateChange={setRate}
      volume={volume}
      onVolumeChange={setVolume}
      analyseMinutes={analyseMinutes}
      expanded={open}
      onExpandedChange={setOpen}
    />
  )
}

const meta = {
  title: 'Podflow/Player',
  component: ExpandedPlayer,
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'mobile1' },
  },
} satisfies Meta<typeof ExpandedPlayer>

export default meta
type Story = StoryObj<typeof meta>

export const NowPlaying: Story = {}

export const NowPlayingPartialScan: Story = {
  args: { analyseMinutes: 8, currentTime: 260, duration: 5427 },
}

export const MiniBar: Story = {
  render: () => {
    const [playing, setPlaying] = useState(false)
    return (
      <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0 }}>
        <PlayerBar
          episode={episode}
          playing={playing}
          onPlay={() => setPlaying((value) => !value)}
          onPause={() => setPlaying(false)}
          currentTime={260}
          duration={5427}
          onSeek={() => {}}
          adSegments={adSegments}
          cues={cues}
          downloaded
          skipAds
          onSkipAdsChange={() => {}}
          playbackRate={1}
          onPlaybackRateChange={() => {}}
          volume={0.8}
          onVolumeChange={() => {}}
          expanded={false}
          onExpandedChange={() => {}}
        />
      </div>
    )
  },
}
