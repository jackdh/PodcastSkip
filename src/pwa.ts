import { registerSW } from 'virtual:pwa-register'
import { createUpdateGate, type UpdateListener } from './pwaUpdate'

type UpdateSW = (reloadPage?: boolean) => Promise<void>

/** Cache Storage name for downloaded episodes. Force update must not delete it. */
export const DOWNLOAD_CACHE_NAME = 'podflow-downloads-v1'

const updateGate = createUpdateGate()
let updateSW: UpdateSW | null = null
let registration: ServiceWorkerRegistration | null | undefined

export function appShellCacheKeys(keys: string[], downloadCacheName = DOWNLOAD_CACHE_NAME) {
  return keys.filter((key) => key !== downloadCacheName)
}

/** Cache-busted URL so iOS standalone does not reuse the precached shell. */
export function freshReloadUrl(href: string, now = Date.now()) {
  const url = new URL(href)
  url.searchParams.set('fresh', String(now))
  url.hash = ''
  return url.toString()
}

/** Path to replace in history after a cache-busted load, or null when `fresh` is absent. */
export function pathWithoutFreshParam(href: string) {
  const url = new URL(href)
  if (!url.searchParams.has('fresh')) return null
  url.searchParams.delete('fresh')
  return `${url.pathname}${url.search}${url.hash}` || '/'
}

function stripFreshParam() {
  if (typeof window === 'undefined') return
  const next = pathWithoutFreshParam(window.location.href)
  if (!next) return
  window.history.replaceState(null, '', next)
}

async function checkForWorkerUpdate() {
  try {
    await (registration ?? (await navigator.serviceWorker.getRegistration()))?.update()
  } catch {
    /* Offline or no worker yet. */
  }
}

export function initPwa() {
  stripFreshParam()

  updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, swRegistration) {
      registration = swRegistration
    },
    onNeedRefresh() {
      updateGate.notify()
    },
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForWorkerUpdate()
  })
  window.addEventListener('focus', () => { void checkForWorkerUpdate() })
}

export function subscribeAppUpdate(listener: UpdateListener) {
  return updateGate.subscribe(listener)
}

export function dismissAppUpdate() {
  updateGate.dismiss()
}

export async function applyAppUpdate() {
  if (updateSW) {
    try {
      await updateSW(true)
      return
    } catch {
      /* Fall through to a plain reload. */
    }
  }
  window.location.reload()
}

type ForceUpdateHost = {
  registrations: () => Promise<ReadonlyArray<{ unregister: () => Promise<unknown> }>>
  cacheKeys: () => Promise<string[]>
  deleteCache: (key: string) => Promise<unknown>
  href: () => string
  replace: (url: string) => void
}

function browserForceUpdateHost(): ForceUpdateHost {
  return {
    async registrations() {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return []
      return navigator.serviceWorker.getRegistrations()
    },
    async cacheKeys() {
      if (typeof caches === 'undefined') return []
      return caches.keys()
    },
    deleteCache(key) {
      return caches.delete(key)
    },
    href: () => window.location.href,
    replace: (url) => window.location.replace(url),
  }
}

export async function forceAppUpdate(host: ForceUpdateHost = browserForceUpdateHost()) {
  // iOS home-screen PWAs ignore skipWaiting + location.reload() and keep serving
  // the precached shell. Drop every worker and the app-shell caches, then open a
  // cache-busted URL. The Reload banner still uses applyAppUpdate().
  try {
    const regs = await host.registrations()
    await Promise.all(regs.map((reg) => reg.unregister()))
  } catch {
    /* Unsupported or already gone. */
  }

  try {
    const keys = await host.cacheKeys()
    await Promise.all(appShellCacheKeys(keys).map((key) => host.deleteCache(key)))
  } catch {
    /* Cache API may be missing. */
  }

  host.replace(freshReloadUrl(host.href()))
}
