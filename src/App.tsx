import { useEffect, useRef, useState } from 'react'
import {
  Bell, ChevronDown, Clock3, Download, Headphones, Home,
  Library, MoreHorizontal, Pause, Play, Plus, Search,
  Settings, Share2, SkipForward, Sparkles, WandSparkles, X
} from 'lucide-react'
import { getShowEpisodes, playbackUrl, searchCatalog, type Episode, type PodcastShow } from './podcastApi'

type Tab = 'Home' | 'Library' | 'Downloads' | 'Settings'
const downloadCacheName = 'podflow-downloads-v1'

function Art({ artwork, label, large = false }: { artwork?: string; label: string; large?: boolean }) {
  return <div className={`art lime ${large ? 'large' : ''}`}>{artwork ? <img src={artwork} alt="" /> : <><span>{label.slice(0, 2).toUpperCase()}</span><i /></>}</div>
}

function App() {
  const [tab, setTab] = useState<Tab>('Home')
  const [timelineEpisodes, setTimelineEpisodes] = useState<Episode[]>([])
  const [activeEpisode, setActiveEpisode] = useState<Episode | null>(null)
  const [playing, setPlaying] = useState(false)
  const [followedShows, setFollowedShows] = useState<PodcastShow[]>(() => {
    try { return JSON.parse(localStorage.getItem('podflow-followed-shows') ?? '[]') as PodcastShow[] }
    catch { return [] }
  })
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<Episode[]>(() => {
    try { return JSON.parse(localStorage.getItem('podflow-downloads') ?? '[]') as Episode[] }
    catch { return [] }
  })
  const [downloading, setDownloading] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ shows: PodcastShow[]; episodes: Episode[] }>({ shows: [], episodes: [] })
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [skipAds, setSkipAds] = useState(true)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('google/gemini-2.5-flash')
  const [toast, setToast] = useState('')
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [storageUsage, setStorageUsage] = useState({ usage: 0, quota: 0 })
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingResumeRef = useRef<{ id: string; position: number } | null>(null)
  const refreshStorageUsage = async () => {
    if (!navigator.storage?.estimate) return
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    setStorageUsage({ usage, quota })
  }

  useEffect(() => {
    const saved = localStorage.getItem('podflow-settings')
    if (saved) {
      const parsed = JSON.parse(saved)
      setSkipAds(parsed.skipAds ?? true)
      setModel(parsed.model ?? 'google/gemini-2.5-flash')
      setApiKey(parsed.apiKey ?? '')
    }
    try {
      const nowPlaying = JSON.parse(localStorage.getItem('podflow-now-playing') ?? 'null') as { episode?: Episode; position?: number } | null
      if (nowPlaying?.episode?.audioUrl) {
        pendingResumeRef.current = { id: nowPlaying.episode.id, position: nowPlaying.position ?? 0 }
        setActiveEpisode(nowPlaying.episode)
      }
    } catch { /* Ignore malformed local playback state. */ }
  }, [])

  useEffect(() => {
    localStorage.setItem('podflow-downloads', JSON.stringify(downloadedEpisodes))
    void refreshStorageUsage()
  }, [downloadedEpisodes])

  useEffect(() => {
    localStorage.setItem('podflow-followed-shows', JSON.stringify(followedShows))
    let cancelled = false
    if (!followedShows.length) {
      setTimelineEpisodes([])
      return
    }
    Promise.all(followedShows.map((show) => getShowEpisodes(show.id).catch(() => []))).then((episodeLists) => {
      if (!cancelled) {
        setTimelineEpisodes(episodeLists.flat().sort((a, b) =>
          new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime()
        ))
      }
    })
    return () => { cancelled = true }
  }, [followedShows])

  useEffect(() => {
    if (!('caches' in window)) return
    caches.open(downloadCacheName).then(async (cache) => {
      const retained = []
      for (const episode of downloadedEpisodes) {
        const source = playbackUrl(episode)
        if (source && await cache.match(source)) retained.push(episode)
      }
      if (retained.length !== downloadedEpisodes.length) setDownloadedEpisodes(retained)
    }).catch(() => undefined)
  // Intentionally reconcile once at startup; the cache is updated directly by downloads.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

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
    const previousAudio = audioRef.current
    previousAudio?.pause()
    setPlaying(false); setCurrentTime(0); setAudioDuration(0)
    const episode = activeEpisode
    const source = episode ? playbackUrl(episode) : undefined
    if (!source) { audioRef.current = null; return }
    const audio = new Audio(source)
    audio.preload = 'metadata'
    let lastPersisted = 0
    audio.addEventListener('loadedmetadata', () => {
      setAudioDuration(audio.duration)
      const resume = pendingResumeRef.current
      if (resume && resume.id === episode?.id && resume.position > 0 && resume.position < audio.duration) {
        audio.currentTime = resume.position
        setCurrentTime(resume.position)
      }
      pendingResumeRef.current = null
    })
    audio.addEventListener('timeupdate', () => {
      setCurrentTime(audio.currentTime)
      if (Math.abs(audio.currentTime - lastPersisted) >= 5) {
        lastPersisted = audio.currentTime
        localStorage.setItem('podflow-now-playing', JSON.stringify({ version: 1, episode, position: audio.currentTime, updatedAt: Date.now() }))
      }
    })
    audio.addEventListener('play', () => setPlaying(true))
    audio.addEventListener('pause', () => setPlaying(false))
    audio.addEventListener('ended', () => setPlaying(false))
    audio.addEventListener('error', () => {
      setPlaying(false)
      setToast('This publisher does not allow playback in the browser.')
    })
    audioRef.current = audio
    return () => audio.pause()
  }, [activeEpisode])

  useEffect(() => {
    if (!activeEpisode || !('mediaSession' in navigator)) return
    navigator.mediaSession.metadata = new MediaMetadata({
      title: activeEpisode.title,
      artist: activeEpisode.author,
      album: activeEpisode.show,
      artwork: activeEpisode.artwork ? [{ src: activeEpisode.artwork, sizes: '600x600', type: 'image/jpeg' }] : [],
    })
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
    if (audioDuration && Number.isFinite(audioDuration)) {
      try { navigator.mediaSession.setPositionState({ duration: audioDuration, position: Math.min(currentTime, audioDuration) }) } catch { /* Unsupported media session detail. */ }
    }
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try { navigator.mediaSession.setActionHandler(action, handler) } catch { /* Unsupported action. */ }
    }
    setHandler('play', () => { void audioRef.current?.play() })
    setHandler('pause', () => audioRef.current?.pause())
    setHandler('seekbackward', (details) => seekTo(Math.max(0, (audioRef.current?.currentTime ?? 0) - (details.seekOffset ?? 15))))
    setHandler('seekforward', (details) => seekTo(Math.min(audioRef.current?.duration ?? 0, (audioRef.current?.currentTime ?? 0) + (details.seekOffset ?? 30))))
    setHandler('seekto', (details) => details.seekTime !== undefined && seekTo(details.seekTime))
  }, [activeEpisode, playing, currentTime, audioDuration])

  const selectEpisode = (episode: Episode) => {
    setActiveEpisode(episode)
  }
  const downloadEpisode = async (episode: Episode) => {
    const source = playbackUrl(episode)
    if (!source || !('caches' in window)) { setToast('Offline downloads are not available in this browser.'); return }
    const isDownloaded = downloadedEpisodes.some((item) => item.id === episode.id)
    if (isDownloaded) {
      await caches.open(downloadCacheName).then((cache) => cache.delete(source))
      setDownloadedEpisodes((items) => items.filter((item) => item.id !== episode.id))
      void refreshStorageUsage()
      setToast('Removed downloaded episode')
      return
    }
    setDownloading((items) => [...items, episode.id])
    try {
      void navigator.storage?.persist?.()
      const response = await fetch(source)
      if (!response.ok) throw new Error('Unable to fetch audio')
      await caches.open(downloadCacheName).then((cache) => cache.put(source, response.clone()))
      const downloadBytes = Number(response.headers.get('content-length') ?? 0)
      setDownloadedEpisodes((items) => [...items.filter((item) => item.id !== episode.id), { ...episode, downloadBytes }])
      void refreshStorageUsage()
      setToast(`Downloaded ${formatBytes(downloadBytes)} for offline listening`)
    } catch {
      setToast('This episode could not be downloaded. Please try another publisher.')
    } finally {
      setDownloading((items) => items.filter((id) => id !== episode.id))
    }
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
    if (activeEpisode) localStorage.setItem('podflow-now-playing', JSON.stringify({ version: 1, episode: activeEpisode, position: time, updatedAt: Date.now() }))
  }
  const toggleFollowShow = (show: PodcastShow) => {
    const isFollowed = followedShows.some((item) => item.id === show.id)
    setFollowedShows((shows) => isFollowed ? shows.filter((item) => item.id !== show.id) : [...shows, show])
    setSearch('')
    setToast(isFollowed ? `Unfollowed ${show.name}` : `Following ${show.name}`)
  }
  const saveSettings = () => {
    localStorage.setItem('podflow-settings', JSON.stringify({ skipAds, model, apiKey }))
    setToast('Ad skip settings saved')
    setTimeout(() => setToast(''), 2300)
  }

  const downloaded = downloadedEpisodes.map((episode) => episode.id)

  return <main>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Headphones size={20}/></span><span>podflow</span></div>
      <nav>{([
        ['Home', Home], ['Library', Library], ['Downloads', Download]
      ] as const).map(([name, Icon]) => <button key={name} className={tab === name ? 'nav-active' : ''} onClick={() => setTab(name)}>
        <Icon size={19}/>{name === 'Library' ? 'Timeline' : name}
      </button>)}</nav>
      <div className="sidebar-bottom">
        <button className={tab === 'Settings' ? 'nav-active' : ''} onClick={() => setTab('Settings')}><Settings size={19}/>Settings</button>
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
            {searchStatus === 'idle' && <>{searchResults.shows.length > 0 && <><span className="result-label">SHOWS · TAP TO FOLLOW</span>{searchResults.shows.map(show => <button className="show-result" key={show.id} onClick={() => toggleFollowShow(show)}><Art artwork={show.artwork} label={show.name}/><span><b>{show.name}</b><small>{show.author}{show.genres[0] ? ` · ${show.genres[0]}` : ''}</small></span><strong className={followedShows.some(item => item.id === show.id) ? 'following-mark' : ''}>{followedShows.some(item => item.id === show.id) ? 'Following' : <Plus size={16}/>}</strong></button>)}</>}
            {searchResults.episodes.length > 0 && <><span className="result-label">EPISODES</span>{searchResults.episodes.slice(0, 4).map(episode => <button className="show-result" key={episode.id} onClick={() => { selectEpisode(episode); setSearch('') }}><Art artwork={episode.artwork} label={episode.show}/><span><b>{episode.title}</b><small>{episode.show} · {episode.duration}</small></span></button>)}</>}
            {!searchResults.shows.length && !searchResults.episodes.length && <p className="search-state">No playable podcasts found.</p>}</>}
          </div>}
        </div>
        <button className="icon-button"><Bell size={20}/><i /></button>
        <div className="avatar small">JT</div>
      </header>

      {tab === 'Home' && <HomeView shows={followedShows} onSelect={() => setTab('Library')} onUnfollow={toggleFollowShow} />}
      {tab === 'Library' && <LibraryView episodes={timelineEpisodes} onSelect={selectEpisode} downloaded={downloaded} onDownload={downloadEpisode} downloading={downloading} search="" timeline />}
      {tab === 'Downloads' && <LibraryView episodes={downloadedEpisodes} onSelect={selectEpisode} downloaded={downloaded} onDownload={downloadEpisode} downloading={downloading} search="" downloads storageUsage={storageUsage}/>}
      {tab === 'Settings' && <SettingsPanel embedded apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} skipAds={skipAds} setSkipAds={setSkipAds} onSave={saveSettings}/>}
    </section>

    <PlayerBar episode={activeEpisode} playing={playing} onPlay={togglePlayback} currentTime={currentTime} duration={audioDuration} onSeek={seekTo} onOpen={() => setPlayerOpen(true)} />
    {playerOpen && activeEpisode && <FullPlayer episode={activeEpisode} playing={playing} onPlay={togglePlayback} currentTime={currentTime} duration={audioDuration} onSeek={seekTo} onClose={() => setPlayerOpen(false)} />}
    <div className="mobile-nav">{([
      ['Home', Home], ['Library', Library], ['Downloads', Download], ['Settings', Settings]
    ] as const).map(([name, Icon]) => <button key={name} onClick={() => setTab(name)} className={tab === name ? 'active' : ''}><Icon size={19}/><span>{name === 'Library' ? 'Timeline' : name}</span></button>)}</div>
    {toast && <div className="toast"><Sparkles size={17}/>{toast}</div>}
  </main>
}

