const appleLookup = (showId) =>
  `https://itunes.apple.com/lookup?id=${encodeURIComponent(showId)}&entity=podcastEpisode&limit=200`

const error = (message, status = 400) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

export async function onRequestGet({ request }) {
  const url = new URL(request.url)
  const showId = Number(url.searchParams.get('showId'))
  const episodeId = Number(url.searchParams.get('episodeId'))
  if (!Number.isSafeInteger(showId) || !Number.isSafeInteger(episodeId)) {
    return error('A valid show and episode are required.')
  }

  try {
    const catalogResponse = await fetch(appleLookup(showId))
    if (!catalogResponse.ok) return error('The podcast catalog is unavailable.', 502)
    const catalog = await catalogResponse.json()
    const episode = catalog.results?.find((item) => Number(item.trackId) === episodeId)
    if (!episode?.episodeUrl) return error('This episode is no longer available from its publisher.', 404)

    const upstreamHeaders = new Headers()
    const range = request.headers.get('range')
    if (range) upstreamHeaders.set('range', range)
    const upstream = await fetch(episode.episodeUrl, { headers: upstreamHeaders, redirect: 'follow' })
    if (!upstream.ok && upstream.status !== 206) return error('The publisher could not provide this audio.', 502)

    const headers = new Headers()
    for (const header of ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
      const value = upstream.headers.get(header)
      if (value) headers.set(header, value)
    }
    headers.set('cache-control', 'public, max-age=3600')
    headers.set('x-content-type-options', 'nosniff')
    return new Response(upstream.body, { status: upstream.status, headers })
  } catch {
    return error('Unable to stream this episode right now.', 502)
  }
}
