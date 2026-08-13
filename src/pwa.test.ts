import { describe, expect, it } from 'vitest'
import { createUpdateGate } from './pwaUpdate'

describe('createUpdateGate', () => {
  it('notifies subscribers when a new worker is waiting', () => {
    const gate = createUpdateGate()
    const seen: boolean[] = []
    const stop = gate.subscribe((ready) => { seen.push(ready) })
    expect(seen).toEqual([])
    gate.notify()
    expect(seen).toEqual([true])
    expect(gate.ready).toBe(true)
    stop()
  })

  it('replays the waiting state to a late subscriber', () => {
    const gate = createUpdateGate()
    gate.notify()
    let latest = false
    gate.subscribe((ready) => { latest = ready })
    expect(latest).toBe(true)
  })

  it('lets Later hide the banner without applying the worker', () => {
    const gate = createUpdateGate()
    const seen: boolean[] = []
    gate.subscribe((ready) => { seen.push(ready) })
    gate.notify()
    gate.dismiss()
    expect(seen).toEqual([true, false])
    expect(gate.ready).toBe(false)
  })
})