function HomeView({ shows, onSelect, onUnfollow }: { shows: PodcastShow[]; onSelect: (show: PodcastShow) => void; onUnfollow: (show: PodcastShow) => void }) {
  if (!shows.length) return <div className="page empty-following"><span className="empty-mark"><Search size={25}/></span><h1>Find your first show</h1><p>Use search to follow podcasts. Their latest episodes will appear in your Timeline.</p></div>
  return <div className="page followed-home"><div className="eyebrow">YOUR LIBRARY</div><h1>Followed shows</h1><p className="subcopy">New episodes from these shows appear in Timeline.</p><div className="show-grid">{shows.map(show => <div className="show-card" key={show.id}><button className="show-card-main" onClick={() => onSelect(show)}><Art artwork={show.artwork} label={show.name}/><span><b>{show.name}</b><small>{show.author}</small></span><ChevronDown size={17}/></button><button className="unfollow" onClick={() => onUnfollow(show)} aria-label={`Unfollow ${show.name}`}>Following</button></div>)}</div></div>
}

function LibraryView({ episodes, onSelect, downloaded, onDownload, downloading, search, downloads, timeline, storageUsage }: { episodes: Episode[]; onSelect: (e: Episode) => void; downloaded: string[]; onDownload: (episode: Episode) => void; downloading: string[]; search: string; downloads?: boolean; timeline?: boolean; storageUsage?: { usage: number; quota: number } }) {
  const downloadedBytes = episodes.reduce((total, episode) => total + (episode.downloadBytes ?? 0), 0)
  const emptyText = timeline ? 'Follow podcasts using search to build your episode Timeline.' : 'Save episodes to listen without an internet connection.'
  return <div className="page library-page"><div className="eyebrow">{downloads ? 'OFFLINE LISTENING' : timeline ? 'FROM YOUR SHOWS' : 'YOUR LIBRARY'}</div><h1>{downloads ? 'Downloads' : timeline ? 'Timeline' : search ? `Results for “${search}”` : 'Latest episodes'}</h1><p className="subcopy">{downloads ? 'Saved on this device. Ready whenever you are.' : timeline ? 'The newest episodes from your followed podcasts.' : 'New releases from the shows you follow.'}</p>{downloads && <div className="storage-card"><div><b>{episodes.length} {episodes.length === 1 ? 'episode' : 'episodes'} downloaded</b><span>Podflow audio: {formatBytes(downloadedBytes)}</span></div><div><b>{formatBytes(storageUsage?.usage ?? 0)} used by this app</b><span>{storageUsage?.quota ? `${formatBytes(Math.max(0, storageUsage.quota - storageUsage.usage))} available to Podflow` : 'Browser storage estimate unavailable'}</span></div></div>}{episodes.length ? <EpisodeList episodes={episodes} onSelect={onSelect} downloaded={downloaded} onDownload={onDownload} downloading={downloading} expandable={timeline}/> : <div className="empty"><Library size={30}/><h3>{timeline ? 'Your Timeline is ready' : 'Nothing downloaded yet'}</h3><p>{emptyText}</p></div>}</div>
}

