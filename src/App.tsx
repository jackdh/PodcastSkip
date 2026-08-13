import { useEffect, useRef, useState } from 'react'
import {
  Check, ChevronDown, Copy, Download, Headphones, Home,
  Library, LoaderCircle, Play, Plus, Search,
  Settings, Sparkles, WandSparkles, X
} from 'lucide-react'
import { getShowEpisodes, playbackUrl, searchCatalog, type Episode, type PodcastShow } from './podcastApi'
import {
  checkOpenRouterKey,
  detectAdSegmentsFromAudio,
  excerptAroundSegment,
  formatCredits,
  formatMinutesSaved,
  DEFAULT_ANALYSIS_MODEL,
  DEFAULT_STT_MODEL,
  QWEN_STT_MODEL,
  type AdSegment,
  type KeyStatus,
  type TranscriptCue,
} from './openRouter'
import { applyAppUpdate, dismissAppUpdate, forceAppUpdate, subscribeAppUpdate } from './pwa'
import { PlayerBar } from './Player'
import {
  cuesFromScans,
  deleteTranscript,
  loadAllScans,
  saveScan,
  scanRecordFromCues,
  type CueMap,
  type ScanMap,
} from './transcriptStore'
import { appLog, copyDebugLogs, clearDebugLogs, memorySnapshot } from './appLog'
import { clearStoredApiKey, readStoredSettings, writeStoredSettings } from './settingsStore'
import { adSkipTarget } from './adParse'
import { playbackAdSegments } from './adRefine'
import { isAbortError, rangesFromCues, type TimeRange } from './scanCache'
import { playbackErrorMessage, readNowPlaying, resumePosition, writeNowPlaying } from './playbackState'
import { readJson, readText, writeJson, writeText } from './storage'

type AdSegmentMap = Record<string, AdSegment[]>
const ANALYSE_MINUTE_OPTIONS = [3, 8, 15, 30, 0] as const
const DEFAULT_ANALYSE_MINUTES = 30

type Tab = 'Home' | 'Library' | 'Downloads' | 'Settings'
const TABS: Tab[] = ['Home', 'Library', 'Downloads', 'Settings']
const downloadCacheName = 'podflow-downloads-v1'
const TAB_KEY = 'podflow-tab'

function isTab(value: string): value is Tab {
  return TABS.includes(value as Tab)
}

function Art({ artwork, label, large = false }: { artwork?: string; label: string; large?: boolean }) {
  return <div className={`art ${large ? 'large' : ''}`}>{artwork ? <img src={artwork} alt="" /> : <span>{label.slice(0, 2).toUpperCase()}</span>}</div>
}

