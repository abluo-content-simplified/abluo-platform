'use client'

import { useCallback, useEffect, useRef } from 'react'

/**
 * Follow a search landing while the list screen is already mounted (the
 * search overlay navigates to the same route with a new `?q=` / `?open=`, and
 * Next keeps the component's state). `value` is the page's landing key (the
 * server-read address); `apply` runs when a new, non-empty value arrives.
 *
 * Values the screen wrote itself are ignored: call the returned `note(value)`
 * before writing a URL, otherwise the server's echo of it would reset what the
 * person is typing. `normalize` makes the comparison tolerant of the server's
 * cleaning (trim, cap). The initial value is already applied by the screen's
 * initial state.
 */
export function useSearchLanding(
  value: string,
  apply: (value: string) => void,
  options: { normalize?: (v: string) => string; accept?: (v: string) => boolean } = {}
): (written: string) => void {
  const normalize = options.normalize ?? ((v: string) => v)
  const seen = useRef<Set<string> | null>(null)
  if (seen.current === null) seen.current = new Set([normalize(value)])
  const latest = useRef({ apply, accept: options.accept, normalize })
  useEffect(() => {
    latest.current = { apply, accept: options.accept, normalize }
  })
  useEffect(() => {
    const key = latest.current.normalize(value)
    if (seen.current!.has(key)) return
    seen.current!.add(key)
    if (key === '' || (latest.current.accept && !latest.current.accept(key))) return
    latest.current.apply(key)
  }, [value])
  return useCallback((written: string) => {
    seen.current!.add(latest.current.normalize(written))
  }, [])
}

/**
 * For screens that keep their search text in local state (not in the
 * address): `value` is the live `?q=` / `?open=` read with `useSearchParams`.
 * `apply` runs each time it changes to a new non-empty value, so searching
 * the same words again after clearing the box works (the screen strips the
 * param from the address once applied, see use-strip-search-param.ts). The
 * value present at mount is already applied by the screen's initial state.
 */
export function useLandedParam(value: string, apply: (value: string) => void): void {
  const prev = useRef(value)
  const latest = useRef(apply)
  useEffect(() => {
    latest.current = apply
  })
  useEffect(() => {
    if (value === prev.current) return
    prev.current = value
    if (value) latest.current(value)
  }, [value])
}
