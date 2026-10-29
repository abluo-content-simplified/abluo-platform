'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { usePathname } from '@/i18n/navigation'
import { AddContentSheet } from './AddContentSheet'
import type { CreateMenu } from '@/lib/modules/add-content-sheet'

/**
 * "+ Add content" for the whole dashboard (rendered by `[tenant]/layout.tsx`,
 * outside the sidebar): owns the open state of the "What would you like to
 * create?" panel (`AddContentSheet`), and lets other triggers —
 * the phone tab bar's "+" in ClientSidebar — open it via `useOpenAddContent()`.
 * (No floating "+": phones use the tab bar's, iPad/desktop the page header's.)
 */

const OpenAddContent = createContext<() => void>(() => {})

/** Opens the Add content panel. */
export function useOpenAddContent() {
  return useContext(OpenAddContent)
}

export function AddContentRoot({
  projectSlug,
  menu = { available: [], more: [] },
  contactEmail = null,
  mediaLibrary = false,
  children,
}: {
  projectSlug: string
  /** What this user can create in this project (server-computed, `buildCreateMenu`). */
  menu?: CreateMenu
  /** Abluo contact for "Ask us to add it" (optional). */
  contactEmail?: string | null
  /** Offer "Add to media library" (owner/editor). */
  mediaLibrary?: boolean
  children: ReactNode
}) {
  const pathname = usePathname() // locale-stripped, e.g. "/livener/posts"
  // Open on the page it was opened on: navigating closes it. The page is then
  // forgotten (adjusting state during render, no effect), so coming BACK to it
  // never re-opens the panel by itself.
  const [openOn, setOpenOn] = useState<string | null>(null)
  if (openOn !== null && openOn !== pathname) setOpenOn(null)
  const open = openOn === pathname
  const openPanel = useCallback(() => setOpenOn(pathname), [pathname])

  return (
    <OpenAddContent.Provider value={openPanel}>
      {children}
      <AddContentSheet
        open={open}
        onClose={() => setOpenOn(null)}
        projectSlug={projectSlug}
        menu={menu}
        contactEmail={contactEmail}
        mediaLibrary={mediaLibrary}
      />
    </OpenAddContent.Provider>
  )
}
