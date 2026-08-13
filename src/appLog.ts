const STORAGE_KEY = 'podflow-debug-logs'
const MAX_ENTRIES = 200
const MAX_CHARS = 80_000

export type LogLevel = 'info' | 'warn' | 'error'

export type LogEntry = {
  t: string
  level: LogLevel
  msg: string
  extra?: string
}

function redact(value: string) {
  return value
    .replace(/sk-or-v1-[A-Za-z0-9]+/g, 'sk-or-v1-REDACTED')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer REDACTED')
}

function serializeExtra(extra: unknown): string | undefined {
  if (extra === undefined) return undefined
  try {
    const text = typeof extra === 'string' ? extra : JSON.stringify(extra)
    return redact(text).slice(0, 800)
  } catch {
    return String(extra).slice(0, 200)
  }
}

function loadEntries(): LogEntry[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as LogEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function persist(entries: LogEntry[]) {
  if (typeof localStorage === 'undefined') return
  let next = entries.slice(-MAX_ENTRIES)
  let json = JSON.stringify(next)
  while (next.length > 20 && json.length > MAX_CHARS) {
    next = next.slice(Math.ceil(next.length / 6))
    json = JSON.stringify(next)
  }
  try {
    localStorage.setItem(STORAGE_KEY, json)
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next.slice(-40)))
    } catch {
      /* Quota is exhausted; keep going without logs. */
    }
  }
}

export function memorySnapshot() {
  const memory = (performance as Performance & {
    memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
  }).memory
  if (!memory) return undefined
  const mb = (bytes: number) => `${Math.round(bytes / 1_048_576)}MB`
  return `${mb(memory.usedJSHeapSize)}/${mb(memory.totalJSHeapSize)} limit ${mb(memory.jsHeapSizeLimit)}`
}

export function appLog(level: LogLevel, msg: string, extra?: unknown) {
  const entry: LogEntry = {
    t: new Date().toISOString(),
    level,
    msg: redact(msg),
    extra: serializeExtra(extra),
  }
  const entries = [...loadEntries(), entry]
  persist(entries)
  if (level === 'error') console.error(entry.msg, extra ?? '')
}

export function formatDebugLogs() {
  const header = [
    `Podflow logs`,
    `version ${typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '?'} · built ${typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '?'}`,
    typeof navigator !== 'undefined' ? navigator.userAgent : 'no-navigator',
    `memory ${memorySnapshot() ?? 'n/a'}`,
    `copied ${new Date().toISOString()}`,
    '',
  ].join('\n')
  const lines = loadEntries().map((entry) => {
    const extra = entry.extra ? ` ${entry.extra}` : ''
    return `${entry.t} [${entry.level}] ${entry.msg}${extra}`
  })
  return `${header}${lines.join('\n') || '(no log lines yet)'}\n`
}

export async function copyDebugLogs() {
  const text = formatDebugLogs()
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '0'
  area.style.left = '0'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  document.body.removeChild(area)
}

export function clearDebugLogs() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}

export function installAppLog() {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (event) => {
    appLog('error', event.message || 'window.error', {
      file: event.filename,
      line: event.lineno,
      col: event.colno,
      stack: event.error instanceof Error ? event.error.stack : undefined,
    })
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    appLog('error', 'unhandledrejection', {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })
  window.addEventListener('pagehide', (event) => {
    appLog('info', 'pagehide', { persisted: event.persisted, memory: memorySnapshot() })
  })
  appLog('info', 'app start', { memory: memorySnapshot(), href: window.location.href })
}
