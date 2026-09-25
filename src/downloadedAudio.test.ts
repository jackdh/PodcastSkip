import { describe, expect, it } from 'vitest'
import { blobWithType, episodeStorageName, hasDownloadedAudio, writeResponseBody } from './downloadedAudio'

function chunkStream(chunks: Uint8Array[]) {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close()
        return
      }
      const next = chunks[index]
      index += 1
      controller.enqueue(next)
    },
  })
}

describe('writeResponseBody', () => {
  it('writes each stream chunk and never calls blob() or arrayBuffer()', async () => {
    const chunks = [new Uint8Array([1, 2, 3]), new Uint8Array([4, 5]), new Uint8Array(64 * 1024)]
    const response = new Response(chunkStream(chunks), { headers: { 'Content-Type': 'audio/mpeg' } })
    let materialized = false
    response.blob = async () => {
      materialized = true
      return new Blob()
    }
    response.arrayBuffer = async () => {
      materialized = true
      return new ArrayBuffer(0)
    }
    const written: number[] = []
    const bytes = await writeResponseBody(response, {
      async write(chunk) {
        written.push(chunk.byteLength)
      },
      async close() {},
      async abort() {
        throw new Error('should not abort')
      },
    })
    expect(materialized).toBe(false)
    expect(bytes).toBe(3 + 2 + 64 * 1024)
    expect(written).toEqual([3, 2, 64 * 1024])
    expect(Math.max(...written)).toBeLessThanOrEqual(64 * 1024)
  })

  it('aborts the sink and rethrows when a write fails', async () => {
    const response = new Response(chunkStream([new Uint8Array([1, 2]), new Uint8Array([3])]))
    let aborted = false
    await expect(writeResponseBody(response, {
      async write() {
        throw new Error('disk full')
      },
      async close() {},
      async abort() {
        aborted = true
      },
    })).rejects.toThrow('disk full')
    expect(aborted).toBe(true)
  })

  it('throws when the response has no body', async () => {
    const response = new Response(null)
    await expect(writeResponseBody(response, {
      async write() {},
      async close() {},
      async abort() {},
    })).rejects.toThrow('no readable body')
  })
})

describe('episode files', () => {
  it('names a file from a hash of the playback url', async () => {
    const key = '/api/audio?source=https://example.com/darknet.mp3'
    const name = await episodeStorageName(key)
    expect(name).toMatch(/^[0-9a-f]{64}$/)
    expect(name).not.toContain('http')
    expect(await episodeStorageName(key)).toBe(name)
  })

  it('sets a mime type with a slice instead of a new copy of the bytes', async () => {
    const source = new Blob([Uint8Array.from([9, 8, 7])])
    let copied = false
    const original = source.arrayBuffer.bind(source)
    source.arrayBuffer = async () => {
      copied = true
      return original()
    }
    const typed = blobWithType(source, 'audio/mp4; charset=binary')
    expect(typed.type).toBe('audio/mp4')
    expect(typed.size).toBe(source.size)
    expect(copied).toBe(false)
    expect(new Uint8Array(await typed.arrayBuffer())).toEqual(Uint8Array.from([9, 8, 7]))
  })

  it('reports an episode as not on disk until it has been saved', async () => {
    expect(await hasDownloadedAudio('/api/audio?source=missing')).toBe(false)
  })
})
