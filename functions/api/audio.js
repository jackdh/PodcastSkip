const error = (message, status = 400) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

const isPublicHttpsUrl = (url) => {
  const host = url.hostname.toLowerCase()
  const privateIpv4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/
  const privateIpv6 = /^(::1$|::$|fc|fd|fe80:)/i
  return url.protocol === 'https:' && !url.username && !url.password &&
    !/(^localhost$|\.local$)/.test(host) && !privateIpv4.test(host) && !privateIpv6.test(host)
}

export async function onRequestGet({ request }) {
  const url = new URL(request.url)
  const source = url.searchParams.get('source')
  if (!source) return error('An audio source is required.')

  let upstreamUrl
  try {
    upstreamUrl = new URL(source)
  } catch {
    return error('The audio source is invalid.')
  }
  if (!isPublicHttpsUrl(upstreamUrl)) {
    return error('Only public HTTPS podcast audio is supported.')
  }

  try {
    const upstreamHeaders = new Headers()
    const range = request.headers.get('range')
    if (range) upstreamHeaders.set('range', range)
    const upstream = await fetch(upstreamUrl, { headers: upstreamHeaders, redirect: 'follow' })
    if (!upstream.ok && upstream.status !== 206) return error('The publisher could not provide this audio.', 502)
    const contentType = upstream.headers.get('content-type') ?? ''
    if (!contentType.startsWith('audio/') && !contentType.includes('octet-stream')) {
      return error('The publisher did not provide an audio file.', 415)
    }

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
