'use client'

import { useLiveSupportCount } from '@/components/client/tickets/useLiveSupportCount'
import { useState } from 'react'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { ProjectSwitcher, type SwitcherProject } from './ProjectSwitcher'
import type { AccountMenuProps } from '@/components/app/shell/AccountMenu'
import { AppIcon, APP_ICONS } from '@/components/app/shell/AppIcon'
import { TabBarButton } from '@/components/app/ui/TabBarButton'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { LinkCard } from '@/components/app/ui/LinkCard'
import { CountBadge } from '@/components/app/ui/CountBadge'
import { AppSidebar, type AppNavEntry } from '@/components/app/shell/AppSidebar'
import type { ClientNavItem } from '@/lib/modules/client-navigation'
import { isNavItemActive, phoneNavLayout } from '@/lib/modules/client-nav-layout'
import { isModuleNavGroup, type NavGroup } from '@/lib/client/surfaces'
import type { ClientProductUpdate } from '@/lib/whats-new/model'
import { useWhatsNew } from './whats-new/WhatsNew'
import { ProfilePanel, type ProfileData } from './account/ProfilePanel'

/**
 * Client-dashboard navigation shell (ADR-017 Phase 2, restyled in S1 / ADR-025).
 * Since ADR-030 it is a composition of the shared `AppSidebar` frame (top bar,
 * drawer, sidebar, account menu); what stays here is what only the client
 * has — the project switcher, the module-driven nav and the phone tab bar.
 *
 * One component, two layouts, one set of destinations:
 *   • Phones: a slim top bar (title + the person's avatar; no menu button) and a
 *     bottom tab bar — Home · Content · Requests · Media · More (`phoneNavLayout`).
 *     Content opens a bottom sheet of the Publish + Show modules (one → links
 *     straight to it), Requests carries the unanswered-requests badge, More
 *     opens the drawer from the RIGHT and turns into an X (same button closes it).
 *     The drawer is the sidebar with EVERY destination plus the project switcher;
 *     the person's own menu is the avatar button (a bottom sheet). The drawer
 *     closes on navigation, a tap on the backdrop or any item, and Escape.
 *   • From md up: the fixed sidebar — Home first, then the module-driven items,
 *     and the same account menu (a popover) from the avatar at its bottom.
 * Content and Leads exist only when the project has the module (navItems come
 * from the tenant surface registry, `buildClientNavItems`). Client copy from
 * `clientDashboard.*`; the frame's own (menu buttons) from `app.shell`.
 *
 * The "+ Add content" panel and the floating "+" live OUTSIDE the sidebar, in
 * `create/AddContentRoot` (rendered by `[tenant]/layout.tsx`).
 */

export type ClientSidebarProps = {
  navItems: ClientNavItem[]
  /** Projects the user may switch between (slug, name, domain). */
  projects: SwitcherProject[]
  /** Active project slug (URL first segment). */
  activeSlug: string
  /** The signed-in person and their app preferences, for the account menu. */
  account: Omit<AccountMenuProps, 'variant'>
  /** Profile panel content (opened from the account menu); null → Profile links to the page. */
  profile?: ProfileData | null
  /** Locale-agnostic href of the project's dashboard home. */
  homeHref: string
  /** "What's new" for this project, in the reader's language; null/empty = no entry (ADR-030). */
  whatsNew?: ClientProductUpdate[] | null
  /** Open the newest flagged unread update in a dialog once (off in a support visit). Default on. */
  whatsNewPopup?: boolean
  /** Support requests with news for this person (Support Tickets, ADR-039); 0 = no badge. */
  supportUnread?: number
  /** Show "Report a Problem" in the account menu (the person may send support requests). */
  reportProblem?: boolean
  /** Contact requests nobody has answered yet (status `new`): badge on the Requests tab and the sidebar entry; 0 = none. */
  newRequestsCount?: number
}

const ICONS = {
  home: APP_ICONS.home,
  blog: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  forms: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  gallery: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  events: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  media: APP_ICONS.media,
  analytics: 'M3 3v18h18M7 16v-4M12 16V8M17 16v-7',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  connections: 'M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6',
  catalogue: 'M4 6h16M4 12h16M4 18h10M18 16v4M16 18h4',
  faq: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM9.6 9.5a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2.2-2.5 2.2M12 15.5h.01',
  taxonomy: 'M3 10V4h6l11 11-6 6zM7.5 7.5h.01',
  members: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2',
  documents: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M12 11v6M9 14l3 3 3-3',
  support: APP_ICONS.support,
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
  content: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  discover: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM17.5 14v7M14 17.5h7',
  generic: APP_ICONS.generic,
} as const

