import type { TranscriptCue } from './openRouter'

const DB_NAME = 'podflow'
const STORE = 'transcripts'
const DB_VERSION = 1

export type CueMap = Record<string, TranscriptCue[]>

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open transcript storage.'))
  })
}

export async function loadAllTranscripts(): Promise<CueMap> {
  if (typeof indexedDB === 'undefined') return {}
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const map: CueMap = {}
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const cues = cursor.value as TranscriptCue[] | undefined
        if (Array.isArray(cues)) map[String(cursor.key)] = cues
        cursor.continue()
      }
      request.onerror = () => reject(request.error ?? new Error('Could not read transcripts.'))
      tx.oncomplete = () => resolve(map)
      tx.onerror = () => reject(tx.error ?? new Error('Could not read transcripts.'))
    })
  } finally {
    db.close()
  }
}

export async function saveTranscript(episodeId: string, cues: TranscriptCue[]) {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(cues, episodeId)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function deleteTranscript(episodeId: string) {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(episodeId)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function saveAllTranscripts(map: CueMap) {
  const ids = Object.keys(map)
  await Promise.all(ids.map((id) => saveTranscript(id, map[id] ?? [])))
}
