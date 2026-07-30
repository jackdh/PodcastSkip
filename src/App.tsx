import { useEffect, useRef, useState } from 'react'
import {
  Bell, Bookmark, ChevronDown, Clock3, Download, Headphones, Home,
  Library, ListMusic, MoreHorizontal, Pause, Play, Plus, Search,
  Settings, Share2, SkipForward, Sparkles, WandSparkles, X
} from 'lucide-react'
import { getShowEpisodes, searchCatalog, type Episode, type PodcastShow } from './podcastApi'

type Tab = 'Home' | 'Library' | 'Downloads' | 'Settings'

const transcript = [
  { time: '00:00', speaker: 'ALEX', text: 'Welcome back to The Knowledge Project. Today, I’m talking with author and investor Maya Chen about building a life around the things that matter.', ad: false },
  { time: '00:16', speaker: 'MAYA', text: 'I think the mistake people make is treating attention like it’s infinite. It’s the only asset that doesn’t compound once you’ve spent it.', ad: false },
  { time: '00:31', speaker: 'ALEX', text: 'Before we dive in, a quick word from today’s partner, Ledger. If you’re serious about protecting your digital assets, Ledger makes it simple.', ad: true },
  { time: '01:02', speaker: 'ALEX', text: 'Use the link in our show notes to get 10% off your first device. Now, back to Maya.', ad: true },
  { time: '01:10', speaker: 'MAYA', text: 'The practical shift is to decide what gets your best energy before the day starts asking for it.', ad: false },
]

function Art({ artwork, label, large = false }: { artwork?: string; label: string; large?: boolean }) {
  return <div className={`art lime ${large ? 'large' : ''}`}>{artwork ? <img src={artwork} alt="" /> : <><span>{label.slice(0, 2).toUpperCase()}</span><i /></>}</div>
}

