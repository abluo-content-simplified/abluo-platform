'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { AppIcon } from '@/components/app/shell/AppIcon'
import type { AccountMenuRow } from '@/components/app/shell/AccountMenu'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { UpdateCard } from '@/components/app/ui/UpdateCard'
import { markUpdatesReadAction } from '@/app/[locale]/(client)/[tenant]/whats-new-actions'
import { countUnread, type ClientProductUpdate } from '@/lib/whats-new/model'

/**
 * "What's new" in the client dashboard (ADR-030): product updates Abluo
 * publishes, for the current project's audience, already in the reader's
 * language (read server-side in `[tenant]/layout.tsx`).
 *
 * One state, two entry points, designed per device:
 *   • desktop: a row in the sidebar footer, above the account (`sidebarRow`);
 *   • phone: a row in the account menu sheet (`menuRow`, bar variant only),
 *     with a dot on the avatar.
 * Opening the panel marks the shown updates read (own session, RLS); the "New"
 * marks stay visible while the panel is open and are gone the next time.
 *
 * `updates` null = the feature is not available (tables missing, read failed)
 * or there is nothing for this project: no entry at all.
 */
export const WHATS_NEW_ICON =
  'M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z'

export function useWhatsNew(updates: ClientProductUpdate[] | null): {
  sidebarRow: ReactNode
  menuRow: AccountMenuRow | null
  panel: ReactNode
} {
  const t = useTranslations('clientDashboard.whatsNew')
  const [open, setOpen] = useState(false)
  // Marked read in this session (the server copy catches up on the next request).
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set())
  // What was unread when the panel opened — those keep their "New" mark while it is open.
  const [newAtOpen, setNewAtOpen] = useState<ReadonlySet<string>>(() => new Set())

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
    <button
      type="button"
      onClick={openPanel}
      aria-haspopup="dialog"
      className="flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <AppIcon d={WHATS_NEW_ICON} size={18} />
      <span className="flex-1 text-left">{t('title')}</span>
      {unread ? (
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-action px-1.5 text-xs font-semibold text-action-foreground">
          <span aria-hidden="true">{unread}</span>
          <span className="sr-only">{unreadLabel}</span>
        </span>
      ) : null}
    </button>
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

  const panel = (
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
  )

  return { sidebarRow, menuRow, panel }
}
