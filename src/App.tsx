import { useEffect, useMemo, useState } from 'react'
import {
  Bell, Bookmark, ChevronDown, Clock3, Download, Headphones, Home,
  Library, ListMusic, MoreHorizontal, Pause, Play, Plus, Search,
  Settings, Share2, SkipForward, Sparkles, WandSparkles, X
} from 'lucide-react'

type Tab = 'Home' | 'Library' | 'Downloads' | 'Settings'
type Episode = {
  id: number; show: string; title: string; date: string; duration: string
  color: string; art: string; progress?: number; downloaded?: boolean
}

const episodes: Episode[] = [
  { id: 1, show: 'The Knowledge Project', title: 'The art of knowing what matters', date: 'Today', duration: '1h 08m', color: 'lime', art: 'KP', progress: 32 },
  { id: 2, show: 'Radiolab', title: 'The Secret Life of the Brain', date: 'Today', duration: '43m', color: 'pink', art: 'R' },
  { id: 3, show: '99% Invisible', title: 'The Biggest Little City', date: 'Yesterday', duration: '37m', color: 'yellow', art: '99', downloaded: true },
  { id: 4, show: 'The Daily', title: 'The Questions Behind the Polls', date: 'Yesterday', duration: '29m', color: 'blue', art: 'T' },
  { id: 5, show: 'Acquired', title: 'The Story of Hermès', date: 'Jul 21', duration: '4h 12m', color: 'green', art: 'A', downloaded: true },
]

const transcript = [
  { time: '00:00', speaker: 'ALEX', text: 'Welcome back to The Knowledge Project. Today, I’m talking with author and investor Maya Chen about building a life around the things that matter.', ad: false },
  { time: '00:16', speaker: 'MAYA', text: 'I think the mistake people make is treating attention like it’s infinite. It’s the only asset that doesn’t compound once you’ve spent it.', ad: false },
  { time: '00:31', speaker: 'ALEX', text: 'Before we dive in, a quick word from today’s partner, Ledger. If you’re serious about protecting your digital assets, Ledger makes it simple.', ad: true },
  { time: '01:02', speaker: 'ALEX', text: 'Use the link in our show notes to get 10% off your first device. Now, back to Maya.', ad: true },
  { time: '01:10', speaker: 'MAYA', text: 'The practical shift is to decide what gets your best energy before the day starts asking for it.', ad: false },
]

function Art({ color, label, large = false }: { color: string; label: string; large?: boolean }) {
  return <div className={`art ${color} ${large ? 'large' : ''}`}><span>{label}</span><i /></div>
}

function App() {
  const [tab, setTab] = useState<Tab>('Home')
  const [activeEpisode, setActiveEpisode] = useState(episodes[0])
  const [playing, setPlaying] = useState(false)
  const [followed, setFollowed] = useState(true)
  const [downloaded, setDownloaded] = useState<number[]>([3, 5])
  const [search, setSearch] = useState('')
  const [skipAds, setSkipAds] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('google/gemini-2.5-flash')
  const [toast, setToast] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('podflow-settings')
    if (saved) {
      const parsed = JSON.parse(saved)
      setSkipAds(parsed.skipAds ?? true)
      setModel(parsed.model ?? 'google/gemini-2.5-flash')
      setApiKey(parsed.apiKey ?? '')
    }
  }, [])

  const filtered = useMemo(() => episodes.filter(e =>
    `${e.show} ${e.title}`.toLowerCase().includes(search.toLowerCase())), [search])

  const selectEpisode = (episode: Episode) => {
    setActiveEpisode(episode); setPlaying(true); setTab('Home')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const toggleDownload = (id: number) => {
    setDownloaded(items => items.includes(id) ? items.filter(i => i !== id) : [...items, id])
    setToast(downloaded.includes(id) ? 'Removed from downloads' : 'Saved for offline listening')
    setTimeout(() => setToast(''), 2300)
  }
  const saveSettings = () => {
    localStorage.setItem('podflow-settings', JSON.stringify({ skipAds, model, apiKey }))
    setSettingsOpen(false); setToast('Ad skip settings saved')
    setTimeout(() => setToast(''), 2300)
  }

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
        <div className="search"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search shows and episodes" /><kbd>⌘ K</kbd></div>
        <button className="icon-button"><Bell size={20}/><i /></button>
        <div className="avatar small">JT</div>
      </header>

      {tab === 'Home' && <HomeView episode={activeEpisode} playing={playing} onPlay={() => setPlaying(!playing)} followed={followed} onFollow={() => setFollowed(!followed)} skipAds={skipAds} onSkipAds={() => setSkipAds(!skipAds)} onOpenSettings={() => setSettingsOpen(true)} onDownload={() => toggleDownload(activeEpisode.id)} isDownloaded={downloaded.includes(activeEpisode.id)} />}
      {tab === 'Library' && <LibraryView episodes={filtered} onSelect={selectEpisode} downloaded={downloaded} onDownload={toggleDownload} search={search} />}
      {tab === 'Downloads' && <LibraryView episodes={episodes.filter(e => downloaded.includes(e.id))} onSelect={selectEpisode} downloaded={downloaded} onDownload={toggleDownload} search="" downloads />}
      {tab === 'Settings' && <SettingsPanel embedded apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} skipAds={skipAds} setSkipAds={setSkipAds} onSave={saveSettings}/>}
    </section>

    <PlayerBar episode={activeEpisode} playing={playing} onPlay={() => setPlaying(!playing)} />
    <div className="mobile-nav">{([
      ['Home', Home], ['Library', Library], ['Downloads', Download], ['Settings', Settings]
    ] as const).map(([name, Icon]) => <button key={name} onClick={() => name === 'Settings' ? setSettingsOpen(true) : setTab(name)} className={tab === name ? 'active' : ''}><Icon size={19}/><span>{name}</span></button>)}</div>
    {settingsOpen && <div className="modal-backdrop"><div className="settings-modal"><button className="close" onClick={() => setSettingsOpen(false)}><X/></button><SettingsPanel apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} skipAds={skipAds} setSkipAds={setSkipAds} onSave={saveSettings}/></div></div>}
    {toast && <div className="toast"><Sparkles size={17}/>{toast}</div>}
  </main>
}