function App() {
  const [tab, setTab] = useState<Tab>('Home')
  const [featuredEpisodes, setFeaturedEpisodes] = useState<Episode[]>([])
  const [libraryEpisodes, setLibraryEpisodes] = useState<Episode[]>([])
  const [activeEpisode, setActiveEpisode] = useState<Episode | null>(null)
  const [playing, setPlaying] = useState(false)
  const [followed, setFollowed] = useState(true)
  const [downloaded, setDownloaded] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ shows: PodcastShow[]; episodes: Episode[] }>({ shows: [], episodes: [] })
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [skipAds, setSkipAds] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('google/gemini-2.5-flash')
  const [toast, setToast] = useState('')
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    const saved = localStorage.getItem('podflow-settings')
    if (saved) {
      const parsed = JSON.parse(saved)
      setSkipAds(parsed.skipAds ?? true)
      setModel(parsed.model ?? 'google/gemini-2.5-flash')
      setApiKey(parsed.apiKey ?? '')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(async () => {
      if (search.trim().length < 2) {
        setSearchResults({ shows: [], episodes: [] }); setSearchStatus('idle')
        return
      }
      setSearchStatus('loading')
      try {
        const results = await searchCatalog(search)
        if (!cancelled) { setSearchResults(results); setSearchStatus('idle') }
      } catch {
        if (!cancelled) setSearchStatus('error')
      }
    }, 350)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [search])

  useEffect(() => {
    let cancelled = false
    searchCatalog('Radiolab').then(({ episodes }) => {
      if (!cancelled) {
        setFeaturedEpisodes(episodes)
        setLibraryEpisodes(episodes)
        setActiveEpisode(episodes[0] ?? null)
      }
    }).catch(() => setToast('Could not load featured episodes. Search for a show to begin.'))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const previousAudio = audioRef.current
    previousAudio?.pause()
    setPlaying(false); setCurrentTime(0); setAudioDuration(0)
    if (!activeEpisode?.audioUrl) { audioRef.current = null; return }
    const audio = new Audio(activeEpisode.audioUrl)
    audio.preload = 'metadata'
    audio.addEventListener('loadedmetadata', () => setAudioDuration(audio.duration))
    audio.addEventListener('timeupdate', () => setCurrentTime(audio.currentTime))
    audio.addEventListener('ended', () => setPlaying(false))
    audio.addEventListener('error', () => {
      setPlaying(false)
      setToast('This publisher does not allow playback in the browser.')
    })
    audioRef.current = audio
    return () => audio.pause()
  }, [activeEpisode])

  const selectEpisode = (episode: Episode) => {
    setActiveEpisode(episode); setTab('Home')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const toggleDownload = (id: string) => {
    setDownloaded(items => items.includes(id) ? items.filter(i => i !== id) : [...items, id])
    setToast(downloaded.includes(id) ? 'Removed from downloads' : 'Saved for offline listening')
    setTimeout(() => setToast(''), 2300)
  }
  const togglePlayback = async () => {
    const audio = audioRef.current
    if (!audio) { setToast('Choose an episode with playable audio first.'); return }
    if (playing) { audio.pause(); setPlaying(false); return }
    try { await audio.play(); setPlaying(true) }
    catch { setToast('Playback was blocked. Tap play again to start listening.') }
  }
  const seekTo = (time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time
    setCurrentTime(time)
  }
  const openShow = async (show: PodcastShow) => {
    setSearch(''); setSearchStatus('loading'); setTab('Library')
    try {
      const showEpisodes = await getShowEpisodes(show.id)
      setLibraryEpisodes(showEpisodes)
      if (showEpisodes[0]) setActiveEpisode(showEpisodes[0])
    } catch { setToast('Could not load that show. Please try another one.') }
    finally { setSearchStatus('idle') }
  }
  const saveSettings = () => {
    localStorage.setItem('podflow-settings', JSON.stringify({ skipAds, model, apiKey }))
    setSettingsOpen(false); setToast('Ad skip settings saved')
    setTimeout(() => setToast(''), 2300)
  }

  const visibleEpisodes = search.trim().length >= 2 ? searchResults.episodes : libraryEpisodes

  return <main>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Headphones size={20}/></span><span>podflow</span></div>
      <nav>{([
        ['Home', Home], ['Library', Library], ['Downloads', Download]
      ] as const).map(([name, Icon]) => <button key={name} className={tab === name ? 'nav-active' : ''} onClick={() => setTab(name)}>
        <Icon size={19}/>{name}
      </button>)}</nav>
      <div className="sidebar-bottom">
        <button onClick={() => setSettingsOpen(true)}><Settings size={19}/>Settings</button>
        <div className="profile"><div className="avatar">JT</div><div><b>Jamie Taylor</b><small>Free plan</small></div><MoreHorizontal size={18}/></div>
      </div>
    </aside>

    <section className="content">
      <header>
        <div className="mobile-brand"><Headphones size={19}/>podflow</div>
        <div className="search-wrap"><div className="search"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Apple Podcasts" aria-label="Search Apple Podcasts" /><kbd>⌘ K</kbd></div>
          {search.trim().length >= 2 && <div className="search-results">
            {searchStatus === 'loading' && <p className="search-state">Searching the podcast catalog…</p>}
            {searchStatus === 'error' && <p className="search-state">Search is unavailable. Please try again.</p>}
            {searchStatus === 'idle' && <>{searchResults.shows.length > 0 && <><span className="result-label">SHOWS</span>{searchResults.shows.map(show => <button className="show-result" key={show.id} onClick={() => openShow(show)}><Art artwork={show.artwork} label={show.name}/><span><b>{show.name}</b><small>{show.author}{show.genres[0] ? ` · ${show.genres[0]}` : ''}</small></span></button>)}</>}
            {searchResults.episodes.length > 0 && <><span className="result-label">EPISODES</span>{searchResults.episodes.slice(0, 4).map(episode => <button className="show-result" key={episode.id} onClick={() => { selectEpisode(episode); setSearch('') }}><Art artwork={episode.artwork} label={episode.show}/><span><b>{episode.title}</b><small>{episode.show} · {episode.duration}</small></span></button>)}</>}
            {!searchResults.shows.length && !searchResults.episodes.length && <p className="search-state">No playable podcasts found.</p>}</>}
          </div>}
        </div>
        <button className="icon-button"><Bell size={20}/><i /></button>
        <div className="avatar small">JT</div>
      </header>

      {tab === 'Home' && <HomeView episode={activeEpisode} playing={playing} onPlay={togglePlayback} followed={followed} onFollow={() => setFollowed(!followed)} skipAds={skipAds} onSkipAds={() => setSkipAds(!skipAds)} onOpenSettings={() => setSettingsOpen(true)} onDownload={() => activeEpisode && toggleDownload(activeEpisode.id)} isDownloaded={activeEpisode ? downloaded.includes(activeEpisode.id) : false} featuredEpisodes={featuredEpisodes} onSelect={selectEpisode} downloaded={downloaded} onEpisodeDownload={toggleDownload} currentTime={currentTime} audioDuration={audioDuration} />}
      {tab === 'Library' && <LibraryView episodes={visibleEpisodes} onSelect={selectEpisode} downloaded={downloaded} onDownload={toggleDownload} search={search} />}
      {tab === 'Downloads' && <LibraryView episodes={libraryEpisodes.filter(e => downloaded.includes(e.id))} onSelect={selectEpisode} downloaded={downloaded} onDownload={toggleDownload} search="" downloads />}
      {tab === 'Settings' && <SettingsPanel embedded apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} skipAds={skipAds} setSkipAds={setSkipAds} onSave={saveSettings}/>}
    </section>

    <PlayerBar episode={activeEpisode} playing={playing} onPlay={togglePlayback} currentTime={currentTime} duration={audioDuration} onSeek={seekTo} />
    <div className="mobile-nav">{([
      ['Home', Home], ['Library', Library], ['Downloads', Download], ['Settings', Settings]
    ] as const).map(([name, Icon]) => <button key={name} onClick={() => name === 'Settings' ? setSettingsOpen(true) : setTab(name)} className={tab === name ? 'active' : ''}><Icon size={19}/><span>{name}</span></button>)}</div>
    {settingsOpen && <div className="modal-backdrop"><div className="settings-modal"><button className="close" onClick={() => setSettingsOpen(false)}><X/></button><SettingsPanel apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} skipAds={skipAds} setSkipAds={setSkipAds} onSave={saveSettings}/></div></div>}
    {toast && <div className="toast"><Sparkles size={17}/>{toast}</div>}
  </main>
}

