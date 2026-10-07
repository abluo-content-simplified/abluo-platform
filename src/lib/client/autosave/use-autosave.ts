'use client'

/**
 * React binding for the autosave engine: one engine per draft, the browser
 * journal (IndexedDB), and the page-lifecycle flushes — leaving the tab
 * (`visibilitychange` → hidden), closing it (`pagehide`), and coming back
 * online (`online` → retry now).
 *
 * `draftId` is the journal key the engine STARTS with (a temporary one for a
 * draft that does not exist yet); `rekey(realKey)` moves the journal once the
 * draft is created, without recreating the engine.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createAutosave, type Autosave, type SaveState, type SendResult } from './engine'
import { createIdbJournal, type JournalStorage, type PendingSet } from './journal'

export function useAutosave({
  draftId,
  rev,
  send,
  storage,
  onReady,
}: {
  draftId: string
  rev: string
  send: (input: { rev: string; set: PendingSet }) => Promise<SendResult>
  storage?: JournalStorage
  /** Called once the journal has been read: with the replayed paths, or null. */
  onReady?: (replayed: PendingSet | null) => void
}) {
  const [state, setState] = useState<SaveState>('idle')
  const [rejected, setRejected] = useState<string[]>([])
  const [replayed, setReplayed] = useState<PendingSet | null | undefined>(undefined)
  const engineRef = useRef<Autosave | null>(null)
  const sendRef = useRef(send)
  const readyRef = useRef(onReady)
  useEffect(() => {
    sendRef.current = send
    readyRef.current = onReady
  }, [send, onReady])

  useEffect(() => {
    const engine = createAutosave({
      draftId,
      rev,
      send: (input) => sendRef.current(input),
      storage: storage ?? createIdbJournal(),
      onState: setState,
      onRejected: setRejected,
    })
    engineRef.current = engine
    let alive = true
    engine
      .replay()
      .catch(() => null)
      .then((r) => {
        if (!alive) return
        setReplayed(r)
        readyRef.current?.(r)
      })

    const onHidden = () => {
      if (document.visibilityState === 'hidden') void engine.flush()
    }
    const onPageHide = () => void engine.flush()
    const onOnline = () => engine.retryNow()
    document.addEventListener('visibilitychange', onHidden)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('online', onOnline)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', onHidden)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('online', onOnline)
      void engine.flush().finally(() => engine.dispose())
    }
    // The engine lives for the draft; a new rev from props must not reset it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId])

  const set = useCallback((patch: PendingSet) => engineRef.current?.set(patch), [])
  const flush = useCallback(async () => (engineRef.current ? engineRef.current.flush() : true), [])
  const currentRev = useCallback(() => engineRef.current?.rev ?? rev, [rev])
  const discard = useCallback(async () => engineRef.current?.discard(), [])
  const adoptRev = useCallback((next: string) => engineRef.current?.setRev(next), [])
  const currentState = useCallback((): SaveState => engineRef.current?.state ?? 'idle', [])
  const retry = useCallback(() => engineRef.current?.retryNow(), [])
  const rekey = useCallback(async (nextKey: string) => engineRef.current?.rekey(nextKey), [])

  return { state, rejected, set, flush, currentRev, currentState, discard, adoptRev, retry, rekey, replayed }
}