function App() {
  const [tab, setTab] = useState<Tab>(() => {
    const saved = readText(TAB_KEY)
    return isTab(saved) ? saved : 'Home'
  })
  const [timelineEpisodes, setTimelineEpisodes] = useState<Episode[]>([])
  const [timelineStatus, setTimelineStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [focusedShowId, setFocusedShowId] = useState<number | null>(null)
  const [activeEpisode, setActiveEpisode] = useState<Episode | null>(null)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [followedShows, setFollowedShows] = useState<PodcastShow[]>(() => {
    return readJson<PodcastShow[]>('podflow-followed-shows', [])
  })
  const [downloadedEpisodes, setDownloadedEpisodes] = useState<Episode[]>(() => {
    return readJson<Episode[]>('podflow-downloads', [])
  })
  const [downloading, setDownloading] = useState<string[]>([])
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<{ shows: PodcastShow[]; episodes: Episode[] }>({ shows: [], episodes: [] })
  const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [storedSettings] = useState(readStoredSettings)
  const [skipAds, setSkipAds] = useState(storedSettings.skipAds ?? true)
  const [apiKey, setApiKey] = useState(storedSettings.apiKey ?? '')
  const [model, setModel] = useState(storedSettings.model ?? DEFAULT_ANALYSIS_MODEL)
  const [sttModel, setSttModel] = useState(storedSettings.sttModel ?? DEFAULT_STT_MODEL)
  const [analyseMinutes, setAnalyseMinutes] = useState(() => {
    const minutes = Number(storedSettings.analyseMinutes)
    return Number.isFinite(minutes) ? minutes : DEFAULT_ANALYSE_MINUTES
  })
  const [playbackRate, setPlaybackRate] = useState(() => {
    const rate = Number(storedSettings.playbackRate)
    return rate > 0 ? rate : 1
  })
  const [volume, setVolume] = useState(() => {
    const stored = Number(storedSettings.volume)
    return stored >= 0 && stored <= 1 ? stored : 1
  })
  const [toast, setToast] = useState('')
  const [currentTime, setCurrentTime] = useState(0)
  const [audioDuration, setAudioDuration] = useState(0)
  const [storageUsage, setStorageUsage] = useState({ usage: 0, quota: 0 })
  const [adSegmentsByEpisode, setAdSegmentsByEpisode] = useState<AdSegmentMap>(() => {
    return readJson<AdSegmentMap>('podflow-ad-segments', {})
  })
  const [scansByEpisode, setScansByEpisode] = useState<ScanMap>({})
  const [secondsSaved, setSecondsSaved] = useState(() => {
    const saved = Number(readText('podflow-seconds-saved', '0'))
    return Number.isFinite(saved) ? saved : 0
  })
  const [detectingAds, setDetectingAds] = useState<string[]>([])
  const [keyStatus, setKeyStatus] = useState<KeyStatus | null>(null)
  const [settingsReady, setSettingsReady] = useState(false)
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [updateReady, setUpdateReady] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pendingResumeRef = useRef<{ id: string; position: number } | null>(null)
  const skipAdsRef = useRef(skipAds)
  const playbackRateRef = useRef(playbackRate)
  const volumeRef = useRef(volume)
  const adSegmentsRef = useRef<AdSegment[]>([])
  const cuesRef = useRef<TranscriptCue[]>([])
  const skippedAdKeysRef = useRef<Set<string>>(new Set())
  const activeEpisodeIdRef = useRef<string | null>(null)
  const wantPlayingRef = useRef(false)
  const scanAbortRef = useRef<Map<string, AbortController>>(new Map())
  const downloadAbortRef = useRef<Map<string, AbortController>>(new Map())
  const downloadingRef = useRef<Set<string>>(new Set())
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const searchWrapRef = useRef<HTMLDivElement | null>(null)
  const refreshStorageUsage = async () => {
    if (!navigator.storage?.estimate) return
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    setStorageUsage({ usage, quota })
  }

  useEffect(() => {
    const saved = readStoredSettings()
    setSkipAds(saved.skipAds ?? true)
    setModel(saved.model ?? DEFAULT_ANALYSIS_MODEL)
    setSttModel(saved.sttModel ?? DEFAULT_STT_MODEL)
    setApiKey(saved.apiKey ?? '')
    const minutes = Number(saved.analyseMinutes)
    setAnalyseMinutes(Number.isFinite(minutes) ? minutes : DEFAULT_ANALYSE_MINUTES)
    const rate = Number(saved.playbackRate)
    setPlaybackRate(rate > 0 ? rate : 1)
    const storedVolume = Number(saved.volume)
    setVolume(storedVolume >= 0 && storedVolume <= 1 ? storedVolume : 1)
    const nowPlaying = readNowPlaying()
    if (nowPlaying?.episode?.audioUrl && !nowPlaying.finished) {
      pendingResumeRef.current = { id: nowPlaying.episode.id, position: nowPlaying.position ?? 0 }
      setActiveEpisode(nowPlaying.episode)
    }
    setSettingsReady(true)
  }, [])

  useEffect(() => {
    if (!settingsReady) return
    try {
      writeStoredSettings({ skipAds, model, sttModel, apiKey, analyseMinutes, playbackRate, volume })
    } catch (error) {
      appLog('error', 'settings persist failed', { message: error instanceof Error ? error.message : String(error) })
    }
  }, [settingsReady, skipAds, model, sttModel, apiKey, analyseMinutes, playbackRate, volume])

  useEffect(() => {
    writeJson('podflow-downloads', downloadedEpisodes)
    void refreshStorageUsage()
  }, [downloadedEpisodes])

  useEffect(() => {
    try {
      writeJson('podflow-ad-segments', adSegmentsByEpisode)
    } catch (error) {
      appLog('error', 'ad segments persist failed', { message: error instanceof Error ? error.message : String(error) })
    }
  }, [adSegmentsByEpisode])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let fromIdb: ScanMap = {}
      try { fromIdb = await loadAllScans() } catch { /* IndexedDB may be blocked. */ }
      let merged = fromIdb
      try {
        const parsed = readJson<CueMap | null>('podflow-transcript-cues', null)
        if (parsed && Object.keys(parsed).length) {
          merged = { ...Object.fromEntries(Object.entries(parsed).map(([id, cues]) => [id, scanRecordFromCues(cues)])), ...fromIdb }
          try { localStorage.removeItem('podflow-transcript-cues') } catch { /* Ignore. */ }
        }
      } catch { /* Ignore a bad legacy cache. */ }
      if (!cancelled) {
        setScansByEpisode((current) => ({ ...merged, ...current }))
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    writeText('podflow-seconds-saved', String(secondsSaved))
  }, [secondsSaved])

  useEffect(() => {
    writeText(TAB_KEY, tab)
  }, [tab])

  useEffect(() => {
    skipAdsRef.current = skipAds
  }, [skipAds])

  useEffect(() => {
    playbackRateRef.current = playbackRate
    if (audioRef.current) audioRef.current.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    volumeRef.current = volume
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  useEffect(() => {
    adSegmentsRef.current = activeEpisode ? (adSegmentsByEpisode[activeEpisode.id] ?? []) : []
    cuesRef.current = activeEpisode ? (cuesFromScans(scansByEpisode)[activeEpisode.id] ?? []) : []
  }, [activeEpisode, adSegmentsByEpisode, scansByEpisode])

  useEffect(() => {
    skippedAdKeysRef.current = new Set()
    activeEpisodeIdRef.current = activeEpisode?.id ?? null
  }, [activeEpisode?.id])

  useEffect(() => {
    writeJson('podflow-followed-shows', followedShows)
    let cancelled = false
    if (!followedShows.length) {
      setTimelineEpisodes([])
      setTimelineStatus('idle')
      setFocusedShowId(null)
      return
    }
    setTimelineStatus('loading')
    Promise.all(followedShows.map((show) =>
      getShowEpisodes(show.id).then((episodes) => ({ ok: true as const, episodes }), () => ({ ok: false as const, episodes: [] as Episode[] })),
    )).then((results) => {
      if (cancelled) return
      setTimelineEpisodes(results.flatMap((result) => result.episodes).sort((a, b) =>
        new Date(b.publishedAt ?? 0).getTime() - new Date(a.publishedAt ?? 0).getTime(),
      ))
      setTimelineStatus(results.some((result) => result.ok) ? 'idle' : 'error')
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
    if (detectingAds.length) return
    const timer = window.setTimeout(() => setToast(''), 4200)
    return () => window.clearTimeout(timer)
  }, [toast, detectingAds])

  useEffect(() => {
    const onOnline = () => setOffline(false)
    const onOffline = () => setOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => subscribeAppUpdate(setUpdateReady), [])

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
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
      if (event.key === 'Escape' && search) setSearch('')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [search])

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!search.trim()) return
      if (searchWrapRef.current && !searchWrapRef.current.contains(event.target as Node)) setSearch('')
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
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
    let recoverAttempts = 0
    let lastPositionState = 0
    let usingCache = false

    const persistPosition = (time: number, finished = false) => {
      if (!episode) return
      writeNowPlaying(episode, time, finished)
    }

    const blobUrlFromCache = async () => {
      if (!('caches' in window)) return null
      try {
        const cached = await caches.open(downloadCacheName).then((cache) => cache.match(source))
        if (!cached) return null
        const blob = await cached.blob()
        const copy = blob.slice(0, blob.size, blob.type || 'audio/mpeg')
        return URL.createObjectURL(copy)
      } catch {
        return null
      }
    }

    const attachAudio = (playableUrl: string, fromCache: boolean) => {
      if (cancelled) return
      audio?.pause()
      usingCache = fromCache
      audio = new Audio(playableUrl)
      audio.preload = fromCache ? 'auto' : 'metadata'
      audio.playbackRate = playbackRateRef.current
      audio.volume = volumeRef.current
      let lastPersisted = 0
      audio.addEventListener('loadedmetadata', () => {
        if (!audio) return
        recoverAttempts = 0
        setAudioDuration(audio.duration)
        const resume = pendingResumeRef.current
        let position = 0
        if (resume && resume.id === episode?.id) {
          position = resumePosition(resume.position, audio.duration)
        }
        pendingResumeRef.current = null
        if (skipAdsRef.current) {
          const skipTo = adSkipTarget(position, playbackAdSegments(adSegmentsRef.current, cuesRef.current))
          if (skipTo != null) position = skipTo
        }
        if (position > 0) {
          audio.currentTime = position
          setCurrentTime(position)
        }
        if (wantPlayingRef.current) {
          void audio.play().catch(() => {
            wantPlayingRef.current = false
            setPlaying(false)
          })
        }
      })
      audio.addEventListener('timeupdate', () => {
        if (!audio) return
        let time = audio.currentTime
        if (skipAdsRef.current) {
          const skipTo = adSkipTarget(time, playbackAdSegments(adSegmentsRef.current, cuesRef.current))
          if (skipTo != null) {
            const skipped = Math.max(0, skipTo - time)
            const skipKey = `${activeEpisodeIdRef.current}:${skipTo}`
            audio.currentTime = skipTo
            time = skipTo
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
          persistPosition(time)
        }
        if ('mediaSession' in navigator && audio.duration && Math.abs(time - lastPositionState) >= 1) {
          lastPositionState = time
          try {
            navigator.mediaSession.setPositionState({
              duration: audio.duration,
              position: Math.min(time, audio.duration),
              playbackRate: audio.playbackRate || 1,
            })
          } catch { /* Unsupported media session detail. */ }
        }
      })
      audio.addEventListener('play', () => setPlaying(true))
      audio.addEventListener('pause', () => {
        setPlaying(false)
        persistPosition(audio?.currentTime ?? 0)
      })
      audio.addEventListener('ended', () => {
        wantPlayingRef.current = false
        setPlaying(false)
        persistPosition(audio?.duration ?? 0, true)
      })
      audio.addEventListener('error', () => {
        setPlaying(false)
        void recoverPlayback('error')
      })
      audioRef.current = audio
    }

    const recoverPlayback = async (reason: string) => {
      if (cancelled || !episode) return
      if (recoverAttempts >= 2) {
        setToast(playbackErrorMessage(usingCache ? 'cached' : 'stream'))
        return
      }
      recoverAttempts += 1
      const position = audio?.currentTime || pendingResumeRef.current?.position || 0
      if (position > 0) pendingResumeRef.current = { id: episode.id, position }
      appLog('warn', 'audio recover', { reason, position, attempt: recoverAttempts })
      const nextUrl = await blobUrlFromCache()
      if (cancelled) return
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      objectUrl = nextUrl
      if (nextUrl) attachAudio(nextUrl, true)
      else if (reason === 'error') setToast(playbackErrorMessage(usingCache ? 'cached' : 'stream'))
      else attachAudio(source, false)
    }

    const onForeground = () => {
      if (document.visibilityState === 'hidden') return
      const current = audioRef.current
      if (!current) return
      const broken = Boolean(current.error) || current.networkState === HTMLMediaElement.NETWORK_NO_SOURCE || current.readyState === 0
      if (broken) void recoverPlayback('foreground')
    }

    const onPageHide = () => {
      const time = audioRef.current?.currentTime ?? 0
      persistPosition(time)
    }

    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('pageshow', onForeground)
    window.addEventListener('pagehide', onPageHide)

    const resolvePlayableUrl = async () => {
      const cachedUrl = await blobUrlFromCache()
      if (cancelled) return
      if (cachedUrl) {
        objectUrl = cachedUrl
        attachAudio(cachedUrl, true)
        return
      }
      attachAudio(source, false)
    }

    void resolvePlayableUrl()

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('pageshow', onForeground)
      window.removeEventListener('pagehide', onPageHide)
      const time = audio?.currentTime ?? 0
      if (episode && time > 0) writeNowPlaying(episode, time)
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
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try { navigator.mediaSession.setActionHandler(action, handler) } catch { /* Unsupported action. */ }
    }
    setHandler('play', () => { wantPlayingRef.current = true; void audioRef.current?.play() })
    setHandler('pause', () => { wantPlayingRef.current = false; audioRef.current?.pause() })
    setHandler('seekbackward', (details) => seekTo(Math.max(0, (audioRef.current?.currentTime ?? 0) - (details.seekOffset ?? 15))))
    setHandler('seekforward', (details) => seekTo(Math.min(audioRef.current?.duration ?? 0, (audioRef.current?.currentTime ?? 0) + (details.seekOffset ?? 30))))
    setHandler('seekto', (details) => details.seekTime !== undefined && seekTo(details.seekTime))
  }, [activeEpisode])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }, [playing])

  const selectEpisode = (episode: Episode) => {
    if (activeEpisode?.id !== episode.id) {
      pendingResumeRef.current = null
      writeNowPlaying(episode, 0)
    }
    setActiveEpisode(episode)
    setPlayerOpen(true)
  }
  const downloadEpisode = async (episode: Episode) => {
    const source = playbackUrl(episode)
    if (!source || !('caches' in window)) { setToast('Offline downloads are not available in this browser.'); return }
    const isDownloaded = downloadedEpisodes.some((item) => item.id === episode.id)
    if (isDownloaded) {
      downloadAbortRef.current.get(episode.id)?.abort()
      await caches.open(downloadCacheName).then((cache) => cache.delete(source))
      setDownloadedEpisodes((items) => items.filter((item) => item.id !== episode.id))
      setAdSegmentsByEpisode((current) => {
        if (!(episode.id in current)) return current
        const next = { ...current }
        delete next[episode.id]
        return next
      })
      setScansByEpisode((current) => {
        if (!(episode.id in current)) return current
        const next = { ...current }
        delete next[episode.id]
        return next
      })
      void deleteTranscript(episode.id)
      void refreshStorageUsage()
      setToast('Removed downloaded episode')
      return
    }
    if (downloadingRef.current.has(episode.id)) {
      downloadAbortRef.current.get(episode.id)?.abort()
      return
    }
    downloadingRef.current.add(episode.id)
    const controller = new AbortController()
    downloadAbortRef.current.set(episode.id, controller)
    setDownloading((items) => [...items, episode.id])
    setDownloadProgress((current) => ({ ...current, [episode.id]: 0 }))
    try {
      void navigator.storage?.persist?.()
      const response = await fetch(source, { signal: controller.signal })
      if (!response.ok) throw new Error(navigator.onLine === false ? 'You are offline. Connect to download this episode.' : 'Unable to fetch audio')
      const total = Number(response.headers.get('content-length') ?? 0)
      let stored: Response = response
      if (response.body) {
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let received = 0
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) {
            chunks.push(value)
            received += value.byteLength
            if (total) setDownloadProgress((current) => ({ ...current, [episode.id]: received / total }))
          }
        }
        const blob = new Blob(chunks as BlobPart[], { type: response.headers.get('content-type') || 'audio/mpeg' })
        stored = new Response(blob, { status: 200, headers: response.headers })
      }
      await caches.open(downloadCacheName).then((cache) => cache.put(source, stored.clone()))
      const downloadBytes = Number(stored.headers.get('content-length') ?? total)
      setDownloadedEpisodes((items) => [...items.filter((item) => item.id !== episode.id), { ...episode, downloadBytes }])
      void refreshStorageUsage()
      setToast(`Downloaded ${formatBytes(downloadBytes)} for offline listening`)
    } catch (error) {
      if (isAbortError(error)) setToast('Download cancelled')
      else setToast(navigator.onLine === false
        ? 'You are offline. Connect to download this episode.'
        : 'This episode could not be downloaded. Please try another publisher.')
    } finally {
      downloadingRef.current.delete(episode.id)
      downloadAbortRef.current.delete(episode.id)
      setDownloading((items) => items.filter((id) => id !== episode.id))
      setDownloadProgress((current) => {
        const next = { ...current }
        delete next[episode.id]
        return next
      })
    }
  }
  const togglePlayback = async () => {
    const audio = audioRef.current
    if (!audio) { setToast('Choose an episode with playable audio first.'); return }
    if (playing) {
      wantPlayingRef.current = false
      audio.pause()
      setPlaying(false)
      if (activeEpisode) writeNowPlaying(activeEpisode, audio.currentTime)
      return
    }
    wantPlayingRef.current = true
    try { await audio.play(); setPlaying(true) }
    catch {
      wantPlayingRef.current = false
      setToast('Playback was blocked. Tap play again to start listening.')
    }
  }
  const seekTo = (time: number, options?: { allowAds?: boolean }) => {
    let next = time
    if (!options?.allowAds && skipAdsRef.current && activeEpisode) {
      const segments = playbackAdSegments(
        adSegmentsRef.current.length
          ? adSegmentsRef.current
          : (adSegmentsByEpisode[activeEpisode.id] ?? []),
        cuesRef.current,
      )
      const skipTo = adSkipTarget(next, segments)
      if (skipTo != null) {
        const skipped = Math.max(0, skipTo - next)
        const skipKey = `${activeEpisode.id}:${skipTo}`
        next = skipTo
        if (skipped > 0.5 && !skippedAdKeysRef.current.has(skipKey)) {
          skippedAdKeysRef.current.add(skipKey)
          setSecondsSaved((total) => total + skipped)
          setToast(`Skipped ${formatMinutesSaved(skipped)} of ads`)
        }
      }
    }
    if (audioRef.current) audioRef.current.currentTime = next
    setCurrentTime(next)
    if (activeEpisode) writeNowPlaying(activeEpisode, next)
  }
  const toggleFollowShow = (show: PodcastShow) => {
    const isFollowed = followedShows.some((item) => item.id === show.id)
    setFollowedShows((shows) => isFollowed ? shows.filter((item) => item.id !== show.id) : [...shows, show])
    if (isFollowed && focusedShowId === show.id) setFocusedShowId(null)
    setSearch('')
    setToast(isFollowed ? `Unfollowed ${show.name}` : `Following ${show.name}`)
  }
  const openShowTimeline = (show: PodcastShow) => {
    setFocusedShowId(show.id)
    setTab('Library')
  }
  const saveSettings = () => {
    writeStoredSettings({ skipAds, model, sttModel, apiKey, analyseMinutes, playbackRate, volume })
    setToast('Ad skip settings saved')
  }
  const removeApiKey = () => {
    setApiKey('')
    setKeyStatus(null)
    clearStoredApiKey()
    setToast('API key removed from this device')
  }
  const testOpenRouterConnection = async () => {
    try {
      const status = await checkOpenRouterKey(apiKey)
      setKeyStatus(status)
      writeStoredSettings({ skipAds, model, sttModel, apiKey, analyseMinutes, playbackRate, volume })
      setToast(`Connected to OpenRouter · ${formatCredits(status.limitRemaining)}`)
    } catch (error) {
      setKeyStatus(null)
      setToast(error instanceof Error ? error.message : 'Could not connect to OpenRouter.')
    }
  }
  const pausePlayback = () => {
    wantPlayingRef.current = false
    audioRef.current?.pause()
    setPlaying(false)
  }
  const cancelHighlight = (episodeId: string) => {
    scanAbortRef.current.get(episodeId)?.abort()
  }
  const persistScan = (episodeId: string, cues: TranscriptCue[], ranges: TimeRange[], duration = 0) => {
    const record = scanRecordFromCues(cues, { sttModel, duration, ranges, updatedAt: Date.now() })
    setScansByEpisode((current) => ({ ...current, [episodeId]: record }))
    void saveScan(episodeId, record).catch(() => undefined)
  }
  const highlightAds = async (episode: Episode, options?: { windowMinutes?: number }) => {
    if (scanAbortRef.current.has(episode.id)) {
      cancelHighlight(episode.id)
      return
    }
    if (!apiKey.trim()) {
      setToast('Add an OpenRouter API key in Settings first.')
      setPlayerOpen(false)
      setTab('Settings')
      return
    }
    const source = playbackUrl(episode)
    if (!source || !('caches' in window)) {
      setToast('Download this episode first so we can analyse the audio.')
      return
    }
    const controller = new AbortController()
    scanAbortRef.current.set(episode.id, controller)
    setDetectingAds((items) => [...items, episode.id])
    const windowMinutes = options?.windowMinutes ?? analyseMinutes
    setToast(`Preparing audio for “${episode.title}”…`)
    appLog('info', 'highlight ads start', {
      title: episode.title,
      show: episode.show,
      id: episode.id,
      analyseMinutes: windowMinutes,
      model,
      sttModel,
      memory: memorySnapshot(),
    })
    try {
      const cached = await caches.open(downloadCacheName).then((cache) => cache.match(source))
      if (!cached) throw new Error('Download this episode first so we can analyse the audio.')
      const audioBlob = await cached.blob()
      appLog('info', 'highlight ads blob', { bytes: audioBlob.size, type: audioBlob.type || 'unknown', memory: memorySnapshot() })
      const windowLabel = windowMinutes > 0 ? `the first ${windowMinutes} minutes` : 'the full episode'
      setToast(`Analysing ${windowLabel} of “${episode.title}”…`)
      const existing = scansByEpisode[episode.id]
      const reuseCache = existing && (!existing.sttModel || existing.sttModel === sttModel)
      const { segments, cues, ranges } = await detectAdSegmentsFromAudio({
        apiKey,
        model,
        sttModel,
        title: episode.title,
        show: episode.show,
        description: episode.description,
        audioBlob,
        maxMinutes: windowMinutes > 0 ? windowMinutes : undefined,
        existingCues: reuseCache ? existing.cues : undefined,
        existingRanges: reuseCache ? existing.ranges : undefined,
        signal: controller.signal,
        onProgress: (message) => setToast(message),
        onPartial: (update) => persistScan(episode.id, update.cues, update.ranges),
      })
      persistScan(episode.id, cues, ranges.length ? ranges : rangesFromCues(cues))
      setAdSegmentsByEpisode((current) => ({ ...current, [episode.id]: segments }))
      setActiveEpisode(episode)
      setPlayerOpen(true)
      const windowNote = windowMinutes > 0 ? ` in the first ${windowMinutes} minutes` : ''
      setToast(segments.length
        ? `Marked ${segments.length} ad ${segments.length === 1 ? 'segment' : 'segments'}${windowNote}`
        : `No ad segments found${windowNote}`)
      appLog('info', 'highlight ads done', {
        segments: segments.length,
        cues: cues.length,
        memory: memorySnapshot(),
      })
    } catch (error) {
      if (isAbortError(error)) {
        setToast('Scan cancelled. Saved transcript is kept.')
        return
      }
      appLog('error', 'highlight ads failed', {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        memory: memorySnapshot(),
      })
      setToast(error instanceof Error ? error.message : 'Ad detection failed.')
    } finally {
      scanAbortRef.current.delete(episode.id)
      setDetectingAds((items) => items.filter((id) => id !== episode.id))
    }
  }

  const downloaded = downloadedEpisodes.map((episode) => episode.id)
  const downloadBytesById = Object.fromEntries(
    downloadedEpisodes.map((episode) => [episode.id, episode.downloadBytes ?? 0]),
  )
  const cuesByEpisode = cuesFromScans(scansByEpisode)
  const activeAdSegments = activeEpisode ? (adSegmentsByEpisode[activeEpisode.id] ?? []) : []
  const activeCues = activeEpisode ? (cuesByEpisode[activeEpisode.id] ?? []) : []
  const focusedShow = followedShows.find((show) => show.id === focusedShowId) ?? null
  const timelineForView = focusedShowId
    ? timelineEpisodes.filter((episode) => episode.showId === focusedShowId)
    : timelineEpisodes
  const searchShortcut = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'

  return <main>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Headphones size={20}/></span><span>Podflow</span></div>
      <nav>{([
        ['Home', Home], ['Library', Library], ['Downloads', Download]
      ] as const).map(([name, Icon]) => <button key={name} className={tab === name ? 'nav-active' : ''} onClick={() => setTab(name)}>
        <Icon size={19}/>{name === 'Library' ? 'Timeline' : name}
      </button>)}</nav>
      <div className="sidebar-bottom">
        <button className={tab === 'Settings' ? 'nav-active' : ''} onClick={() => setTab('Settings')}><Settings size={19}/>Settings</button>
        <p className="sidebar-note">Listening stays on this device.</p>
      </div>
    </aside>

    <section className="content">
      <header>
        <div className="mobile-brand"><Headphones size={19}/>Podflow</div>
        <div className="search-wrap" ref={searchWrapRef}><div className="search"><Search size={18}/><input ref={searchInputRef} value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Apple Podcasts" aria-label="Search Apple Podcasts" /><kbd>{searchShortcut}</kbd></div>
          {search.trim().length >= 2 && <div className="search-results">
            {searchStatus === 'loading' && <p className="search-state">Searching the podcast catalog…</p>}
            {searchStatus === 'error' && <p className="search-state">{offline ? 'You are offline. Search needs a connection — downloaded episodes still play.' : 'Search is unavailable. Please try again.'}</p>}
            {searchStatus === 'idle' && <>{searchResults.shows.length > 0 && <><span className="result-label">SHOWS · TAP TO FOLLOW</span>{searchResults.shows.map(show => <button className="show-result" key={show.id} onClick={() => toggleFollowShow(show)}><Art artwork={show.artwork} label={show.name}/><span><b>{show.name}</b><small>{show.author}{show.genres[0] ? ` · ${show.genres[0]}` : ''}</small></span><strong className={followedShows.some(item => item.id === show.id) ? 'following-mark' : ''}>{followedShows.some(item => item.id === show.id) ? 'Following' : <Plus size={16}/>}</strong></button>)}</>}
            {searchResults.episodes.length > 0 && <><span className="result-label">EPISODES</span>{searchResults.episodes.slice(0, 4).map(episode => <button className="show-result" key={episode.id} onClick={() => { selectEpisode(episode); setSearch('') }}><Art artwork={episode.artwork} label={episode.show}/><span><b>{episode.title}</b><small>{episode.show} · {episode.duration}</small></span></button>)}</>}
            {!searchResults.shows.length && !searchResults.episodes.length && <p className="search-state">No playable podcasts found.</p>}</>}
          </div>}
        </div>
      </header>

      {updateReady && (
        <div className="update-banner" role="status">
          <span>A new version of Podflow is ready. Reloading keeps downloads and settings on this device.</span>
          <button type="button" onClick={() => void applyAppUpdate()}>Reload</button>
          <button type="button" className="later" onClick={() => dismissAppUpdate()}>Later</button>
        </div>
      )}
      {offline && <p className="offline-banner">You are offline. Downloaded episodes still play; search and new episodes need a connection.</p>}
      {tab === 'Home' && <HomeView shows={followedShows} onSelect={openShowTimeline} onUnfollow={toggleFollowShow} />}
      {tab === 'Library' && <LibraryView episodes={timelineForView} onSelect={selectEpisode} downloaded={downloaded} downloadBytesById={downloadBytesById} onDownload={downloadEpisode} downloading={downloading} downloadProgress={downloadProgress} search="" timeline timelineStatus={timelineStatus} activeEpisodeId={activeEpisode?.id} focusedShow={focusedShow} onClearFocus={() => setFocusedShowId(null)} offline={offline} />}
      {tab === 'Downloads' && <LibraryView episodes={downloadedEpisodes} onSelect={selectEpisode} downloaded={downloaded} downloadBytesById={downloadBytesById} onDownload={downloadEpisode} downloading={downloading} downloadProgress={downloadProgress} search="" downloads storageUsage={storageUsage} adSegmentsByEpisode={adSegmentsByEpisode} cuesByEpisode={cuesByEpisode} detectingAds={detectingAds} onDetectAds={highlightAds} secondsSaved={secondsSaved} activeEpisodeId={activeEpisode?.id}/>}
      {tab === 'Settings' && <SettingsPanel embedded apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} sttModel={sttModel} setSttModel={setSttModel} skipAds={skipAds} setSkipAds={setSkipAds} analyseMinutes={analyseMinutes} setAnalyseMinutes={setAnalyseMinutes} onSave={saveSettings} onRemoveKey={removeApiKey} onToast={setToast} onTestConnection={testOpenRouterConnection} keyStatus={keyStatus} secondsSaved={secondsSaved}/>}
    </section>

    <PlayerBar
      episode={activeEpisode}
      playing={playing}
      onPlay={togglePlayback}
      onPause={pausePlayback}
      currentTime={currentTime}
      duration={audioDuration}
      onSeek={seekTo}
      adSegments={activeAdSegments}
      cues={activeCues}
      downloaded={Boolean(activeEpisode && downloaded.includes(activeEpisode.id))}
      skipAds={skipAds}
      onSkipAdsChange={setSkipAds}
      detecting={Boolean(activeEpisode && detectingAds.includes(activeEpisode.id))}
      onHighlightAds={(options) => { if (activeEpisode) void highlightAds(activeEpisode, options) }}
      onDownload={() => { if (activeEpisode) void downloadEpisode(activeEpisode) }}
      downloading={Boolean(activeEpisode && downloading.includes(activeEpisode.id))}
      playbackRate={playbackRate}
      onPlaybackRateChange={setPlaybackRate}
      volume={volume}
      onVolumeChange={setVolume}
      analyseMinutes={analyseMinutes}
      expanded={playerOpen}
      onExpandedChange={setPlayerOpen}
    />
    <div className="mobile-nav">{([
      ['Home', Home], ['Library', Library], ['Downloads', Download], ['Settings', Settings]
    ] as const).map(([name, Icon]) => <button key={name} onClick={() => setTab(name)} className={tab === name ? 'active' : ''}><Icon size={19}/><span>{name === 'Library' ? 'Timeline' : name}</span></button>)}</div>
    {toast && <div className="toast"><Sparkles size={17}/>{toast}</div>}
  </main>
}

