'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { usePathname } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { AddContentSheet } from './AddContentSheet'
import { QuickAddContext } from '@/components/app/shell/QuickAddContext'
import { Fab } from '@/components/app/ui/Fab'
import type { CreateMenu } from '@/lib/modules/add-content-sheet'

/**
 * "+ Add content" for the whole dashboard (rendered by `[tenant]/layout.tsx`,
 * outside the sidebar): owns the open state of the "What would you like to
 * create?" panel (`AddContentSheet`), renders the floating "+" and lets other
 * triggers open it via `useOpenAddContent()`.
 * The floating "+" (`ui/Fab`) is back (Tom, 2026-10-29): always on phones, on iPad/desktop
 * unless the person switched "Show quick add button" off; hidden on the wizard / create surfaces.
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
  quickAdd = true,
  children,
}: {
  projectSlug: string
  /** What this user can create in this project (server-computed, `buildCreateMenu`). */
  menu?: CreateMenu
  /** Abluo contact for "Ask us to add it" (optional). */
  contactEmail?: string | null
  /** Offer "Add to media library" (owner/editor). */
  mediaLibrary?: boolean
  /** The person's "Show quick add button" preference (iPad / computers; phones always show it). */
  quickAdd?: boolean
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

  // The preference: the server value is the truth; the switch flips it at once (the layout refreshes after).
  const t = useTranslations('clientDashboard')
  const [quick, setQuick] = useState({ from: quickAdd, value: quickAdd })
  if (quick.from !== quickAdd) setQuick({ from: quickAdd, value: quickAdd })
  const quickCtx = useMemo(() => ({ value: quick.value, set: (on: boolean) => setQuick((q) => ({ ...q, value: on })) }), [quick.value])

  // The wizard / create surfaces (post wizard, gallery editor, media wizard) get no floating "+".
  const onCreateSurface = /\/posts\/write(\/|$)|\/galleries\/(new|[^/]+\/edit)(\/|$)|\/media\/add(\/|$)/.test(pathname)

  return (
    <OpenAddContent.Provider value={openPanel}>
      <QuickAddContext.Provider value={quickCtx}>
      {children}
      {onCreateSurface ? null : <Fab label={t('nav.add')} closeLabel={t('create.type.close')} onPress={openPanel} desktop={quick.value} />}
      <AddContentSheet
        open={open}
        onClose={() => setOpenOn(null)}
        projectSlug={projectSlug}
        menu={menu}
        contactEmail={contactEmail}
        mediaLibrary={mediaLibrary}
      />
      </QuickAddContext.Provider>
    </OpenAddContent.Provider>
  )
}
