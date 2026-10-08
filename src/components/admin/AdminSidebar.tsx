'use client'

import { useTranslations } from 'next-intl'
import type { AccountMenuProps } from '@/components/app/shell/AccountMenu'
import { APP_ICONS } from '@/components/app/shell/AppIcon'
import { AppSidebar } from '@/components/app/shell/AppSidebar'

/**
 * Abluo admin navigation (admin.abluo.app, ADR-030). A composition of the
 * shared `AppSidebar` — the same light/dark frame, drawer and account menu as
 * the client dashboard — replacing the old dark zinc sidebar. No phone tab bar:
 * on phones the menu button opens the drawer.
 *
 * The destinations are the `(admin)` route folders; each one is also listed in
 * `ADMIN_SURFACE_SEGMENTS` (src/lib/proxy/admin-surface.ts), which is what
 * gates it (abluo_admin + two-factor). Copy from `admin.*`.
 */

const NAV = [
  { key: 'home', href: '/dashboard', icon: APP_ICONS.home },
  { key: 'projects', href: '/projects', icon: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' },
  { key: 'analytics', href: '/analytics', icon: 'M3 3v18h18M7 16v-4M12 16V8M17 16v-7' },
  { key: 'media', href: '/media', icon: APP_ICONS.media },
  { key: 'backlog', href: '/backlog', icon: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01' },
  { key: 'whatsNew', href: '/whats-new', icon: 'M12 3l1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z' },
] as const

export function AdminSidebar({ account }: { account: Omit<AccountMenuProps, 'variant'> }) {
  const t = useTranslations('admin')
  return (
    <AppSidebar
      id="admin-sidebar"
      tagline={t('shell.tagline')}
      navLabel={t('shell.navLabel')}
      items={NAV.map((item) => ({ key: item.key, href: item.href, label: t(`nav.${item.key}`), icon: item.icon }))}
      account={account}
    />
  )
}
