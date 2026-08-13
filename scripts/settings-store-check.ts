import { readStoredApiKey, writeStoredSettings } from '../src/settingsStore.ts'

const store: Record<string, string> = {}
globalThis.localStorage = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value },
  removeItem: (key: string) => { delete store[key] },
} as Storage

writeStoredSettings({ apiKey: 'sk-or-v1-keep-me', model: 'google/gemini-2.5-flash' })
writeStoredSettings({ apiKey: '', model: 'deepseek/deepseek-v4-flash' })

if (readStoredApiKey() !== 'sk-or-v1-keep-me') {
  throw new Error(`expected key to survive a blank rewrite, got ${readStoredApiKey()}`)
}
if (JSON.parse(store['podflow-settings']).model !== 'deepseek/deepseek-v4-flash') {
  throw new Error('other settings should still update')
}
console.log('settingsStore: API key survives blank rebuild write OK')
