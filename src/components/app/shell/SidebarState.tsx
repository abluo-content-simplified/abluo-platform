'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  appNavCookie,
  navModeFor,
  withNavGroupOpen,
  withNavMode,
  type NavLayout,
  type NavPreferences,
} from '@/lib/app-nav-preferences'

/**
 * The remembered state of the sidebar (ADR-042 N3, N4, N4a, section 4): which
 * layout is collapsed to the rail (desktop and tablet independently) and which
 * groups are open. It wraps the page frame, so the SAME element carries the
 * state as data attributes and the main column can follow the sidebar's width
 * with plain CSS (`group-data-[nav-t=rail]/nav:` …) — the server renders the
 * remembered state from the cookie, so there is no flash and no viewport
 * measuring at render. Changes are written to the cookie at once.
 *
 * Tablet = md up to lg, desktop = lg and up; below md the drawer is used.
 */
type SidebarStateValue = {
  prefs: NavPreferences
  /** Collapse / expand the layout currently shown. */
  toggleLayout: (layout: NavLayout) => void
  setGroupOpen: (group: string, open: boolean) => void
}

const Ctx = createContext<SidebarStateValue | null>(null)

/** The sidebar state; outside a provider the sidebar is simply expanded and nothing is remembered. */
export function useSidebarState(): SidebarStateValue | null {
  return useContext(Ctx)
}

/** The layout the viewport shows now (tablet = md to lg, desktop = lg+). Call from an event handler. */
export function currentNavLayout(): NavLayout {
  return window.matchMedia('(min-width: 64rem)').matches ? 'desktop' : 'tablet'
}

export function SidebarStateProvider({ initial, className = '', children }: { initial: NavPreferences; className?: string; children: ReactNode }) {
  const [prefs, setPrefs] = useState(initial)
  const written = useRef(initial)

  // Persist after the state changed (event handlers only change it; the effect writes the cookie).
  useEffect(() => {
    if (written.current === prefs) return
    written.current = prefs
    try {
      document.cookie = appNavCookie(prefs)
    } catch {
      /* cookies unavailable: the choice lasts until reload */
    }
  }, [prefs])

  const toggleLayout = useCallback((layout: NavLayout) => {
    setPrefs((p) => withNavMode(p, layout, navModeFor(p, layout) === 'rail' ? 'expanded' : 'rail'))
  }, [])
  const setGroupOpen = useCallback((group: string, open: boolean) => {
    setPrefs((p) => (p.groups[group] === open ? p : withNavGroupOpen(p, group, open)))
  }, [])
  const value = useMemo(() => ({ prefs, toggleLayout, setGroupOpen }), [prefs, toggleLayout, setGroupOpen])

  return (
    <Ctx.Provider value={value}>
      <div data-nav-t={navModeFor(prefs, 'tablet')} data-nav-d={navModeFor(prefs, 'desktop')} className={`group/nav ${className}`}>
        {children}
      </div>
    </Ctx.Provider>
  )
}
