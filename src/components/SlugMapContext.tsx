'use client'

/**
 * SlugMapContext — shares the current page's per-locale slug map
 * between the layout nav (LanguageSwitcher) and the page that knows its slugs.
 *
 * Architecture note — why the two-component pattern:
 *
 * In Next.js App Router the layout renders ABOVE {children} in the React tree.
 * React context only flows DOWN, so a provider inside page.tsx cannot supply
 * data to components in layout.tsx (e.g. the LanguageSwitcher in NavClient).
 *
 * Solution:
 *   • SlugMapRoot  — placed in the tenant layout. Owns the slug map state via
 *     useState, so it wraps both the nav (above) and the page (below).
 *   • SlugMapProvider — placed in [slug]/page.tsx. Uses useEffect to PUSH the
 *     current page's slug map up into SlugMapRoot's state after hydration.
 *   • useSlugMap() — read by LanguageSwitcher. Returns {} on non-slug routes.
 *
 * On non-slug routes (homepage, /live, /events) no SlugMapProvider is rendered,
 * so the cleanup function resets the map to {} and the switcher preserves the
 * current sub-path when switching locale.
 */

import { createContext, useContext, useState, useEffect } from 'react'
import type { SupportedLocale } from '@/lib/i18n/locales'

export type SlugMap = Partial<Record<SupportedLocale, string>>

interface SlugMapStore {
  slugMap: SlugMap
  /** Stable setter — identity guaranteed by useState. */
  setSlugMap: (map: SlugMap) => void
}

const SlugMapContext = createContext<SlugMapStore>({
  slugMap: {},
  setSlugMap: () => {},
})

// ─── SlugMapRoot ───────────────────────────────────────────────────────────────

/**
 * Place this in the tenant layout.tsx, wrapping all layout output (including
 * NavClient and {children}). It owns the slug map state so that both the nav
 * and the page are inside the same provider.
 */
export function SlugMapRoot({ children }: { children: React.ReactNode }) {
  const [slugMap, setSlugMap] = useState<SlugMap>({})
  return (
    <SlugMapContext.Provider value={{ slugMap, setSlugMap }}>
      {children}
    </SlugMapContext.Provider>
  )
}

// ─── SlugMapProvider ──────────────────────────────────────────────────────────

/**
 * Place this in [slug]/page.tsx wrapping the page sections.
 * After hydration it pushes the slug map into SlugMapRoot's state so the
 * LanguageSwitcher in the nav can read the correct locale-specific slugs.
 *
 * Cleanup resets the map to {} when the component unmounts (e.g. navigating
 * away from a slug page to the homepage).
 *
 * Safe without SlugMapRoot — degrades to a no-op (no-crash, no-context-update).
 */
export function SlugMapProvider({
  slugMap,
  children,
}: {
  slugMap: SlugMap
  children: React.ReactNode
}) {
  const { setSlugMap } = useContext(SlugMapContext)

  useEffect(() => {
    setSlugMap(slugMap)
    return () => setSlugMap({})
    // setSlugMap is stable (useState setter). slugMap changes only on navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slugMap])

  return <>{children}</>
}

// ─── useSlugMap ───────────────────────────────────────────────────────────────

/**
 * Read the current page's slug map.
 * Returns {} on non-slug routes (homepage, /live, /events, etc.)
 */
export function useSlugMap(): SlugMap {
  return useContext(SlugMapContext).slugMap
}