function HomeView({ episode, playing, onPlay, followed, onFollow, skipAds, onSkipAds, onOpenSettings, onDownload, isDownloaded }: {
  episode: Episode; playing: boolean; onPlay: () => void; followed: boolean; onFollow: () => void; skipAds: boolean; onSkipAds: () => void; onOpenSettings: () => void; onDownload: () => void; isDownloaded: boolean
}) {
  return <div className="page">
    <div className="eyebrow">NOW PLAYING</div>
    <div className="hero">
      <Art color="lime" label="KP" large />
      <div className="hero-copy"><span className="show-name">{episode.show}</span><h1>{episode.title}</h1><p>with Shane Parrish</p><div className="hero-actions"><button className="play-button" onClick={onPlay}>{playing ? <Pause fill="currentColor"/> : <Play fill="currentColor"/>}{playing ? 'Pause' : 'Play episode'}</button><button className="round-button" onClick={onDownload}><Download size={20}/></button><button className="round-button"><Share2 size={19}/></button></div></div>
      <button className={`follow ${followed ? 'following' : ''}`} onClick={onFollow}>{followed ? 'Following' : <><Plus size={16}/>Follow</>}</button>
    </div>
    <div className="stats"><div><strong>58:42</strong><span>of 1h 08m played</span></div><div><strong>3m 12s</strong><span>ads skipped this episode</span></div><div><strong>14m 26s</strong><span>total time reclaimed</span></div></div>
    <div className="section-heading"><div><h2>Episode transcript</h2><p>Follow along as you listen</p></div><button className="text-button"><Bookmark size={17}/>Save</button></div>
    <section className="transcript-card">
      <div className="transcript-toolbar"><span><ListMusic size={18}/>Interactive transcript</span><div><button className={skipAds ? 'toggle on' : 'toggle'} onClick={onSkipAds}><i/></button><b>Skip ads automatically</b><button className="info" onClick={onOpenSettings}>?</button></div></div>
      <div className="transcript-list">{transcript.map((line, index) => <div className={`transcript-line ${line.ad ? 'ad' : ''} ${index === 0 ? 'current' : ''}`} key={line.time}>
        <time>{line.time}</time><div><span>{line.ad && <WandSparkles size={14}/>} {line.ad ? 'AD DETECTED' : line.speaker}</span><p>{line.text}</p></div>{line.ad && <button className="skip-line"><SkipForward size={15}/>Skip</button>}</div>)}</div>
    </section>
    <div className="section-heading release-heading"><div><h2>Fresh from your shows</h2><p>New episodes from shows you follow</p></div><button className="text-button">See all <ChevronDown size={16}/></button></div>
    <EpisodeList episodes={episodes.slice(1, 4)} onSelect={() => {}} downloaded={[]} onDownload={() => {}} compact/>
  </div>
}