function HomeView({ shows, onSelect, onUnfollow }: { shows: PodcastShow[]; onSelect: (show: PodcastShow) => void; onUnfollow: (show: PodcastShow) => void }) {
  if (!shows.length) return <div className="page empty-following"><span className="empty-mark"><Search size={25}/></span><h1>Listen Now</h1><p>Search Apple Podcasts above, follow a show, then open Timeline to play. Add an OpenRouter key in Settings, download an episode, and Highlight ads to transcribe the audio, skip breaks, and follow the words.</p></div>
  return <div className="page followed-home"><h1>Listen Now</h1><p className="subcopy">Shows you follow. Tap a show for its latest episodes.</p><div className="show-grid">{shows.map(show => <div className="show-tile" key={show.id}><button className="show-tile-main" onClick={() => onSelect(show)}><Art artwork={show.artwork} label={show.name} large /><b>{show.name}</b><small>{show.author}</small></button><button className="unfollow" onClick={() => onUnfollow(show)} aria-label={`Unfollow ${show.name}`}>Following</button></div>)}</div></div>
}

function LibraryView({ episodes, onSelect, downloaded, downloadBytesById, onDownload, downloading, downloadProgress, search, downloads, timeline, timelineStatus, storageUsage, adSegmentsByEpisode, cuesByEpisode, detectingAds, onDetectAds, secondsSaved, activeEpisodeId, focusedShow, onClearFocus, offline }: { episodes: Episode[]; onSelect: (e: Episode) => void; downloaded: string[]; downloadBytesById?: Record<string, number>; onDownload: (episode: Episode) => void; downloading: string[]; downloadProgress?: Record<string, number>; search: string; downloads?: boolean; timeline?: boolean; timelineStatus?: 'idle' | 'loading' | 'error'; storageUsage?: { usage: number; quota: number }; adSegmentsByEpisode?: AdSegmentMap; cuesByEpisode?: CueMap; detectingAds?: string[]; onDetectAds?: (episode: Episode) => void; secondsSaved?: number; activeEpisodeId?: string; focusedShow?: PodcastShow | null; onClearFocus?: () => void; offline?: boolean }) {
  const downloadedBytes = episodes.reduce((total, episode) => total + (episode.downloadBytes ?? downloadBytesById?.[episode.id] ?? 0), 0)
  const emptyText = timeline
    ? (focusedShow ? `No episodes from ${focusedShow.name} yet.` : 'Follow podcasts using search to build your episode Timeline.')
    : 'Save episodes to listen without an internet connection.'
  const loadingTimeline = timeline && timelineStatus === 'loading' && !episodes.length
  const timelineError = timeline && timelineStatus === 'error' && !episodes.length
  const title = downloads ? 'Downloads' : timeline ? (focusedShow?.name ?? 'Timeline') : search ? `Results for “${search}”` : 'Latest episodes'
  return <div className="page library-page">
    <h1>{title}</h1>
    {focusedShow && <button className="show-back" onClick={onClearFocus}>All shows</button>}
    <p className="subcopy">{downloads ? 'Download, then Highlight ads to transcribe the audio. Red marks on the player bar are skipped when Skip ads is on. Tap Highlight again to cancel a scan.' : timeline ? 'The newest episodes from your followed podcasts.' : 'New releases from the shows you follow.'}</p>
    {downloads && <div className="storage-card"><div><b>{episodes.length} {episodes.length === 1 ? 'episode' : 'episodes'} downloaded</b><span>Podflow audio: {formatBytes(downloadedBytes)}</span></div><div><b>{formatBytes(storageUsage?.usage ?? 0)} used by this app</b><span>{storageUsage?.quota ? `${formatBytes(Math.max(0, storageUsage.quota - storageUsage.usage))} available to Podflow` : 'Browser storage estimate unavailable'}</span></div><div><b>{formatMinutesSaved(secondsSaved ?? 0)} saved</b><span>Ad time skipped on this device</span></div></div>}
    {loadingTimeline ? <div className="empty"><LoaderCircle className="spin" size={30}/><h3>Loading timeline</h3><p>Fetching the latest episodes from your shows…</p></div>
      : timelineError ? <div className="empty"><Library size={30}/><h3>{offline ? 'You are offline' : 'Timeline could not load'}</h3><p>{offline ? 'Downloaded episodes still play from the Downloads tab. Followed shows will refresh when you are back online.' : 'Check your connection and open Timeline again.'}</p></div>
      : episodes.length ? <EpisodeList episodes={episodes} onSelect={onSelect} downloaded={downloaded} downloadBytesById={downloadBytesById} onDownload={onDownload} downloading={downloading} downloadProgress={downloadProgress} expandable={timeline} showAdActions={downloads} adSegmentsByEpisode={adSegmentsByEpisode} cuesByEpisode={cuesByEpisode} detectingAds={detectingAds} onDetectAds={onDetectAds} activeEpisodeId={activeEpisodeId}/>
      : <div className="empty"><Library size={30}/><h3>{timeline ? (focusedShow ? focusedShow.name : 'Your Timeline is ready') : 'Nothing downloaded yet'}</h3><p>{emptyText}</p></div>}
  </div>
}

