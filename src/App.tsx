import { useEffect, useRef, useState } from 'react'
import {
  Bell, ChevronDown, Clock3, Download, Headphones, Home,
  Library, MoreHorizontal, Pause, Play, Plus, RotateCcw, RotateCw, Search,
  Settings, Sparkles, WandSparkles
} from 'lucide-react'
import { getShowEpisodes, playbackUrl, searchCatalog, type Episode, type PodcastShow } from './podcastApi'
import {
  checkOpenRouterKey,
  detectAdSegments,
  formatCredits,
  formatMinutesSaved,
  parseDurationToSeconds,
  type AdSegment,
  type KeyStatus,
} from './openRouter'
import { forceAppUpdate } from './pwa'

type AdSegmentMap = Record<string, AdSegment[]>

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
  const [storageUsage, setStorageUsage] = useState({ usage: 0, quota: 0 })
  const [adSegmentsByEpisode, setAdSegmentsByEpisode] = useState<AdSegmentMap>(() => {
    try { return JSON.parse(localStorage.getItem('podflow-ad-segments') ?? '{}') as AdSegmentMap }
    catch { return {} }
  })
  const [secondsSaved, setSecondsSaved] = useState(() => {
    const saved = Number(localStorage.getItem('podflow-seconds-saved') ?? 0)
    return Number.isFinite(saved) ? saved : 0
  })
  const [detectingAds, setDetectingAds] = useState<string[]>([])
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingResumeRef = useRef<{ id: string; position: number } | null>(null)
  const skipAdsRef = useRef(skipAds)
  const adSegmentsRef = useRef<AdSegment[]>([])
  const skippedAdKeysRef = useRef<Set<string>>(new Set())
  const activeEpisodeIdRef = useRef<string | null>(null)
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
    localStorage.setItem('podflow-ad-segments', JSON.stringify(adSegmentsByEpisode))
  }, [adSegmentsByEpisode])

  useEffect(() => {
    localStorage.setItem('podflow-seconds-saved', String(secondsSaved))
  }, [secondsSaved])

  useEffect(() => {
    skipAdsRef.current = skipAds
  }, [skipAds])

  useEffect(() => {
    adSegmentsRef.current = activeEpisode ? (adSegmentsByEpisode[activeEpisode.id] ?? []) : []
  }, [activeEpisode, adSegmentsByEpisode])

  useEffect(() => {
    skippedAdKeysRef.current = new Set()
    activeEpisodeIdRef.current = activeEpisode?.id ?? null
  }, [activeEpisode?.id])

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

    let cancelled = false
    let objectUrl: string | null = null
    let audio: HTMLAudioElement | null = null

    const attachAudio = (playableUrl: string) => {
      if (cancelled) return
      audio = new Audio(playableUrl)
      audio.preload = 'metadata'
      let lastPersisted = 0
      audio.addEventListener('loadedmetadata', () => {
        if (!audio) return
        setAudioDuration(audio.duration)
        const resume = pendingResumeRef.current
        let position = 0
        if (resume && resume.id === episode?.id && resume.position > 0 && resume.position < audio.duration) {
          position = resume.position
        }
        pendingResumeRef.current = null
        if (skipAdsRef.current) {
          const hit = adSegmentsRef.current.find((segment) => position >= segment.start && position < segment.end - 0.35)
          if (hit) position = hit.end
        }
        if (position > 0) {
          audio.currentTime = position
          setCurrentTime(position)
        }
      })
      audio.addEventListener('timeupdate', () => {
        if (!audio) return
        let time = audio.currentTime
        if (skipAdsRef.current) {
          const hit = adSegmentsRef.current.find((segment) => time >= segment.start && time < segment.end - 0.35)
          if (hit) {
            const skipped = Math.max(0, hit.end - time)
            const skipKey = `${activeEpisodeIdRef.current}:${hit.start}-${hit.end}`
            audio.currentTime = hit.end
            time = hit.end
            if (skipped > 0.5 && !skippedAdKeysRef.current.has(skipKey)) {
              skippedAdKeysRef.current.add(skipKey)
              setSecondsSaved((total) => total + skipped)
              setToast(`Skipped ${formatMinutesSaved(skipped)} of ads`)
            }
          }
        }
        setCurrentTime(time)
        if (Math.abs(time - lastPersisted) >= 5) {
          lastPersisted = time
          localStorage.setItem('podflow-now-playing', JSON.stringify({ version: 1, episode, position: time, updatedAt: Date.now() }))
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
    }

    const resolvePlayableUrl = async () => {
      if ('caches' in window) {
        try {
          const cached = await caches.open(downloadCacheName).then((cache) => cache.match(source))
          if (cancelled) return
          if (cached) {
            objectUrl = URL.createObjectURL(await cached.blob())
            attachAudio(objectUrl)
            return
          }
        } catch {
          /* Fall through to network playback. */
        }
      }
      if (!cancelled) attachAudio(source)
    }

    void resolvePlayableUrl()

    return () => {
      cancelled = true
      audio?.pause()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
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
    let next = time
    if (skipAdsRef.current && activeEpisode) {
      const segments = adSegmentsRef.current.length
        ? adSegmentsRef.current
        : (adSegmentsByEpisode[activeEpisode.id] ?? [])
      const hit = segments.find((segment) => next >= segment.start && next < segment.end - 0.35)
      if (hit) {
        const skipped = Math.max(0, hit.end - next)
        const skipKey = `${activeEpisode.id}:${hit.start}-${hit.end}`
        next = hit.end
        if (skipped > 0.5 && !skippedAdKeysRef.current.has(skipKey)) {
          skippedAdKeysRef.current.add(skipKey)
          setSecondsSaved((total) => total + skipped)
          setToast(`Skipped ${formatMinutesSaved(skipped)} of ads`)
        }
      }
    }
    if (audioRef.current) audioRef.current.currentTime = next
    setCurrentTime(next)
    if (activeEpisode) localStorage.setItem('podflow-now-playing', JSON.stringify({ version: 1, episode: activeEpisode, position: next, updatedAt: Date.now() }))
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
  }
  const testOpenRouterConnection = async () => {
    try {
      const status = await checkOpenRouterKey(apiKey)
      setKeyStatus(status)
      localStorage.setItem('podflow-settings', JSON.stringify({ skipAds, model, apiKey }))
      setToast(`Connected to OpenRouter · ${formatCredits(status.limitRemaining)}`)
    } catch (error) {
      setKeyStatus(null)
      setToast(error instanceof Error ? error.message : 'Could not connect to OpenRouter.')
    }
  }
  const highlightAds = async (episode: Episode) => {
    if (detectingAds.includes(episode.id)) return
    if (!apiKey.trim()) {
      setToast('Add an OpenRouter API key in Settings first.')
      setTab('Settings')
      return
    }
    setDetectingAds((items) => [...items, episode.id])
    setToast(`Detecting ads in “${episode.title}”…`)
    try {
      let durationSeconds = (activeEpisode?.id === episode.id && audioDuration > 0)
        ? audioDuration
        : parseDurationToSeconds(episode.duration)
      if (!durationSeconds) {
        durationSeconds = await probeEpisodeDuration(episode)
      }
      if (!durationSeconds) {
        throw new Error('Episode duration is needed before ads can be detected.')
      }
      const segments = await detectAdSegments({
        apiKey,
        model,
        title: episode.title,
        show: episode.show,
        description: episode.description,
        durationSeconds,
      })
      setAdSegmentsByEpisode((current) => ({ ...current, [episode.id]: segments }))
      setToast(segments.length
        ? `Marked ${segments.length} ad ${segments.length === 1 ? 'segment' : 'segments'} on the progress bar`
        : 'No ad segments found for this episode')
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Ad detection failed.')
    } finally {
      setDetectingAds((items) => items.filter((id) => id !== episode.id))
    }
  }

  const downloaded = downloadedEpisodes.map((episode) => episode.id)
  const activeAdSegments = activeEpisode ? (adSegmentsByEpisode[activeEpisode.id] ?? []) : []

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
      {tab === 'Downloads' && <LibraryView episodes={downloadedEpisodes} onSelect={selectEpisode} downloaded={downloaded} onDownload={downloadEpisode} downloading={downloading} search="" downloads storageUsage={storageUsage} adSegmentsByEpisode={adSegmentsByEpisode} detectingAds={detectingAds} onDetectAds={highlightAds} secondsSaved={secondsSaved}/>}
      {tab === 'Settings' && <SettingsPanel embedded apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} skipAds={skipAds} setSkipAds={setSkipAds} onSave={saveSettings} onToast={setToast} onTestConnection={testOpenRouterConnection} keyStatus={keyStatus} secondsSaved={secondsSaved}/>}
    </section>

    <PlayerBar episode={activeEpisode} playing={playing} onPlay={togglePlayback} currentTime={currentTime} duration={audioDuration} onSeek={seekTo} adSegments={activeAdSegments} />
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

function LibraryView({ episodes, onSelect, downloaded, onDownload, downloading, search, downloads, timeline, storageUsage, adSegmentsByEpisode, detectingAds, onDetectAds, secondsSaved }: { episodes: Episode[]; onSelect: (e: Episode) => void; downloaded: string[]; onDownload: (episode: Episode) => void; downloading: string[]; search: string; downloads?: boolean; timeline?: boolean; storageUsage?: { usage: number; quota: number }; adSegmentsByEpisode?: AdSegmentMap; detectingAds?: string[]; onDetectAds?: (episode: Episode) => void; secondsSaved?: number }) {
  const downloadedBytes = episodes.reduce((total, episode) => total + (episode.downloadBytes ?? 0), 0)
  const emptyText = timeline ? 'Follow podcasts using search to build your episode Timeline.' : 'Save episodes to listen without an internet connection.'
  return <div className="page library-page"><div className="eyebrow">{downloads ? 'OFFLINE LISTENING' : timeline ? 'FROM YOUR SHOWS' : 'YOUR LIBRARY'}</div><h1>{downloads ? 'Downloads' : timeline ? 'Timeline' : search ? `Results for “${search}”` : 'Latest episodes'}</h1><p className="subcopy">{downloads ? 'Saved on this device. Ready whenever you are.' : timeline ? 'The newest episodes from your followed podcasts.' : 'New releases from the shows you follow.'}</p>{downloads && <div className="storage-card"><div><b>{episodes.length} {episodes.length === 1 ? 'episode' : 'episodes'} downloaded</b><span>Podflow audio: {formatBytes(downloadedBytes)}</span></div><div><b>{formatBytes(storageUsage?.usage ?? 0)} used by this app</b><span>{storageUsage?.quota ? `${formatBytes(Math.max(0, storageUsage.quota - storageUsage.usage))} available to Podflow` : 'Browser storage estimate unavailable'}</span></div><div><b>{formatMinutesSaved(secondsSaved ?? 0)} saved</b><span>Ad time skipped on this device</span></div></div>}{episodes.length ? <EpisodeList episodes={episodes} onSelect={onSelect} downloaded={downloaded} onDownload={onDownload} downloading={downloading} expandable={timeline} showAdActions={downloads} adSegmentsByEpisode={adSegmentsByEpisode} detectingAds={detectingAds} onDetectAds={onDetectAds}/> : <div className="empty"><Library size={30}/><h3>{timeline ? 'Your Timeline is ready' : 'Nothing downloaded yet'}</h3><p>{emptyText}</p></div>}</div>
}

function EpisodeList({ episodes, onSelect, downloaded, onDownload, downloading, compact = false, expandable = false, showAdActions = false, adSegmentsByEpisode, detectingAds = [], onDetectAds }: { episodes: Episode[]; onSelect: (e: Episode) => void; downloaded: string[]; onDownload: (episode: Episode) => void; downloading: string[]; compact?: boolean; expandable?: boolean; showAdActions?: boolean; adSegmentsByEpisode?: AdSegmentMap; detectingAds?: string[]; onDetectAds?: (episode: Episode) => void }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  if (!episodes.length) return <div className="empty"><Download size={30}/><h3>Nothing downloaded yet</h3><p>Save episodes to listen without an internet connection.</p></div>
  return <div className={`episode-list ${compact ? 'compact' : ''}`}>{episodes.map(e => {
    const expanded = expandedId === e.id
    const segments = adSegmentsByEpisode?.[e.id] ?? []
    const detecting = detectingAds.includes(e.id)
    return <article className={`episode-row ${expanded ? 'expanded' : ''}`} key={e.id} onClick={() => expandable ? setExpandedId(expanded ? null : e.id) : onSelect(e)}><Art artwork={e.artwork} label={e.show}/><div className="episode-info"><span>{e.show}</span><h3>{e.title}</h3><p>{e.date} · {e.duration}{downloaded.includes(e.id) && e.downloadBytes ? ` · ${formatBytes(e.downloadBytes)}` : ''}{segments.length ? ` · ${segments.length} ad ${segments.length === 1 ? 'mark' : 'marks'}` : ''}</p>{expanded && <div className="episode-details"><p>{e.description || 'Episode details are not available from this publisher.'}</p><div><button className="detail-play" onClick={event => { event.stopPropagation(); onSelect(e) }}><Play size={15} fill="currentColor"/>Play episode</button><span>{e.author} · {e.date}</span></div></div>}{showAdActions && <div className="episode-ad-actions"><button className={`detect-ads ${segments.length ? 'done' : ''}`} disabled={detecting} onClick={event => { event.stopPropagation(); onDetectAds?.(e) }}>{detecting ? <Clock3 size={15}/> : <WandSparkles size={15}/>}{detecting ? 'Detecting…' : segments.length ? 'Re-scan ads' : 'Highlight ads'}</button></div>}</div><button className={`download ${downloaded.includes(e.id) ? 'done' : ''}`} disabled={downloading.includes(e.id)} onClick={event => { event.stopPropagation(); onDownload(e) }} aria-label={downloaded.includes(e.id) ? 'Remove download' : 'Download episode'}>{downloading.includes(e.id) ? <Clock3 size={18}/> : <Download size={19}/>}</button>{expandable ? <ChevronDown className={expanded ? 'chevron-up' : ''} size={18}/> : <button className="more" onClick={event => event.stopPropagation()}><MoreHorizontal size={20}/></button>}</article>
  })}</div>
}

function PlayerBar({ episode, playing, onPlay, currentTime, duration, onSeek, adSegments }: { episode: Episode | null; playing: boolean; onPlay: () => void; currentTime: number; duration: number; onSeek: (time: number) => void; adSegments: AdSegment[] }) {
  const [expanded, setExpanded] = useState(false)
  if (!episode) return null
  const trackMax = duration || 1
  const progressTrack = (
    <div className="track">
      {expanded && <span>{formatTime(currentTime)}</span>}
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
        <input aria-label="Playback progress" type="range" min="0" max={trackMax} step="0.1" value={Math.min(currentTime, trackMax)} onChange={e => onSeek(Number(e.target.value))}/>
      </div>
      {expanded && <span>{duration ? formatTime(duration) : episode.duration}</span>}
    </div>
  )
  return <div className={`player-bar ${expanded ? 'expanded' : ''}`}>
    {!expanded && <div className="player-progress-slim">{progressTrack}</div>}
    <div className="player-bar-main">
      <button className="now" onClick={() => setExpanded(open => !open)} aria-expanded={expanded} aria-label={expanded ? 'Collapse player' : 'Expand player'}>
        <Art artwork={episode.artwork} label={episode.show}/>
        <div><b>{episode.title}</b><span>{episode.show}{adSegments.length ? ` · ${adSegments.length} ads marked` : ''}</span></div>
        <ChevronDown className={expanded ? 'chevron-up' : ''} size={16}/>
      </button>
      {!expanded && <button className="player-play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause fill="currentColor" size={18}/> : <Play fill="currentColor" size={18}/>}</button>}
    </div>
    {expanded && <div className="player-bar-body">
      {progressTrack}
      <div className="controls">
        <button className="skip-control" onClick={() => onSeek(Math.max(0, currentTime - 15))} aria-label="Back 15 seconds"><RotateCcw size={28} strokeWidth={1.75}/><span>15</span></button>
        <button className="player-play" onClick={onPlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause fill="currentColor" size={22}/> : <Play fill="currentColor" size={22}/>}</button>
        <button className="skip-control" onClick={() => onSeek(Math.min(duration, currentTime + 30))} aria-label="Forward 30 seconds"><RotateCw size={28} strokeWidth={1.75}/><span>30</span></button>
      </div>
    </div>}
  </div>
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

function formatBuildDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function probeEpisodeDuration(episode: Episode): Promise<number | undefined> {
  const source = playbackUrl(episode)
  if (!source) return undefined
  let objectUrl: string | null = null
  try {
    let playable = source
    if ('caches' in window) {
      const cached = await caches.open(downloadCacheName).then((cache) => cache.match(source))
      if (cached) {
        objectUrl = URL.createObjectURL(await cached.blob())
        playable = objectUrl
      }
    }
    const duration = await new Promise<number>((resolve, reject) => {
      const audio = new Audio()
      audio.preload = 'metadata'
      audio.onloadedmetadata = () => resolve(audio.duration)
      audio.onerror = () => reject(new Error('Unable to read episode duration'))
      audio.src = playable
    })
    return Number.isFinite(duration) && duration > 0 ? duration : undefined
  } catch {
    return undefined
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

function SettingsPanel({ apiKey, setApiKey, model, setModel, skipAds, setSkipAds, onSave, onToast, onTestConnection, keyStatus, secondsSaved = 0, embedded = false }: { apiKey: string; setApiKey: (v: string) => void; model: string; setModel: (v: string) => void; skipAds: boolean; setSkipAds: (v: boolean) => void; onSave: () => void; onToast: (message: string) => void; onTestConnection: () => Promise<void>; keyStatus: KeyStatus | null; secondsSaved?: number; embedded?: boolean }) {
  const [updating, setUpdating] = useState(false)
  const [testing, setTesting] = useState(false)

  const handleForceUpdate = async () => {
    if (updating) return
    setUpdating(true)
    onToast('Checking for updates…')
    try {
      await forceAppUpdate()
    } catch {
      onToast('Update check failed. Please try again.')
      setUpdating(false)
    }
  }

  const handleTestConnection = async () => {
    if (testing) return
    setTesting(true)
    try {
      await onTestConnection()
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className={`settings-panel ${embedded ? 'embedded' : ''}`}>
      <div className="settings-head">
        <div className="settings-icon"><WandSparkles size={22}/></div>
        <div>
          <h2>Smart ad skipping</h2>
          <p>Let AI find and skip ads in your downloads.</p>
        </div>
      </div>
      <div className="settings-card">
        <div className="setting-row">
          <div>
            <b>Automatically skip ads</b>
            <p>Skip detected ad breaks during playback.</p>
          </div>
          <button className={skipAds ? 'toggle on' : 'toggle'} onClick={() => setSkipAds(!skipAds)}><i/></button>
        </div>
        <hr/>
        <div className="setting-row">
          <div>
            <b>Minutes saved</b>
            <p>Ad time skipped on this device.</p>
          </div>
          <strong className="saved-stat">{formatMinutesSaved(secondsSaved)}</strong>
        </div>
        <hr/>
        <label>OpenRouter API key <a href="https://openrouter.ai/keys" target="_blank">Get an API key ↗</a>
          <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-v1-••••••••••••••••" type="password"/>
        </label>
        <div className="key-note"><Sparkles size={15}/><span>Your key stays on this device and is used to check the connection and estimate ad breaks in downloads.</span></div>
        <label>Analysis model <a href="https://openrouter.ai/models" target="_blank">Compare models ↗</a>
          <select value={model} onChange={e => setModel(e.target.value)}>
            <option value="google/gemini-2.5-flash">Gemini 2.5 Flash — recommended</option>
            <option value="openai/gpt-4.1-mini">GPT-4.1 mini — precise</option>
            <option value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku — nuanced</option>
          </select>
        </label>
        <div className="credit">
          <span>OpenRouter status</span>
          <strong>{keyStatus ? `Connected · ${formatCredits(keyStatus.limitRemaining)}` : apiKey ? 'Not checked yet' : 'Add your key to connect'}</strong>
        </div>
        <button className="test-connection" onClick={() => void handleTestConnection()} disabled={testing || !apiKey.trim()}>
          {testing ? 'Checking…' : 'Test connection'}
        </button>
      </div>
      <button className="save-settings" onClick={onSave}>Save settings</button>
      <div className="settings-update">
        <button className="force-update" onClick={() => void handleForceUpdate()} disabled={updating}>
          {updating ? 'Updating…' : 'Force update'}
        </button>
        <p className="app-version">Version {__APP_VERSION__} · Updated {formatBuildDate(__BUILD_TIME__)}</p>
      </div>
    </div>
  )
}

export default App
