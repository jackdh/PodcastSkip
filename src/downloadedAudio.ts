import { DOWNLOAD_CACHE_NAME } from './pwa'

const DIRECTORY = 'podflow-episodes'
const META_KEY = 'podflow-episode-files'

export type EpisodeFileMeta = {
  bytes: number
  type: string
}

type ByteSink = {
  write: (chunk: Uint8Array) => Promise<void>
  close: () => Promise<void>
  abort: () => Promise<void>
}

const memoryMeta = new Map<string, EpisodeFileMeta>()
const pending = new Map<string, Promise<Blob>>()

/**
 * Cache Storage `response.blob()` materializes the whole episode in the tab.
 * A long Darknet Diaries download is about 100MB; playback already holds one
 * copy, and Highlight ads asked for a second while the row still said
 * “Preparing”. WebKit jetsams that tab, which Safari shows as a refresh.
 * Stream the body in chunks onto disk and slice that file instead.
 */
export async function writeResponseBody(
  response: Response,
  sink: ByteSink,
  onBytes?: (bytes: number) => void,
): Promise<number> {
  const body = response.body
  if (!body) throw new Error('Downloaded audio has no readable body.')
  const reader = body.getReader()
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value?.byteLength) continue
      await sink.write(value)
      bytes += value.byteLength
      onBytes?.(bytes)
    }
    await sink.close()
    return bytes
  } catch (error) {
    await sink.abort().catch(() => undefined)
    throw error
  }
}

export function blobWithType(blob: Blob, type: string): Blob {
  const mime = (type.split(';')[0] ?? '').trim() || 'audio/mpeg'
  if (blob.type === mime) return blob
  return blob.slice(0, blob.size, mime)
}

export async function episodeStorageName(cacheKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(cacheKey))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function readMetaMap(): Record<string, EpisodeFileMeta> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const parsed = JSON.parse(localStorage.getItem(META_KEY) ?? '{}') as Record<string, EpisodeFileMeta>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function readMeta(cacheKey: string): EpisodeFileMeta | undefined {
  const cached = memoryMeta.get(cacheKey)
  if (cached) return cached
  const stored = readMetaMap()[cacheKey]
  if (!stored?.bytes) return undefined
  memoryMeta.set(cacheKey, stored)
  return stored
}

function writeMeta(cacheKey: string, meta: EpisodeFileMeta) {
  memoryMeta.set(cacheKey, meta)
  if (typeof localStorage === 'undefined') return
  try {
    const all = readMetaMap()
    all[cacheKey] = meta
    localStorage.setItem(META_KEY, JSON.stringify(all))
  } catch {
    /* The file is still on disk; the next open will copy it again if needed. */
  }
}

function clearMeta(cacheKey: string) {
  memoryMeta.delete(cacheKey)
  if (typeof localStorage === 'undefined') return
  try {
    const all = readMetaMap()
    delete all[cacheKey]
    localStorage.setItem(META_KEY, JSON.stringify(all))
  } catch {
    /* Ignore quota failures while deleting. */
  }
}

function headerType(response: Response) {
  return (response.headers.get('content-type') || 'audio/mpeg').split(';')[0].trim() || 'audio/mpeg'
}

async function episodeDirectory(create: boolean) {
  if (typeof navigator === 'undefined' || !navigator.storage?.getDirectory) return null
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(DIRECTORY, { create })
}

export async function hasDownloadedAudio(cacheKey: string): Promise<boolean> {
  const meta = readMeta(cacheKey)
  if (!meta?.bytes) return false
  try {
    const dir = await episodeDirectory(false)
    if (!dir) return false
    const handle = await dir.getFileHandle(await episodeStorageName(cacheKey))
    const file = await handle.getFile()
    return file.size === meta.bytes
  } catch {
    return false
  }
}

export async function deleteDownloadedAudio(cacheKey: string): Promise<void> {
  clearMeta(cacheKey)
  try {
    const dir = await episodeDirectory(false)
    if (!dir) return
    await dir.removeEntry(await episodeStorageName(cacheKey))
  } catch {
    /* Already gone. */
  }
}

async function readExisting(cacheKey: string): Promise<Blob | null> {
  const meta = readMeta(cacheKey)
  if (!meta?.bytes) return null
  try {
    const dir = await episodeDirectory(false)
    if (!dir) return null
    const handle = await dir.getFileHandle(await episodeStorageName(cacheKey))
    const file = await handle.getFile()
    if (file.size !== meta.bytes) return null
    return blobWithType(file, meta.type || 'audio/mpeg')
  } catch {
    return null
  }
}

async function writeToDisk(cacheKey: string, response: Response, onBytes?: (bytes: number) => void): Promise<Blob> {
  const dir = await episodeDirectory(true)
  if (!dir) throw new Error('This browser cannot scan a long download without loading the whole file into memory.')
  const name = await episodeStorageName(cacheKey)
  await dir.removeEntry(name).catch(() => undefined)
  const handle = await dir.getFileHandle(name, { create: true })
  if (typeof handle.createWritable !== 'function') {
    throw new Error('This browser cannot scan a long download without loading the whole file into memory.')
  }
  const writable = await handle.createWritable()
  const type = headerType(response)
  try {
    const bytes = await writeResponseBody(response, {
      write: async (chunk) => {
        const copy = new Uint8Array(chunk.byteLength)
        copy.set(chunk)
        await writable.write(copy)
      },
      close: () => writable.close(),
      abort: () => writable.abort(),
    }, onBytes)
    const file = await handle.getFile()
    if (!bytes || file.size !== bytes) throw new Error('The download was incomplete. Download the episode again.')
    writeMeta(cacheKey, { bytes, type })
    return blobWithType(file, type)
  } catch (error) {
    await dir.removeEntry(name).catch(() => undefined)
    clearMeta(cacheKey)
    throw error
  }
}

function dedupe(cacheKey: string, run: () => Promise<Blob>): Promise<Blob> {
  const current = pending.get(cacheKey)
  if (current) return current
  const job = run().finally(() => {
    if (pending.get(cacheKey) === job) pending.delete(cacheKey)
  })
  pending.set(cacheKey, job)
  return job
}

/** Persist a freshly fetched episode without assembling it into one Blob. */
export function saveDownloadedAudio(
  cacheKey: string,
  response: Response,
  onBytes?: (bytes: number) => void,
): Promise<Blob> {
  return dedupe(cacheKey, () => writeToDisk(cacheKey, response, onBytes))
}

/** Open a saved episode. Copies an older Cache Storage download to disk in chunks once. */
export function openDownloadedAudio(
  cacheKey: string,
  options?: { onBytes?: (bytes: number) => void },
): Promise<Blob> {
  return dedupe(cacheKey, async () => {
    const existing = await readExisting(cacheKey)
    if (existing) return existing
    if (typeof caches === 'undefined') throw new Error('Download this episode first so we can analyse the audio.')
    const cached = await caches.open(DOWNLOAD_CACHE_NAME).then((cache) => cache.match(cacheKey))
    if (!cached) throw new Error('Download this episode first so we can analyse the audio.')
    return writeToDisk(cacheKey, cached, options?.onBytes)
  })
}
