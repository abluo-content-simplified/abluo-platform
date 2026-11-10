import { useEffect, useRef } from 'react'

/** Runs `tick` every `ms` while the tab is visible (and once when it becomes visible again). */
export function useVisibleInterval(tick: () => void | Promise<void>, ms: number, enabled = true) {
  const ref = useRef(tick)
  ref.current = tick
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setInterval> | null = null
    const run = () => {
      void Promise.resolve(ref.current()).catch(() => {})
    }
    const start = () => {
      if (timer === null) timer = setInterval(run, ms)
    }
    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        run()
        start()
      } else stop()
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [ms, enabled])
}