function EpisodeList({ episodes, onSelect, downloaded, onDownload, downloading, compact = false, expandable = false }: { episodes: Episode[]; onSelect: (e: Episode) => void; downloaded: string[]; onDownload: (episode: Episode) => void; downloading: string[]; compact?: boolean; expandable?: boolean }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  if (!episodes.length) return <div className="empty"><Download size={30}/><h3>Nothing downloaded yet</h3><p>Save episodes to listen without an internet connection.</p></div>
  return <div className={`episode-list ${compact ? 'compact' : ''}`}>{episodes.map(e => {
    const expanded = expandedId === e.id
    return <article className={`episode-row ${expanded ? 'expanded' : ''}`} key={e.id} onClick={() => expandable ? setExpandedId(expanded ? null : e.id) : onSelect(e)}><Art artwork={e.artwork} label={e.show}/><div className="episode-info"><span>{e.show}</span><h3>{e.title}</h3><p>{e.date} · {e.duration}{downloaded.includes(e.id) && e.downloadBytes ? ` · ${formatBytes(e.downloadBytes)}` : ''}</p>{expanded && <div className="episode-details"><p>{e.description || 'Episode details are not available from this publisher.'}</p><div><button className="detail-play" onClick={event => { event.stopPropagation(); onSelect(e) }}><Play size={15} fill="currentColor"/>Play episode</button><span>{e.author} · {e.date}</span></div></div>}</div><button className={`download ${downloaded.includes(e.id) ? 'done' : ''}`} disabled={downloading.includes(e.id)} onClick={event => { event.stopPropagation(); onDownload(e) }} aria-label={downloaded.includes(e.id) ? 'Remove download' : 'Download episode'}>{downloading.includes(e.id) ? <Clock3 size={18}/> : <Download size={19}/>}</button>{expandable ? <ChevronDown className={expanded ? 'chevron-up' : ''} size={18}/> : <button className="more" onClick={event => event.stopPropagation()}><MoreHorizontal size={20}/></button>}</article>
  })}</div>
}

