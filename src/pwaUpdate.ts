export type UpdateListener = (ready: boolean) => void

export function createUpdateGate() {
  let ready = false
  const listeners = new Set<UpdateListener>()
  return {
    get ready() {
      return ready
    },
    notify() {
      ready = true
      listeners.forEach((listener) => listener(true))
    },
    dismiss() {
      ready = false
      listeners.forEach((listener) => listener(false))
    },
    subscribe(listener: UpdateListener) {
      listeners.add(listener)
      if (ready) listener(true)
      return () => { listeners.delete(listener) }
    },
  }
}
