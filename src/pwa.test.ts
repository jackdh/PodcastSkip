import { describe, expect, it } from 'vitest'
import { appShellCacheKeys, DOWNLOAD_CACHE_NAME, forceAppUpdate, freshReloadUrl, pathWithoutFreshParam } from './pwa'
import { createUpdateGate } from './pwaUpdate'

describe('force update cache bust', () => {
  it('keeps the download cache and drops app-shell caches', () => {
    expect(appShellCacheKeys([
      'workbox-precache-v2',
      DOWNLOAD_CACHE_NAME,
      'podflow-downloads-v1',
      'other-shell',
    ])).toEqual(['workbox-precache-v2', 'other-shell'])
  })

  it('builds a cache-busted url and then strips the fresh param', () => {
    const next = freshReloadUrl('https://podcastskip.pages.dev/settings?tab=1#player', 1700000000000)
    expect(next).toBe('https://podcastskip.pages.dev/settings?tab=1&fresh=1700000000000')
    expect(pathWithoutFreshParam(next)).toBe('/settings?tab=1')
    expect(pathWithoutFreshParam('https://podcastskip.pages.dev/settings')).toBeNull()
  })

  it('unregisters workers, deletes app-shell caches, and navigates to a cache-busted url', async () => {
    const unregistered: string[] = []
    const deleted: string[] = []
    let replaced = ''
    await forceAppUpdate({
      async registrations() {
        return [{
          async unregister() {
            unregistered.push('worker')
            return true
          },
        }]
      },
      async cacheKeys() {
        return ['workbox-precache-v2', DOWNLOAD_CACHE_NAME]
      },
      async deleteCache(key) {
        deleted.push(key)
        return true
      },
      href: () => 'https://podcastskip.pages.dev/settings#now',
      replace(url) {
        replaced = url
      },
    })
    expect(unregistered).toEqual(['worker'])
    expect(deleted).toEqual(['workbox-precache-v2'])
    const next = new URL(replaced)
    expect(next.origin + next.pathname).toBe('https://podcastskip.pages.dev/settings')
    expect(next.searchParams.get('fresh')).toMatch(/^\d+$/)
    expect(next.hash).toBe('')
  })
})

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