function PlayerBar({ episode, playing, onPlay, currentTime, duration, onSeek, onOpen }: { episode: Episode | null; playing: boolean; onPlay: () => void; currentTime: number; duration: number; onSeek: (time: number) => void; onOpen: () => void }) {
  if (!episode) return null
  return <div className="player-bar"><button className="now" onClick={onOpen} aria-label="Open full player"><Art artwork={episode.artwork} label={episode.show}/><div><b>{episode.title}</b><span>{episode.show}</span></div></button><div className="controls"><button onClick={() => onSeek(Math.max(0, currentTime - 15))} aria-label="Back 15 seconds"><SkipForward className="flip" size={19}/></button><button className="player-play" onClick={onPlay}>{playing ? <Pause fill="currentColor" size={18}/> : <Play fill="currentColor" size={18}/>}</button><button onClick={() => onSeek(Math.min(duration, currentTime + 30))} aria-label="Forward 30 seconds"><SkipForward size={19}/></button></div><div className="track"><span>{formatTime(currentTime)}</span><input aria-label="Playback progress" type="range" min="0" max={duration || 1} value={Math.min(currentTime, duration || 1)} onChange={e => onSeek(Number(e.target.value))}/><span>{duration ? formatTime(duration) : episode.duration}</span></div><button className="speed">1×</button></div>
}

