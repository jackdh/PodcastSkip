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
    await registration?.update()
  } catch {
    /* Registration may be unavailable offline or unsupported. */
  }

  if (updateSW) {
    await updateSW(true)
    return
  }

  window.location.reload()
}