function EpisodeList({ episodes, onSelect, downloaded, downloadBytesById, onDownload, downloading, downloadProgress, compact = false, expandable = false, showAdActions = false, adSegmentsByEpisode, cuesByEpisode, detectingAds = [], onDetectAds, activeEpisodeId }: { episodes: Episode[]; onSelect: (e: Episode) => void; downloaded: string[]; downloadBytesById?: Record<string, number>; onDownload: (episode: Episode) => void; downloading: string[]; downloadProgress?: Record<string, number>; compact?: boolean; expandable?: boolean; showAdActions?: boolean; adSegmentsByEpisode?: AdSegmentMap; cuesByEpisode?: CueMap; detectingAds?: string[]; onDetectAds?: (episode: Episode) => void; activeEpisodeId?: string }) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  if (!episodes.length) return <div className="empty"><Download size={30}/><h3>Nothing downloaded yet</h3><p>Save episodes to listen without an internet connection.</p></div>
  return <div className={`episode-list ${compact ? 'compact' : ''}`}>{episodes.map(e => {
    const expanded = expandedId === e.id
    const segments = adSegmentsByEpisode?.[e.id] ?? []
    const cues = cuesByEpisode?.[e.id] ?? []
    const detecting = detectingAds.includes(e.id)
    const isDownloaded = downloaded.includes(e.id)
    const isDownloading = downloading.includes(e.id)
    const isActive = activeEpisodeId === e.id
    const bytes = e.downloadBytes ?? downloadBytesById?.[e.id] ?? 0
    const progress = downloadProgress?.[e.id]
    return <article className={`episode-row ${expanded ? 'expanded' : ''} ${isActive ? 'playing' : ''}`} key={e.id} onClick={() => expandable ? setExpandedId(expanded ? null : e.id) : onSelect(e)}><Art artwork={e.artwork} label={e.show}/><div className="episode-info"><span>{e.show}{isActive ? ' · Playing' : ''}{isDownloaded ? ' · Downloaded' : ''}{isDownloading && progress ? ` · ${Math.round(progress * 100)}%` : isDownloading ? ' · Downloading' : ''}</span><h3>{e.title}</h3>{e.description ? <p className="episode-blurb">{e.description}</p> : null}<p>{e.date} · {e.duration}{isDownloaded && bytes ? ` · ${formatBytes(bytes)}` : ''}{segments.length ? ` · ${segments.length} ad ${segments.length === 1 ? 'mark' : 'marks'}` : ''}</p>{expanded && <div className="episode-details"><p>{e.description || 'Episode details are not available from this publisher.'}</p><div><button className="detail-play" onClick={event => { event.stopPropagation(); onSelect(e) }}><Play size={15} fill="currentColor"/>{isActive ? 'Now playing' : 'Play episode'}</button><span>{e.author} · {e.date}</span></div></div>}{showAdActions && <div className="episode-ad-actions"><button className={`detect-ads ${segments.length ? 'done' : ''} ${detecting ? 'busy' : ''}`} onClick={event => { event.stopPropagation(); onDetectAds?.(e) }}>{detecting ? <X size={15}/> : <WandSparkles size={15}/>}{detecting ? 'Cancel scan' : segments.length ? 'Re-scan audio' : 'Highlight ads'}</button>{segments.length > 0 && <ul className="ad-range-list">{segments.map(segment => { const during = excerptAroundSegment(cues, segment.start, segment.end).during; const preview = during.map(cue => cue.text.trim()).join(' ').slice(0, 160); return <li key={`${segment.start}-${segment.end}`}><b>{formatTime(segment.start)}–{formatTime(segment.end)}</b>{segment.label ? ` · ${segment.label}` : ''}{preview ? <p>{preview}{during.map(cue => cue.text.trim()).join(' ').length > 160 ? '…' : ''}</p> : !cues.length ? <p>Transcript missing — re-scan to restore the words.</p> : null}</li> })}</ul>}</div>}</div><button className={`download ${isDownloaded ? 'done' : ''} ${isDownloading ? 'busy' : ''}`} onClick={event => { event.stopPropagation(); onDownload(e) }} aria-label={isDownloaded ? 'Remove download' : isDownloading ? 'Cancel download' : 'Download episode'} title={isDownloaded ? 'Downloaded — tap to remove' : isDownloading ? 'Downloading — tap to cancel' : 'Download episode'}>{isDownloading ? (progress ? <span className="download-pct">{Math.round(progress * 100)}</span> : <LoaderCircle className="spin" size={18}/>) : isDownloaded ? <Check size={19} strokeWidth={2.5}/> : <Download size={19}/>}</button>{expandable ? <ChevronDown className={expanded ? 'chevron-up' : ''} size={18}/> : null}</article>
  })}</div>
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

