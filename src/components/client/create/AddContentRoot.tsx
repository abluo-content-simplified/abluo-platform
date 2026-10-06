'use client'

import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from '@/i18n/navigation'
import { AddContentSheet } from './AddContentSheet'
import { Fab } from '@/components/client/ui/Fab'
import type { CreateMenu } from '@/lib/modules/create-menu'

/**
 * "+ Add content" for the whole dashboard (rendered by `[tenant]/layout.tsx`,
 * outside the sidebar): owns the open state of the "What would you like to
 * create?" panel (`AddContentSheet`), renders the floating "+" (`ui/Fab`,
 * every page except the wizard / create surfaces) and lets other triggers —
 * the phone tab bar's "+" in ClientSidebar — open it via `useOpenAddContent()`.
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
  const t = useTranslations('clientDashboard')
  const pathname = usePathname() // locale-stripped, e.g. "/livener/posts"
  // Open on the page it was opened on: navigating closes it (no effect needed).
  const [openOn, setOpenOn] = useState<string | null>(null)
  const open = openOn === pathname
  const openPanel = useCallback(() => setOpenOn(pathname), [pathname])

  // The wizard / create surfaces (post wizard, gallery editor, media wizard) get no floating "+".
  const onCreateSurface = /\/posts\/write(\/|$)|\/galleries\/[^/]+|\/media\/add(\/|$)/.test(pathname)
  const fab = onCreateSurface ? null : { label: t('nav.add'), closeLabel: t('create.type.close') }

  return (
    <OpenAddContent.Provider value={openPanel}>
      {children}
      {fab ? <Fab label={fab.label} closeLabel={fab.closeLabel} onPress={openPanel} /> : null}
      <AddContentSheet
        open={open}
        onClose={() => setOpenOn(null)}
        projectSlug={projectSlug}
        menu={menu}
        contactEmail={contactEmail}
        mediaLibrary={mediaLibrary}
        fab={fab}
      />
    </OpenAddContent.Provider>
  )
}
