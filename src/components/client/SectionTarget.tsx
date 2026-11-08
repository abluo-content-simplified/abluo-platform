'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from '@/i18n/navigation'
import { SECTION_TARGET_EVENT, sectionIdFromHref, shouldReveal } from '@/lib/client/section-target'

/** The phone top bar (h-14) plus a little air; the window is the scroller. */
const SCROLL_MARGIN = '4.5rem'
const FLASH_MS = 1500
const GIVE_UP_MS = 3000

/**
 * Scrolls to and briefly highlights the section named by the URL hash (or by a
 * search result that just navigated here), and moves focus to its heading.
 * Mounted once in the dashboard layout. Sections only need a stable `id`.
 *
 * Triggers: first load, route change (cross-page push), `hashchange`, and the
 * SECTION_TARGET_EVENT that ClientSearch dispatches after router.push — App
 * Router does not fire hashchange for a push to the page you are already on.
 * The section may not be rendered yet, so we poll briefly for it.
 */
export function SectionTarget() {
  const pathname = usePathname()
  const last = useRef<{ id: string; at: number } | null>(null)
  const timers = useRef<{ poll?: ReturnType<typeof setInterval>; flash?: ReturnType<typeof setTimeout> }>({})

  useEffect(() => {
    const clearPoll = () => {
      if (timers.current.poll) clearInterval(timers.current.poll)
      timers.current.poll = undefined
    }
    const reveal = (id: string) => {
      if (!shouldReveal(last.current, id, Date.now())) return
      clearPoll()
      const started = Date.now()
      const attempt = (): boolean => {
        const el = document.getElementById(id)
        if (!el) return false
        last.current = { id, at: Date.now() }
        el.style.scrollMarginTop = SCROLL_MARGIN
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
        // Focus the heading (or the control itself) so screen readers announce where they landed.
        const focusable = el.matches('button, a, input, select, textarea') ? el : el.querySelector<HTMLElement>('h1, h2, h3')
        if (focusable) {
          if (!focusable.matches('button, a, input, select, textarea') && !focusable.hasAttribute('tabindex')) focusable.tabIndex = -1
          focusable.focus({ preventScroll: true })
        }
        el.removeAttribute('data-section-flash')
        void el.offsetWidth // restart the animation when the same section is chosen twice
        el.setAttribute('data-section-flash', '')
        if (timers.current.flash) clearTimeout(timers.current.flash)
        timers.current.flash = setTimeout(() => el.removeAttribute('data-section-flash'), FLASH_MS)
        return true
      }
      // Next tick first: the push may not have rendered the page yet.
      timers.current.poll = setInterval(() => {
        if (attempt() || Date.now() - started > GIVE_UP_MS) clearPoll()
      }, 80)
    }

    const fromHash = () => {
      const id = sectionIdFromHref(window.location.hash)
      if (id) reveal(id)
    }
    const onEvent = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (typeof id === 'string' && id) reveal(id)
    }
    fromHash()
    window.addEventListener('hashchange', fromHash)
    window.addEventListener(SECTION_TARGET_EVENT, onEvent)
    return () => {
      window.removeEventListener('hashchange', fromHash)
      window.removeEventListener(SECTION_TARGET_EVENT, onEvent)
      clearPoll()
    }
  }, [pathname])

  return null
}
