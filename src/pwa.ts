import { registerSW } from 'virtual:pwa-register'

export const DOWNLOAD_CACHE_NAME = 'podflow-downloads-v1'

type UpdateSW = (reloadPage?: boolean) => Promise<void>

let updateSW: UpdateSW | null = null
let registration: ServiceWorkerRegistration | null | undefined

function stripFreshParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('fresh')) return
  url.searchParams.delete('fresh')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(null, '', next || '/')
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
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForWorkerUpdate()
  })
  window.addEventListener('focus', () => { void checkForWorkerUpdate() })
}

export async function forceAppUpdate() {
  // iOS home-screen PWAs often ignore skipWaiting + location.reload() and keep
  // serving the precached shell. Drop the worker and app caches, then navigate
  // to a cache-busted URL so the next load comes from the network.
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map((reg) => reg.unregister()))
    }
  } catch {
    /* Unsupported or already gone. */
  }

  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key !== DOWNLOAD_CACHE_NAME)
          .map((key) => caches.delete(key)),
      )
    }
  } catch {
    /* Cache API may be missing. */
  }

  try {
    await updateSW?.(false)
  } catch {
    /* Registration is already torn down. */
  }

  const url = new URL(window.location.href)
  url.searchParams.set('fresh', String(Date.now()))
  url.hash = ''
  window.location.replace(url.toString())
}