function SettingsPanel({ apiKey, setApiKey, model, setModel, sttModel, setSttModel, skipAds, setSkipAds, analyseMinutes, setAnalyseMinutes, onSave, onRemoveKey, onToast, onTestConnection, keyStatus, secondsSaved = 0, embedded = false }: { apiKey: string; setApiKey: (v: string) => void; model: string; setModel: (v: string) => void; sttModel: string; setSttModel: (v: string) => void; skipAds: boolean; setSkipAds: (v: boolean) => void; analyseMinutes: number; setAnalyseMinutes: (v: number) => void; onSave: () => void; onRemoveKey: () => void; onToast: (message: string) => void; onTestConnection: () => Promise<void>; keyStatus: KeyStatus | null; secondsSaved?: number; embedded?: boolean }) {
  const [updating, setUpdating] = useState(false)
  const [testing, setTesting] = useState(false)
  const [copyingLogs, setCopyingLogs] = useState(false)

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

  const handleCopyLogs = async () => {
    if (copyingLogs) return
    setCopyingLogs(true)
    try {
      await copyDebugLogs()
      onToast('Logs copied — paste them into the chat')
    } catch (error) {
      appLog('error', 'copy logs failed', { message: error instanceof Error ? error.message : String(error) })
      onToast('Could not copy logs. Try again from Safari, not the Home Screen icon.')
    } finally {
      setCopyingLogs(false)
    }
  }

  return (
    <div className={`settings-panel ${embedded ? 'embedded' : ''}`}>
      <h1>Settings</h1>
      <div className="settings-head">
        <div className="settings-icon"><WandSparkles size={22}/></div>
        <div>
          <h2>Smart ad skipping</h2>
          <p>Add your OpenRouter key, download an episode, then Highlight ads to transcribe that audio.</p>
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
          <input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-v1-••••••••••••••••" type="password" autoComplete="off"/>
        </label>
        {apiKey.trim() ? <button className="remove-key" type="button" onClick={onRemoveKey}>Remove key from this device</button> : null}
        <div className="key-note"><Sparkles size={15}/><span>The key stays on this device across app updates. 1. Paste it once. 2. Download an episode. 3. Highlight ads transcribes that audio — we never use a publisher transcript URL. 4. Play: red marks skip, and the words follow along.</span></div>
        <label>Speech-to-text
          <select value={sttModel} onChange={e => setSttModel(e.target.value)}>
            <option value={DEFAULT_STT_MODEL}>Whisper — timed cues (recommended)</option>
            <option value={QWEN_STT_MODEL}>Qwen3 ASR Flash — clearer ads, 15s clips in parallel</option>
          </select>
        </label>
        <label>Analysis model <a href="https://openrouter.ai/models" target="_blank">Compare models ↗</a>
          <select value={model} onChange={e => setModel(e.target.value)}>
            <option value="deepseek/deepseek-v4-flash">DeepSeek V4 Flash — recommended</option>
            <option value="google/gemini-2.5-flash">Gemini 2.5 Flash</option>
            <option value="openai/gpt-4.1-mini">GPT-4.1 mini — precise</option>
            <option value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku — nuanced</option>
          </select>
        </label>
        <label>Analysis window
          <select value={String(analyseMinutes)} onChange={e => setAnalyseMinutes(Number(e.target.value))}>
            {ANALYSE_MINUTE_OPTIONS.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? 'Entire episode — uses more credits' : `First ${minutes} minutes — saves credits`}
              </option>
            ))}
          </select>
        </label>
          <div className="key-note"><Sparkles size={15}/><span>Highlight ads from now playing transcribes the whole downloaded episode so mid-rolls are included. This window still applies when you highlight from Downloads, to save credits on a phone test. Publisher transcripts are ignored.</span></div>
        <div className="credit">
          <span>OpenRouter status</span>
          <strong>{keyStatus ? `Connected · ${formatCredits(keyStatus.limitRemaining)}` : apiKey ? 'Not checked yet' : 'Add your key to connect'}</strong>
        </div>
        <button className="test-connection" onClick={() => void handleTestConnection()} disabled={testing || !apiKey.trim()}>
          {testing ? 'Checking…' : 'Test connection'}
        </button>
        <button className="test-connection" onClick={() => void handleCopyLogs()} disabled={copyingLogs}>
          {copyingLogs ? 'Copying…' : <><Copy size={14}/> Copy logs</>}
        </button>
        <button className="test-connection" onClick={() => { clearDebugLogs(); onToast('Logs cleared') }}>
          Clear logs
        </button>
        <p className="key-note"><Sparkles size={15}/><span>If Highlight ads reloads the app, come back here and Copy logs so we can see the last line before the refresh.</span></p>
      </div>
      <button className="save-settings" onClick={onSave}>Save settings</button>
      <div className="settings-update">
        <button className="force-update" onClick={() => void handleForceUpdate()} disabled={updating}>
          {updating ? 'Updating…' : 'Force update'}
        </button>
        <p className="app-version">Version {__APP_VERSION__} · Updated {formatBuildDate(__BUILD_TIME__)}</p>
        <p className="key-note"><Sparkles size={15}/><span>When a new build is waiting, Podflow shows a Reload banner instead of refreshing by itself. Force update still checks now and reloads.</span></p>
      </div>
    </div>
  )
}

export default App
