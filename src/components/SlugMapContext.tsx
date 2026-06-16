'use client'

/**
 * SlugMapContext — shares the current page's per-locale slug map
 * from the server page component down to the client-side LanguageSwitcher.
 *
 * The server page (page.tsx) wraps its render in <SlugMapProvider slugMap={...}>.
 * The LanguageSwitcher reads useSlugMap() to know which slug to navigate to
 * when switching locale — e.g. /en/tenant/services → /it/tenant/servizi.
 *
 * If no slugMap is in context (e.g. on the homepage or a non-page route),
 * useSlugMap() returns {}, and the switcher falls back to the current pathname.
 */

import { createContext, useContext } from 'react'
import type { SupportedLocale } from '@/lib/i18n/locales'

export type SlugMap = Partial<Record<SupportedLocale, string>>

const SlugMapContext = createContext<SlugMap>({})

export function SlugMapProvider({
  slugMap,
  children,
}: {
  slugMap: SlugMap
  children: React.ReactNode
}) {
  return (
    <SlugMapContext.Provider value={slugMap}>
      {children}
    </SlugMapContext.Provider>
  )
}

export function useSlugMap(): SlugMap {
  return useContext(SlugMapContext)
}
