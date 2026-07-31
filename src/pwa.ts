import { registerSW } from 'virtual:pwa-register'

type UpdateSW = (reloadPage?: boolean) => Promise<void>

let updateSW: UpdateSW | null = null
let registration: ServiceWorkerRegistration | null | undefined

export function initPwa() {
  updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, swRegistration) {
      registration = swRegistration
    },
  })
}

export async function forceAppUpdate() {
  try {
    const reg =
      registration ??
      (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
        ? await navigator.serviceWorker.getRegistration()
        : undefined)

    if (reg) {
      registration = reg
      await reg.update()
      if (reg.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      }
    }
  } catch {
    /* Registration may be unavailable offline or unsupported. */
  }

  if (updateSW) {
    try {
      await updateSW(true)
    } catch {
      /* autoUpdate may treat updateSW as a no-op for reload. */
    }
  }

  // Always reload so Force update cannot leave the UI stuck when already current.
  window.location.reload()
}
