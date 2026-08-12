export type Episode = {
  id: string
  episodeId?: number
  showId: number
  show: string
  author: string
  title: string
  date: string
  publishedAt?: string
  duration: string
  artwork?: string
  audioUrl?: string
  downloadBytes?: number
  description?: string
}

export type PodcastShow = {
  id: number
  name: string
  author: string
  artwork?: string
  genres: string[]
}

type ItunesResult = {
  wrapperType?: string
  trackId?: number
  collectionId?: number
  trackName?: string
  collectionName?: string
  artistName?: string
  releaseDate?: string
  trackTimeMillis?: number
  artworkUrl600?: string
  artworkUrl100?: string
  episodeUrl?: string
  description?: string
  primaryGenreName?: string
  genres?: string[]
}

type ItunesResponse = { results: ItunesResult[] }

const apiUrl = (path: string, params: Record<string, string | number>) => {
  const url = new URL(`https://itunes.apple.com/${path}`)
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)))
  return url
}

const formatDate = (value?: string) => value
  ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
  : 'Recently'

const formatDuration = (milliseconds?: number) => {
  if (!milliseconds) return 'Episode'
  const minutes = Math.round(milliseconds / 60000)
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
}

const episodeFromResult = (result: ItunesResult): Episode => ({
  id: String(result.trackId ?? `${result.collectionId}-${result.trackName}`),
  episodeId: result.trackId,
  showId: result.collectionId ?? 0,
  show: result.collectionName ?? 'Podcast',
  author: result.artistName ?? 'Unknown creator',
  title: result.trackName ?? 'Untitled episode',
  date: formatDate(result.releaseDate),
  publishedAt: result.releaseDate,
  duration: formatDuration(result.trackTimeMillis),
  artwork: result.artworkUrl600 ?? result.artworkUrl100,
  // Audio only. Ignore any publisher/Apple transcript URL — those files omit ads.
  audioUrl: result.episodeUrl,
  description: result.description,
})

export const playbackUrl = (episode: Episode) => {
  if (!episode.audioUrl) return undefined
  return `/api/audio?source=${encodeURIComponent(episode.audioUrl)}`
}

export async function searchCatalog(term: string) {
  const encodedTerm = term.trim()
  if (!encodedTerm) return { shows: [] as PodcastShow[], episodes: [] as Episode[] }

  const [showResponse, episodeResponse] = await Promise.all([
    fetch(apiUrl('search', { term: encodedTerm, media: 'podcast', entity: 'podcast', limit: 6 }).toString()),
    fetch(apiUrl('search', { term: encodedTerm, media: 'podcast', entity: 'podcastEpisode', limit: 8 }).toString()),
  ])
  if (!showResponse.ok || !episodeResponse.ok) throw new Error('The podcast catalog is unavailable right now.')

  const shows = (await showResponse.json() as ItunesResponse).results.map((result) => ({
    id: result.collectionId ?? result.trackId ?? 0,
    name: result.collectionName ?? result.trackName ?? 'Untitled podcast',
    author: result.artistName ?? 'Unknown creator',
    artwork: result.artworkUrl600 ?? result.artworkUrl100,
    genres: result.genres ?? (result.primaryGenreName ? [result.primaryGenreName] : []),
  })).filter((show) => show.id)

  const episodes = (await episodeResponse.json() as ItunesResponse).results
    .map(episodeFromResult)
    .filter((episode) => episode.audioUrl)

  return { shows, episodes }
}

export async function getShowEpisodes(showId: number) {
  const response = await fetch(apiUrl('lookup', { id: showId, entity: 'podcastEpisode', limit: 30 }).toString())
  if (!response.ok) throw new Error('This show could not be loaded right now.')
  return (await response.json() as ItunesResponse).results
    .filter((result) => result.wrapperType === 'podcastEpisode' || result.episodeUrl)
    .map(episodeFromResult)
    .filter((episode) => episode.audioUrl)
}
