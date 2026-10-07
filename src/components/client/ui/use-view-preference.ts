'use client'

import { useCallback, useSyncExternalStore } from 'react'

/**
 * A per-browser view choice (List / Grid …) for one list page, kept in
 * localStorage under `key`. Read through useSyncExternalStore so the server
 * render and the first paint agree (the server always renders `fallback`).
 * Storage unavailable → the choice lasts until reload.
 *
 *   const [view, setView] = useViewPreference('abluo.media.view', ['grid', 'list'] as const, 'grid')
 */
const listeners = new Map<string, Set<() => void>>()
const memory = new Map<string, string>()

function emit(key: string) {
  listeners.get(key)?.forEach((l) => l())
}

export function useViewPreference<V extends string>(key: string, values: readonly V[], fallback: V): [V, (v: V) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!listeners.has(key)) listeners.set(key, new Set())
      listeners.get(key)!.add(listener)
      const onStorage = (e: StorageEvent) => e.key === key && listener()
      window.addEventListener('storage', onStorage)
      return () => {
        listeners.get(key)?.delete(listener)
        window.removeEventListener('storage', onStorage)
      }
    },
    [key]
  )
  const read = useCallback((): V => {
    let saved: string | null = null
    try {
      saved = window.localStorage.getItem(key)
    } catch {
      /* storage unavailable */
    }
    saved ??= memory.get(key) ?? null
    return saved && (values as readonly string[]).includes(saved) ? (saved as V) : fallback
  }, [key, values, fallback])
  const view = useSyncExternalStore(subscribe, read, () => fallback)
  const setView = useCallback(
    (v: V) => {
      try {
        window.localStorage.setItem(key, v)
      } catch {
        memory.set(key, v)
      }
      emit(key)
    },
    [key]
  )
  return [view, setView]
}
