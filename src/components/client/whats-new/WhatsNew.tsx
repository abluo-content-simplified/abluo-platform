'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/app/shell/AppIcon'
import type { AccountMenuRow } from '@/components/app/shell/AccountMenu'
import { Button } from '@/components/app/ui/Button'
import { CountBadge } from '@/components/app/ui/CountBadge'
import { DialogFrame } from '@/components/app/ui/DialogFrame'
import { SidebarRowButton } from '@/components/app/ui/SidebarRowButton'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { UpdateCard } from '@/components/app/ui/UpdateCard'
import { markUpdatesReadAction } from '@/app/[locale]/(client)/[tenant]/whats-new-actions'
import { countUnread, selectPopupUpdate, type ClientProductUpdate } from '@/lib/whats-new/model'

/**
 * "What's new" in the client dashboard (ADR-030): product updates Abluo
 * publishes, for the current project's audience, already in the reader's
 * language (read server-side in `[tenant]/layout.tsx`).
 *
 * One state, two entry points, designed per device:
 *   • sidebar: a row in the nav, opening the support & configuration group (`sidebarRow`, ClientSidebar places it);
 *   • phone: a row in the account menu sheet (`menuRow`, bar variant only),
 *     with a dot on the avatar.
 * Opening the panel marks the shown updates read (own session, RLS); the "New"
 * marks stay visible while the panel is open and are gone the next time.
 *
 * Pop-up: the newest unread update the admin flagged "Show as pop-up" opens
 * once in a dialog when the dashboard loads. It is marked read the moment it is
 * shown, so it can never come back — "Got it" just closes it, "See all updates"
 * closes it and opens the panel. Off in an admin's support visit (`popup: false`).
 *
 * `updates` null = the feature is not available (tables missing, read failed)
 * or there is nothing for this project: no entry at all.
 */
export const WHATS_NEW_ICON =
  'M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'

export function useWhatsNew(
  updates: ClientProductUpdate[] | null,
  options: { popup?: boolean } = {},
): {
  sidebarRow: ReactNode
  menuRow: AccountMenuRow | null
  panel: ReactNode
} {
  const t = useTranslations('clientDashboard.whatsNew')
  const [open, setOpen] = useState(false)
  // The pop-up is chosen once, when the dashboard first renders.
  const [popup] = useState<ClientProductUpdate | null>(() => (options.popup === false ? null : selectPopupUpdate(updates ?? [])))
  const [popupOpen, setPopupOpen] = useState(popup !== null)
  // Marked read in this session (the server copy catches up on the next request).
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set(popup ? [popup.id] : []))
  // What was unread when the panel opened — those keep their "New" mark while it is open.
  const [newAtOpen, setNewAtOpen] = useState<ReadonlySet<string>>(() => new Set())

  useEffect(() => {
    if (popup) void markUpdatesReadAction([popup.id])
  }, [popup])

  if (!updates || updates.length === 0) return { sidebarRow: null, menuRow: null, panel: null }

  const unread = countUnread(updates, seen)
  const unreadLabel = unread ? t('unreadCount', { count: unread }) : undefined

  const openPanel = () => {
    const ids = updates.filter((u) => u.unread && !seen.has(u.id)).map((u) => u.id)
    setNewAtOpen(new Set(ids))
    setOpen(true)
    if (ids.length) {
      setSeen((prev) => new Set([...prev, ...ids]))
      void markUpdatesReadAction(ids)
    }
  }

  const sidebarRow = (
    <SidebarRowButton
      icon={<AppIcon d={WHATS_NEW_ICON} size={18} />}
      badge={unread ? <CountBadge count={unread} srLabel={unreadLabel ?? ''} /> : null}
      onClick={openPanel}
      aria-haspopup="dialog"
    >
      {t('title')}
    </SidebarRowButton>
  )

  const menuRow: AccountMenuRow = {
    key: 'whatsNew',
    label: t('title'),
    icon: WHATS_NEW_ICON,
    badge: unread,
    badgeLabel: unreadLabel,
    onSelect: openPanel,
    variants: ['bar'],
  }

  const popupDialog = popup ? (
    <DialogFrame
      open={popupOpen}
      onClose={() => setPopupOpen(false)}
      labelledBy="whats-new-popup-title"
      className="m-auto w-full max-w-md rounded-2xl bg-popover p-6 text-popover-foreground backdrop:bg-overlay"
    >
      <h2 id="whats-new-popup-title" className="sr-only">
        {t('popupLabel')}
      </h2>
      <div className="max-h-[65dvh] overflow-y-auto">
        <UpdateCard
          title={popup.title}
          body={popup.body}
          imageUrl={popup.imageUrl}
          cta={popup.cta}
          publishedAt={popup.publishedAt}
          lang={popup.lang}
          newLabel={t('new')}
          opensInNewTabLabel={t('opensInNewTab')}
        />
      </div>
      <div className="mt-5 flex flex-col gap-2">
        <Button variant="primary" size="lg" fullWidth onClick={() => setPopupOpen(false)}>
          {t('gotIt')}
        </Button>
        <Button size="lg" fullWidth onClick={() => { setPopupOpen(false); openPanel() }}>
          {t('seeAll')}
        </Button>
      </div>
    </DialogFrame>
  ) : null

  const panel = (
    <>
    {popupDialog}
    <SidePanel open={open} title={t('title')} closeLabel={t('close')} onClose={() => setOpen(false)}>
      <ol className="divide-y divide-border-subtle">
        {updates.map((u) => (
          <li key={u.id} className="py-5 first:pt-1">
            <UpdateCard
              title={u.title}
              body={u.body}
              imageUrl={u.imageUrl}
              cta={u.cta}
              publishedAt={u.publishedAt}
              lang={u.lang}
              newLabel={newAtOpen.has(u.id) ? t('new') : null}
              opensInNewTabLabel={t('opensInNewTab')}
            />
          </li>
        ))}
      </ol>
    </SidePanel>
    </>
  )

  return { sidebarRow, menuRow, panel }
}
