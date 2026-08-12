import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const isPublicHttpsUrl = (url: URL) => {
  const host = url.hostname.toLowerCase()
  const privateIpv4 = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/
  const privateIpv6 = /^(::1$|::$|fc|fd|fe80:)/i
  return url.protocol === 'https:' && !url.username && !url.password &&
    !/(^localhost$|\.local$)/.test(host) && !privateIpv4.test(host) && !privateIpv6.test(host)
}

async function handleAudioProxy(req: IncomingMessage, res: ServerResponse) {
  const host = req.headers.host ?? 'localhost'
  const url = new URL(req.url ?? '/', `http://${host}`)
  const source = url.searchParams.get('source')
  if (!source) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'An audio source is required.' }))
    return
  }

  let upstreamUrl: URL
  try {
    upstreamUrl = new URL(source)
  } catch {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'The audio source is invalid.' }))
    return
  }

  if (!isPublicHttpsUrl(upstreamUrl)) {
    res.statusCode = 400
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Only public HTTPS podcast audio is supported.' }))
    return
  }

  try {
    const upstreamHeaders = new Headers()
    const range = req.headers.range
    if (range) upstreamHeaders.set('range', range)
    const upstream = await fetch(upstreamUrl, { headers: upstreamHeaders, redirect: 'follow' })
    if (!upstream.ok && upstream.status !== 206) {
      res.statusCode = 502
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'The publisher could not provide this audio.' }))
      return
    }

    const contentType = upstream.headers.get('content-type') ?? ''
    if (!contentType.startsWith('audio/') && !contentType.includes('octet-stream')) {
      res.statusCode = 415
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: 'The publisher did not provide an audio file.' }))
      return
    }

    res.statusCode = upstream.status
    for (const header of ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
      const value = upstream.headers.get(header)
      if (value) res.setHeader(header, value)
    }
    res.setHeader('cache-control', 'public, max-age=3600')
    res.setHeader('x-content-type-options', 'nosniff')

    if (!upstream.body) {
      res.end()
      return
    }
    Readable.fromWeb(upstream.body as never).pipe(res)
  } catch {
    res.statusCode = 502
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: 'Unable to stream this episode right now.' }))
  }
}

export function audioProxyPlugin(): Plugin {
  const attach = (middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void }) => {
    middlewares.use((req, res, next) => {
      const path = req.url?.split('?')[0]
      if (path !== '/api/audio') {
        next()
        return
      }
      void handleAudioProxy(req, res)
    })
  }

  return {
    name: 'podflow-audio-proxy',
    configureServer(server) {
      attach(server.middlewares)
    },
    configurePreviewServer(server) {
      attach(server.middlewares)
    },
  }
}
