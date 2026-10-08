'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export const UNDO_DELAY_MS = 5000

type Pending = { timer: ReturnType<typeof setTimeout>; commit: () => void }
export type ToastState = { message: string; tone: 'status' | 'error'; undo?: () => void } | null

/**
 * "Deleted · Undo": the change shows at once, the server call waits
 * UNDO_DELAY_MS so Undo can cancel it. Leaving the page (or this screen)
 * before then carries it out — the person did not undo. A failed call puts
 * the item back and says so.
 */
export function useUndo() {
  const [toast, setToast] = useState<ToastState>(null)
  const pending = useRef(new Map<string, Pending>())
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((next: ToastState, ms = UNDO_DELAY_MS) => {
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setToast(next)
    if (next) hideTimer.current = setTimeout(() => setToast(null), ms)
  }, [])

  const schedule = useCallback(
    (job: {
      id: string
      message: string
      undoLabel: string
      run: () => Promise<boolean>
      restore: () => void
      failMessage: string
    }) => {
      let done = false
      const commit = () => {
        if (done) return
        done = true
        pending.current.delete(job.id)
        void job
          .run()
          .catch(() => false)
          .then((ok) => {
            if (!ok) {
              job.restore()
              show({ message: job.failMessage, tone: 'error' })
            }
          })
      }
      const timer = setTimeout(commit, UNDO_DELAY_MS)
      pending.current.set(job.id, { timer, commit })
      show({
        message: job.message,
        tone: 'status',
        undo: () => {
          if (done) return
          done = true
          clearTimeout(timer)
          pending.current.delete(job.id)
          job.restore()
          show(null)
        },
      })
    },
    [show]
  )

  // Leaving before the delay is up: carry out what wasn't undone.
  useEffect(() => {
    const all = pending.current
    const flush = () => {
      for (const p of [...all.values()]) {
        clearTimeout(p.timer)
        p.commit()
      }
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  return { toast, show, schedule }
}
