import { registerSW } from 'virtual:pwa-register'
import { createUpdateGate, type UpdateListener } from './pwaUpdate'

type UpdateSW = (reloadPage?: boolean) => Promise<void>

const updateGate = createUpdateGate()
let updateSW: UpdateSW | null = null
let registration: ServiceWorkerRegistration | null | undefined

export function initPwa() {
  updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, swRegistration) {
      registration = swRegistration
    },
    onNeedRefresh() {
      updateGate.notify()
    },
  })
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
        await applyAppUpdate()
        return
      }
    }
  } catch {
    /* Registration may be unavailable offline or unsupported. */
  }

  if (updateGate.ready) {
    await applyAppUpdate()
    return
  }

  window.location.reload()
}
