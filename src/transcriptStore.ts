import type { TranscriptCue } from './openRouter'
import { rangesFromCues, type TimeRange } from './scanCache'

const DB_NAME = 'podflow'
const STORE = 'transcripts'
const DB_VERSION = 1

export type CueMap = Record<string, TranscriptCue[]>

export type ScanRecord = {
  version: 2
  sttModel: string
  duration: number
  ranges: TimeRange[]
  cues: TranscriptCue[]
  adsAnalyzedThrough: number
  updatedAt: number
}

export type ScanMap = Record<string, ScanRecord>

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

export function scanRecordFromCues(cues: TranscriptCue[], extras?: Partial<ScanRecord>): ScanRecord {
  const ranges = extras?.ranges ?? rangesFromCues(cues)
  return {
    version: 2,
    sttModel: extras?.sttModel ?? '',
    duration: extras?.duration ?? 0,
    ranges,
    cues,
    adsAnalyzedThrough: extras?.adsAnalyzedThrough ?? 0,
    updatedAt: extras?.updatedAt ?? Date.now(),
  }
}

export function normalizeScanRecord(value: unknown): ScanRecord | null {
  if (Array.isArray(value)) {
    const cues = value.filter((cue): cue is TranscriptCue =>
      Boolean(cue) && Number.isFinite((cue as TranscriptCue).start) && Number.isFinite((cue as TranscriptCue).end) && typeof (cue as TranscriptCue).text === 'string',
    )
    return cues.length ? scanRecordFromCues(cues) : null
  }
  if (!value || typeof value !== 'object') return null
  const record = value as Partial<ScanRecord>
  if (!Array.isArray(record.cues)) return null
  return scanRecordFromCues(record.cues, {
    sttModel: typeof record.sttModel === 'string' ? record.sttModel : '',
    duration: Number.isFinite(record.duration) ? Number(record.duration) : 0,
    ranges: Array.isArray(record.ranges) ? record.ranges : undefined,
    adsAnalyzedThrough: Number.isFinite(record.adsAnalyzedThrough) ? Number(record.adsAnalyzedThrough) : 0,
    updatedAt: Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : Date.now(),
  })
}

export async function loadAllScans(): Promise<ScanMap> {
  if (typeof indexedDB === 'undefined') return {}
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const store = tx.objectStore(STORE)
      const map: ScanMap = {}
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (!cursor) return
        const record = normalizeScanRecord(cursor.value)
        if (record) map[String(cursor.key)] = record
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

export async function loadAllTranscripts(): Promise<CueMap> {
  const scans = await loadAllScans()
  return Object.fromEntries(Object.entries(scans).map(([id, record]) => [id, record.cues]))
}

export async function saveScan(episodeId: string, record: ScanRecord) {
  if (typeof indexedDB === 'undefined') return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, 'readwrite').objectStore(STORE).put(record, episodeId)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function saveTranscript(episodeId: string, cues: TranscriptCue[]) {
  await saveScan(episodeId, scanRecordFromCues(cues))
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
  const existing = await loadAllScans().catch(() => ({} as ScanMap))
  await Promise.all(Object.keys(map).map((id) => (
    saveScan(id, scanRecordFromCues(map[id] ?? [], existing[id]))
  )))
}
