const SETTINGS_KEY = 'podflow-settings'
const API_KEY_KEY = 'podflow-openrouter-key'

export type StoredSettings = {
  skipAds?: boolean
  model?: string
  sttModel?: string
  apiKey?: string
  analyseMinutes?: number
  playbackRate?: number
}

function readJson(key: string): StoredSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}') as StoredSettings
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function readStoredApiKey(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    const dedicated = localStorage.getItem(API_KEY_KEY)?.trim()
    if (dedicated) return dedicated
    const fromSettings = String(readJson(SETTINGS_KEY).apiKey ?? '').trim()
    if (fromSettings) {
      localStorage.setItem(API_KEY_KEY, fromSettings)
      return fromSettings
    }
  } catch {
    /* Quota or private mode. */
  }
  return ''
}

export function writeStoredApiKey(key: string) {
  if (typeof localStorage === 'undefined') return
  const trimmed = key.trim()
  if (!trimmed) return
  try {
    localStorage.setItem(API_KEY_KEY, trimmed)
  } catch {
    /* Keep going; settings blob may still hold a copy. */
  }
}

export function readStoredSettings(): StoredSettings {
  if (typeof localStorage === 'undefined') return {}
  const settings = readJson(SETTINGS_KEY)
  const apiKey = readStoredApiKey() || String(settings.apiKey ?? '').trim()
  return { ...settings, apiKey }
}

export function writeStoredSettings(next: StoredSettings) {
  if (typeof localStorage === 'undefined') return
  const existing = readStoredSettings()
  const apiKey = String(next.apiKey ?? '').trim() || existing.apiKey || ''
  writeStoredApiKey(apiKey)
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...existing, ...next, apiKey }))
  } catch {
    writeStoredApiKey(apiKey)
  }
}