function HomeView({ episode, playing, onPlay, followed, onFollow, skipAds, onSkipAds, onOpenSettings, onDownload, isDownloaded, featuredEpisodes, onSelect, downloaded, onEpisodeDownload, currentTime, audioDuration }: {
  episode: Episode | null; playing: boolean; onPlay: () => void; followed: boolean; onFollow: () => void; skipAds: boolean; onSkipAds: () => void; onOpenSettings: () => void; onDownload: () => void; isDownloaded: boolean; featuredEpisodes: Episode[]; onSelect: (episode: Episode) => void; downloaded: string[]; onEpisodeDownload: (id: string) => void; currentTime: number; audioDuration: number
}) {
  if (!episode) return <div className="page loading-home"><Sparkles size={26}/><h1>Loading live podcasts…</h1><p>Connecting to the Apple Podcasts catalog.</p></div>
  const listened = audioDuration ? formatTime(currentTime) : 'Not started'
  return <div className="page">
    <div className="eyebrow">NOW PLAYING</div>
    <div className="hero">
      <Art artwork={episode.artwork} label={episode.show} large />
      <div className="hero-copy"><span className="show-name">{episode.show}</span><h1>{episode.title}</h1><p>{episode.author} · {episode.date} · {episode.duration}</p><div className="hero-actions"><button className="play-button" onClick={onPlay}>{playing ? <Pause fill="currentColor"/> : <Play fill="currentColor"/>}{playing ? 'Pause' : 'Play episode'}</button><button className={`round-button ${isDownloaded ? 'downloaded-button' : ''}`} onClick={onDownload} title="Save in your library"><Download size={20}/></button><button className="round-button" onClick={() => navigator.share?.({ title: episode.title, text: `${episode.title} — ${episode.show}` })}><Share2 size={19}/></button></div></div>
      <button className={`follow ${followed ? 'following' : ''}`} onClick={onFollow}>{followed ? 'Following' : <><Plus size={16}/>Follow</>}</button>
    </div>
    <div className="stats"><div><strong>{listened}</strong><span>of {audioDuration ? formatTime(audioDuration) : episode.duration} played</span></div><div><strong>—</strong><span>ads skipped this episode</span></div><div><strong>—</strong><span>total time reclaimed</span></div></div>
    <div className="section-heading"><div><h2>Episode transcript</h2><p>Follow along as you listen</p></div><button className="text-button"><Bookmark size={17}/>Save</button></div>
    <section className="transcript-card">
      <div className="transcript-toolbar"><span><ListMusic size={18}/>Interactive transcript</span><div><button className={skipAds ? 'toggle on' : 'toggle'} onClick={onSkipAds}><i/></button><b>Skip ads automatically</b><button className="info" onClick={onOpenSettings}>?</button></div></div>
      <div className="transcript-list">{transcript.map((line, index) => <div className={`transcript-line ${line.ad ? 'ad' : ''} ${index === 0 ? 'current' : ''}`} key={line.time}>
        <time>{line.time}</time><div><span>{line.ad && <WandSparkles size={14}/>} {line.ad ? 'AD DETECTED' : line.speaker}</span><p>{line.text}</p></div>{line.ad && <button className="skip-line"><SkipForward size={15}/>Skip</button>}</div>)}</div>
    </section>
    <div className="section-heading release-heading"><div><h2>Fresh from the catalog</h2><p>Live episodes from Apple Podcasts</p></div><button className="text-button">Browse <ChevronDown size={16}/></button></div>
    <EpisodeList episodes={featuredEpisodes.slice(1, 4)} onSelect={onSelect} downloaded={downloaded} onDownload={onEpisodeDownload} compact/>
  </div>
}