function LibraryView({ episodes, onSelect, downloaded, onDownload, search, downloads }: { episodes: Episode[]; onSelect: (e: Episode) => void; downloaded: number[]; onDownload: (id: number) => void; search: string; downloads?: boolean }) {
  return <div className="page library-page"><div className="eyebrow">{downloads ? 'OFFLINE LISTENING' : 'YOUR LIBRARY'}</div><h1>{downloads ? 'Downloads' : search ? `Results for “${search}”` : 'Latest episodes'}</h1><p className="subcopy">{downloads ? 'Saved on this device. Ready whenever you are.' : 'New releases from the shows you follow.'}</p><EpisodeList episodes={episodes} onSelect={onSelect} downloaded={downloaded} onDownload={onDownload}/></div>
}

function EpisodeList({ episodes, onSelect, downloaded, onDownload, compact = false }: { episodes: Episode[]; onSelect: (e: Episode) => void; downloaded: number[]; onDownload: (id: number) => void; compact?: boolean }) {
  if (!episodes.length) return <div className="empty"><Download size={30}/><h3>Nothing downloaded yet</h3><p>Save episodes to listen without an internet connection.</p></div>
  return <div className={`episode-list ${compact ? 'compact' : ''}`}>{episodes.map(e => <article className="episode-row" key={e.id} onClick={() => onSelect(e)}><Art color={e.color} label={e.art}/><div className="episode-info"><span>{e.show}</span><h3>{e.title}</h3><p>{e.date} · {e.duration}</p>{e.progress && <div className="mini-progress"><i style={{width: `${e.progress}%`}}/></div>}</div><button className={`download ${downloaded.includes(e.id) ? 'done' : ''}`} onClick={event => { event.stopPropagation(); onDownload(e.id) }}><Download size={19}/></button><button className="more" onClick={event => event.stopPropagation()}><MoreHorizontal size={20}/></button></article>)}</div>
}

function PlayerBar({ episode, playing, onPlay }: { episode: Episode; playing: boolean; onPlay: () => void }) {
  return <div className="player-bar"><div className="now"><Art color="lime" label="KP"/><div><b>{episode.title}</b><span>{episode.show}</span></div></div><div className="controls"><button><SkipForward className="flip" size={19}/></button><button className="player-play" onClick={onPlay}>{playing ? <Pause fill="currentColor" size={18}/> : <Play fill="currentColor" size={18}/>}</button><button><SkipForward size={19}/></button></div><div className="track"><span>58:42</span><div><i/></div><span>1:08:14</span></div><button className="speed">1×</button></div>
}

function SettingsPanel({ apiKey, setApiKey, model, setModel, skipAds, setSkipAds, onSave, embedded = false }: { apiKey: string; setApiKey: (v: string) => void; model: string; setModel: (v: string) => void; skipAds: boolean; setSkipAds: (v: boolean) => void; onSave: () => void; embedded?: boolean }) {
  return <div className={`settings-panel ${embedded ? 'embedded' : ''}`}><div className="settings-head"><div className="settings-icon"><WandSparkles size={22}/></div><div><h2>Smart ad skipping</h2><p>Let AI find and skip ads in your downloads.</p></div></div><div className="settings-card"><div className="setting-row"><div><b>Automatically skip ads</b><p>Skip detected ad breaks during playback.</p></div><button className={skipAds ? 'toggle on' : 'toggle'} onClick={() => setSkipAds(!skipAds)}><i/></button></div><hr/><label>OpenRouter API key <a href="https://openrouter.ai/keys" target="_blank">Get an API key ↗</a><input value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-or-v1-••••••••••••••••" type="password"/></label><div className="key-note"><Sparkles size={15}/><span>Your key stays on this device and is only used to analyse downloaded transcripts.</span></div><label>Analysis model <a href="https://openrouter.ai/models" target="_blank">Compare models ↗</a><select value={model} onChange={e => setModel(e.target.value)}><option value="google/gemini-2.5-flash">Gemini 2.5 Flash — recommended</option><option value="openai/gpt-4.1-mini">GPT-4.1 mini — precise</option><option value="anthropic/claude-3.5-haiku">Claude 3.5 Haiku — nuanced</option></select></label><div className="credit"><span>OpenRouter credit</span><strong>{apiKey ? 'Connect to check balance' : 'Add your key to check balance'}</strong></div></div><button className="save-settings" onClick={onSave}>Save settings</button></div>
}

export default App