const REPORT_ICON = 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'

const iconFor = (moduleId: string) => (ICONS as Record<string, string>)[moduleId] ?? ICONS.generic

export function ClientSidebar({
  navItems,
  projects,
  activeSlug,
  account,
  homeHref,
  whatsNew = null,
  whatsNewPopup = true,
  profile = null,
  supportUnread = 0,
  reportProblem = false,
  newRequestsCount = 0,
}: ClientSidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [profileOpen, setProfileOpen] = useState(false)
  const t = useTranslations('clientDashboard')
  // The Content sheet is open on the page it was opened on (navigating closes it), like the drawer.
  const [contentOpenOn, setContentOpenOn] = useState<string | null>(null)
  if (contentOpenOn !== null && contentOpenOn !== pathname) setContentOpenOn(null)
  const contentOpen = contentOpenOn === pathname
  const activeProjectName = projects.find((p) => p.projectSlug === activeSlug)?.name?.trim() || activeSlug
  const { content, requests, media, overflow } = phoneNavLayout(navItems)
  const labelOf = (i: ClientNavItem) => i.label ?? t(`nav.${i.moduleId}`)
  const requestsBadge = newRequestsCount > 0 ? { count: newRequestsCount, label: t('shell.requestsUnanswered', { count: newRequestsCount }) } : undefined
  const news = useWhatsNew(whatsNew, { popup: whatsNewPopup })
  const liveSupportUnread = useLiveSupportCount(activeSlug, supportUnread, pathname, navItems.some((i) => i.moduleId === 'support'))

  // Home stands alone at the top. The modules' screens follow in their groups
  // (PLAT-3: Publish · Show · Visitors · Tools), each with a small heading; the
  // other groups (content work, activity, support & configuration) get extra
  // space above them, no heading. "What's new" (a panel, not a page) opens the
  // support & configuration group (Tom, 2026-10-22).
  const links: (AppNavEntry & { group: string })[] = [
    { key: 'home', href: homeHref, label: t('nav.home'), icon: ICONS.home, group: 'home' },
    ...navItems.map((i) => ({
      key: i.moduleId,
      href: i.href,
      label: i.label ?? t(`nav.${i.moduleId}`),
      icon: iconFor(i.moduleId),
      group: i.group as string,
      badge:
        i.moduleId === 'support' && liveSupportUnread > 0
          ? { count: liveSupportUnread, label: t('supportTickets.list.unreadCount', { count: liveSupportUnread }) }
          : i.moduleId === 'forms'
            ? requestsBadge
            : undefined,
    })),
  ]
  // The bottom group (Tom, 2026-10-29): Connected Apps, Settings, Support, What's New, More You Can Add.
  const SUPPORT_ORDER = ['connections', 'settings', 'support']
  const supportRank = (key: string) => SUPPORT_ORDER.indexOf(key)
  const supportRows = links.filter((i) => i.group === 'support').sort((x, y) => supportRank(x.key) - supportRank(y.key))
  const discover: AppNavEntry & { group: string } = { key: 'discover', href: `/${activeSlug}/discover`, label: t('nav.discover'), icon: ICONS.discover, group: 'support' }
  const bottomGroup: (AppNavEntry & { group: string })[] = [
    ...supportRows,
    ...(news.sidebarRow ? [{ key: 'whatsNew', node: news.sidebarRow, group: 'support' }] : []),
    discover,
  ]
  const rest = links.filter((i) => i.group !== 'support')
  const grouped: (AppNavEntry & { group: string })[] = [...rest, ...bottomGroup]
  const items: AppNavEntry[] = grouped.map(({ group, ...item }, n) => {
    const starts = n > 0 && group !== grouped[n - 1].group
    return starts && isModuleNavGroup(group as NavGroup)
      ? { ...item, groupStart: true, groupHeading: t(`navGroups.${group}` as 'navGroups.publish') }
      : { ...item, groupStart: starts }
  })

  return (
    <>
    <AppSidebar
      id="client-sidebar"
      tagline={t('shell.brandTagline')}
      title={activeProjectName}
      items={items}
      top={<ProjectSwitcher projects={projects} activeSlug={activeSlug} />}
      navFooter={
        navItems.length === 0 ? (
          <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">{t('shell.noModules')}</p>
        ) : null
      }
      account={{
        ...account,
        extraRows: [
          ...(news.menuRow ? [news.menuRow] : []),
          ...(reportProblem
            ? [
                {
                  key: 'reportProblem',
                  label: t('supportTickets.reportProblem'),
                  icon: REPORT_ICON,
                  onSelect: () => router.push(`/${activeSlug}/support/new?from=${encodeURIComponent(pathname)}`),
                },
              ]
            : []),
        ],
        ...(profile ? { onProfile: () => setProfileOpen(true) } : {}),
      }}
      isActive={isNavItemActive}
      drawerSide="right"
      showMenuButton={false}
      bottomBar={({ drawerOpen, setDrawerOpen, isActive }) => {
        // Slots (phoneNavLayout): Home · Content · Requests · Media · More. A slot the project does not have is left out.
        const contentActive = content.some((i) => isActive(i.href))
        const moreActive = drawerOpen || overflow.some((i) => isActive(i.href))
        const linkTabs: { key: string; href: string; label: string; d: string; badge?: { count: number; label: string } }[] = [
          { key: 'home', href: homeHref, label: t('nav.home'), d: ICONS.home },
          ...(content.length === 1 ? [{ key: 'content', href: content[0].href, label: t('nav.content'), d: ICONS.content }] : []),
        ]
        const afterContent: typeof linkTabs = [
          ...(requests ? [{ key: 'requests', href: requests.href, label: t('nav.requests'), d: iconFor('forms'), badge: requestsBadge }] : []),
          ...(media ? [{ key: 'media', href: media.href, label: labelOf(media), d: iconFor('media') }] : []),
        ]
        const tabLink = (tab: (typeof linkTabs)[number]) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive(tab.href) ? 'page' : undefined}
            className={`flex min-h-11 flex-col items-center justify-center gap-0.5 text-xs font-medium ${isActive(tab.href) ? 'text-foreground' : 'text-muted-foreground'}`}
          >
            <span className="relative inline-flex">
              <AppIcon d={tab.d} />
              {tab.badge ? <CountBadge overlap tone="attention" count={tab.badge.count} srLabel={tab.badge.label} /> : null}
            </span>
            {tab.label}
          </Link>
        )
        const slots = 2 + (content.length > 0 ? 1 : 0) + afterContent.length
        return (
          /* ── Bottom tab bar (phones) ──────────────────────────────────── */
          /* Above the drawer while it is open, so the More tab (an X then) stays tappable. */
          <nav
            aria-label={t('shell.brandTagline')}
            style={{ gridTemplateColumns: `repeat(${slots}, minmax(0, 1fr))` }}
            className={`fixed inset-x-0 bottom-0 grid items-end border-t border-border bg-background pb-[max(8px,env(safe-area-inset-bottom))] pt-2 md:hidden ${drawerOpen ? 'z-[60]' : 'z-30'}`}
          >
            {tabLink(linkTabs[0])}
            {content.length === 1 ? tabLink(linkTabs[1]) : null}
            {content.length > 1 ? (
              <TabBarButton icon={ICONS.content} active={contentActive || contentOpen} onClick={() => setContentOpenOn(pathname)} aria-haspopup="dialog">
                {t('nav.content')}
              </TabBarButton>
            ) : null}
            {afterContent.map(tabLink)}
            <TabBarButton
              icon={drawerOpen ? ICONS.close : ICONS.more}
              iconWidth={2.4}
              active={moreActive}
              onClick={() => setDrawerOpen(!drawerOpen)}
              aria-label={drawerOpen ? t('shell.closeMenu') : t('nav.more')}
              aria-expanded={drawerOpen}
              aria-controls="client-sidebar"
            >
              {drawerOpen ? t('shell.closeMenu') : t('nav.more')}
            </TabBarButton>
          </nav>
        )
      }}
    />
    {content.length > 1 ? (
      <BottomSheet open={contentOpen} title={t('nav.content')} onClose={() => setContentOpenOn(null)}>
        <div className="flex flex-col gap-2">
          {content.map((i) => (
            <LinkCard key={i.moduleId} href={i.href} icon={<AppIcon d={iconFor(i.moduleId)} size={20} />} title={labelOf(i)} />
          ))}
        </div>
      </BottomSheet>
    ) : null}
    {news.panel}
    {profile ? <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} profile={profile} /> : null}
    </>
  )
}