function LibraryView({ episodes, onSelect, downloaded, onDownload, search, downloads }: { episodes: Episode[]; onSelect: (e: Episode) => void; downloaded: string[]; onDownload: (id: string) => void; search: string; downloads?: boolean }) {
  return <div className="page library-page"><div className="eyebrow">{downloads ? 'OFFLINE LISTENING' : 'YOUR LIBRARY'}</div><h1>{downloads ? 'Downloads' : search ? `Results for “${search}”` : 'Latest episodes'}</h1><p className="subcopy">{downloads ? 'Saved on this device. Ready whenever you are.' : 'New releases from the shows you follow.'}</p><EpisodeList episodes={episodes} onSelect={onSelect} downloaded={downloaded} onDownload={onDownload}/></div>
}

function EpisodeList({ episodes, onSelect, downloaded, onDownload, compact = false }: { episodes: Episode[]; onSelect: (e: Episode) => void; downloaded: string[]; onDownload: (id: string) => void; compact?: boolean }) {
  if (!episodes.length) return <div className="empty"><Download size={30}/><h3>Nothing downloaded yet</h3><p>Save episodes to listen without an internet connection.</p></div>
  return <div className={`episode-list ${compact ? 'compact' : ''}`}>{episodes.map(e => <article className="episode-row" key={e.id} onClick={() => onSelect(e)}><Art artwork={e.artwork} label={e.show}/><div className="episode-info"><span>{e.show}</span><h3>{e.title}</h3><p>{e.date} · {e.duration}</p></div><button className={`download ${downloaded.includes(e.id) ? 'done' : ''}`} onClick={event => { event.stopPropagation(); onDownload(e.id) }}><Download size={19}/></button><button className="more" onClick={event => event.stopPropagation()}><MoreHorizontal size={20}/></button></article>)}</div>
}

function PlayerBar({ episode, playing, onPlay, currentTime, duration, onSeek }: { episode: Episode | null; playing: boolean; onPlay: () => void; currentTime: number; duration: number; onSeek: (time: number) => void }) {
  if (!episode) return null
  return <div className="player-bar"><div className="now"><Art artwork={episode.artwork} label={episode.show}/><div><b>{episode.title}</b><span>{episode.show}</span></div></div><div className="controls"><button onClick={() => onSeek(Math.max(0, currentTime - 15))} aria-label="Back 15 seconds"><SkipForward className="flip" size={19}/></button><button className="player-play" onClick={onPlay}>{playing ? <Pause fill="currentColor" size={18}/> : <Play fill="currentColor" size={18}/>}</button><button onClick={() => onSeek(Math.min(duration, currentTime + 30))} aria-label="Forward 30 seconds"><SkipForward size={19}/></button></div><div className="track"><span>{formatTime(currentTime)}</span><input aria-label="Playback progress" type="range" min="0" max={duration || 1} value={Math.min(currentTime, duration || 1)} onChange={e => onSeek(Number(e.target.value))}/><span>{duration ? formatTime(duration) : episode.duration}</span></div><button className="speed">1×</button></div>
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function SettingsPanel({ apiKey, setApiKey, model, setModel, skipAds, setSkipAds, onSave, embedded = false }: { apiKey: string; setApiKey: (v: string) => void; model: string; setModel: (v: string) => void; skipAds: boolean; setSkipAds: (v: boolean) => void; onSave: () => void; embedded?: boolean }) {
  return <div className={`settings-panel ${embedded ? 'embedded' : ''}`}><div className="settings-head"><div className="settings-icon"><WandSparkles size={22}/></div><div><h2>Smart ad skipping</h2><p>Let AI find and skip ads in your downloads.</p></div></div><div className="settings-card"><div className="setting-row"><div><b>Automatically skip ads</b><p>Skip detected ad breaks during playback.</p></div><button className={skipAds ? 'toggle on' : 'toggle'} onClick={() => setSkipAds(!skipAds)}><i/></button></div><hr/><label>OpenRouter API key <a href="https://openrouter.ai/keys" target="_blank">Get an API key ↗</a><input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-v1-••••••••••••••••" type="password"/></label><div className="key-note"><Sparkles size={15}/><span>Your key stays on this device and is only used to analyse downloaded transcripts.</span></div><label>Analysis model <a href="https://openrouter.ai/models" target="_blank">Compare models ↗</a><select value={model} onChange={e => setModel(e.target.value)}><option value="google/gemini-2.5-flash">Gemini 2.5 Flash — recommended</option><option value="openai/gpt-4.1-mini">GPT-4.1 mini — precise</option><option value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku — nuanced</option></select></label><div className="credit"><span>OpenRouter credit</span><strong>{apiKey ? 'Connect to check balance' : 'Add your key to check balance'}</strong></div></div><button className="save-settings" onClick={onSave}>Save settings</button></div>
}

export default App