function FullPlayer({ episode, playing, onPlay, currentTime, duration, onSeek, onClose }: { episode: Episode; playing: boolean; onPlay: () => void; currentTime: number; duration: number; onSeek: (time: number) => void; onClose: () => void }) {
  return <div className="full-player-backdrop" onClick={onClose}><section className="full-player" role="dialog" aria-modal="true" aria-label="Player controls" onClick={event => event.stopPropagation()}><i className="sheet-handle"/><button className="close full-close" onClick={onClose} aria-label="Close player"><X/></button><span className="show-name">{episode.show}</span><h2>{episode.title}</h2><div className="full-track"><input aria-label="Playback progress" type="range" min="0" max={duration || 1} value={Math.min(currentTime, duration || 1)} onChange={e => onSeek(Number(e.target.value))}/><span>{formatTime(currentTime)}</span><span>{duration ? formatTime(duration) : episode.duration}</span></div><div className="full-controls"><button onClick={() => onSeek(Math.max(0, currentTime - 15))} aria-label="Back 15 seconds"><SkipForward className="flip" size={28}/><small>15</small></button><button className="full-play" onClick={onPlay}>{playing ? <Pause fill="currentColor" size={30}/> : <Play fill="currentColor" size={30}/>}</button><button onClick={() => onSeek(Math.min(duration, currentTime + 30))} aria-label="Forward 30 seconds"><SkipForward size={28}/><small>30</small></button></div></section></div>
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return '0:00'
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`
}

function formatBytes(bytes: number) {
  if (!bytes) return 'size unavailable'
  const units = ['B', 'KB', 'MB', 'GB']
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** unit).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`
}

function SettingsPanel({ apiKey, setApiKey, model, setModel, skipAds, setSkipAds, onSave, embedded = false }: { apiKey: string; setApiKey: (v: string) => void; model: string; setModel: (v: string) => void; skipAds: boolean; setSkipAds: (v: boolean) => void; onSave: () => void; embedded?: boolean }) {
  return <div className={`settings-panel ${embedded ? 'embedded' : ''}`}><div className="settings-head"><div className="settings-icon"><WandSparkles size={22}/></div><div><h2>Smart ad skipping</h2><p>Let AI find and skip ads in your downloads.</p></div></div><div className="settings-card"><div className="setting-row"><div><b>Automatically skip ads</b><p>Skip detected ad breaks during playback.</p></div><button className={skipAds ? 'toggle on' : 'toggle'} onClick={() => setSkipAds(!skipAds)}><i/></button></div><hr/><label>OpenRouter API key <a href="https://openrouter.ai/keys" target="_blank">Get an API key ↗</a><input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-v1-••••••••••••••••" type="password"/></label><div className="key-note"><Sparkles size={15}/><span>Your key stays on this device and is only used to analyse downloaded transcripts.</span></div><label>Analysis model <a href="https://openrouter.ai/models" target="_blank">Compare models ↗</a><select value={model} onChange={e => setModel(e.target.value)}><option value="google/gemini-2.5-flash">Gemini 2.5 Flash — recommended</option><option value="openai/gpt-4.1-mini">GPT-4.1 mini — precise</option><option value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku — nuanced</option></select></label><div className="credit"><span>OpenRouter credit</span><strong>{apiKey ? 'Connect to check balance' : 'Add your key to check balance'}</strong></div></div><button className="save-settings" onClick={onSave}>Save settings</button></div>
}

export default App
