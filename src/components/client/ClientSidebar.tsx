'use client'

import { useLiveSupportCount } from '@/components/client/tickets/useLiveSupportCount'
import { useLiveMessagesCount } from '@/components/client/messages/useLiveMessagesCount'
import { useNotificationCenter, type NotificationActions } from '@/components/app/notifications/NotificationCenter'
import { clientNotificationCountAction, clientNotificationListAction, clientNotificationMarkReadAction } from '@/app/[locale]/(client)/[tenant]/notification-actions'
import { useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from '@/i18n/navigation'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { ProjectSwitcher, type SwitcherProject } from './ProjectSwitcher'
import { billingNavBadge, type BillingAttention } from '@/lib/billing/client-access'
import type { AccountMenuProps } from '@/components/app/shell/AccountMenu'
import { AppIcon, APP_ICONS } from '@/components/app/shell/AppIcon'
import { TabBarButton } from '@/components/app/ui/TabBarButton'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { LinkCard } from '@/components/app/ui/LinkCard'
import { CountBadge } from '@/components/app/ui/CountBadge'
import { AppSidebar, type AppNavEntry, type AppNavItem } from '@/components/app/shell/AppSidebar'
import { useSidebarState } from '@/components/app/shell/SidebarState'
import type { ClientNavItem } from '@/lib/modules/client-navigation'
import { contentSheetSections, groupOfNavId, isNavItemActive, phoneNavLayout, resolveActiveNavId, sidebarGroups } from '@/lib/modules/client-nav-layout'
import { effectiveGroupOpen } from '@/lib/app-nav-preferences'
import type { ClientProductUpdate } from '@/lib/whats-new/model'
import { useWhatsNew } from './whats-new/WhatsNew'
import { useClientSearch } from './search/ClientSearch'
import type { CreateMenu } from '@/lib/modules/add-content-sheet'
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
  /** Messages (ADR-050 D12): null = no conversation here (no entry); otherwise conversations with an unread message from Abluo. */
  messages?: { unread: number } | null
  /** Notification Center (ADR-050 D10): the bell's first number. */
  notificationsUnread?: number
  /** Show the bell (off in an Abluo support visit). */
  bell?: boolean
  /** Show "Report a Problem" in the account menu (the person may send support requests). */
  reportProblem?: boolean
  /** Contact requests nobody has answered yet (status `new`): badge on the Requests tab and the sidebar entry; 0 = none. */
  newRequestsCount?: number
  /** Payment nudge for the person who pays (billingAttention): badge on Billing and on the phone's More tab; null = none. */
  billingAttention?: BillingAttention | null
  /** What this person can create here (`buildCreateMenu`): feeds the search's Create group. */
  createMenu?: CreateMenu | null
  /** The person's permissions on the active project: some search sub-destinations need one. */
  permissions?: readonly string[]
}

const ICONS = {
  home: APP_ICONS.home,
  blog: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  forms: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  gallery: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  events: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  media: APP_ICONS.media,
  analytics: 'M3 3v18h18M7 16v-4M12 16V8M17 16v-7',
  people: 'M3 5h18v14H3zM8.5 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.5 16.5a3 3 0 0 1 6 0M14 9h4M14 13h4',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  connections: 'M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8',
  billing: 'M2 6h20v12H2zM2 10h20M6 15h4',
  settings: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6',
  socialProfiles: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  catalogue: 'M4 6h16M4 12h16M4 18h10M18 16v4M16 18h4',
  catalogueItems: 'M4 6h16M4 12h16M4 18h10M18 16v4M16 18h4',
  catalogueCollections: 'M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z',
  catalogueOptions: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  catalogueSetup: 'M4 7h10M18 7h2M4 17h2M10 17h10M16 4v6M8 14v6',
  faq: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM9.6 9.5a2.5 2.5 0 0 1 4.9.8c0 1.7-2.5 2.2-2.5 2.2M12 15.5h.01',
  taxonomy: 'M3 10V4h6l11 11-6 6zM7.5 7.5h.01',
  testimonials: 'M21 12a8 8 0 0 1-8 8H4l1.5-3.5A8 8 0 1 1 21 12zM9 10h6M9 14h4',
  'digital-cards': 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM10 7h4M10 11h4M11 18h2',
  members: 'M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5zM12 15v2',
  reservations: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4zM14 7v10',
  documents: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M12 11v6M9 14l3 3 3-3',
  support: APP_ICONS.support,
  messages: APP_ICONS.messages,
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
  content: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  discover: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM17.5 14v7M14 17.5h7',
  generic: APP_ICONS.generic,
} as const

/** One icon per headed group, drawn on its rail button. */
const GROUP_ICONS = {
  content: ICONS.content,
  catalogue: ICONS.catalogue,
  visitors: ICONS.forms,
  library: ICONS.media,
  insights: ICONS.analytics,
  project: ICONS.settings,
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
  messages = null,
  notificationsUnread = 0,
  bell: showBell = true,
  reportProblem = false,
  newRequestsCount = 0,
  billingAttention = null,
  createMenu = null,
  permissions = [],
}: ClientSidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [profileOpen, setProfileOpen] = useState(false)
  const t = useTranslations('clientDashboard')
  const tShell = useTranslations('app.shell')
  // The Content sheet is open on the page it was opened on (navigating closes it), like the drawer.
  const [contentOpenOn, setContentOpenOn] = useState<string | null>(null)
  if (contentOpenOn !== null && contentOpenOn !== pathname) setContentOpenOn(null)
  const contentOpen = contentOpenOn === pathname
  const activeProjectName = projects.find((p) => p.projectSlug === activeSlug)?.name?.trim() || activeSlug
  const { content, requests, media, overflow } = phoneNavLayout(navItems)
  const labelOf = (i: ClientNavItem) => t(`nav.${i.moduleId}`)
  const requestsBadge = newRequestsCount > 0 ? { count: newRequestsCount, label: t('shell.requestsUnanswered', { count: newRequestsCount }) } : undefined
  const news = useWhatsNew(whatsNew, { popup: whatsNewPopup })
  const billingNav = billingNavBadge(billingAttention)
  const billingBadge = billingNav ? { count: billingNav.count, label: t(`billing.attention.badge.${billingNav.labelKey}`) } : undefined
  // Billing lives in the phone's More drawer: the More tab carries its badge too.
  const moreBadge = billingBadge && overflow.some((i) => i.moduleId === 'billing') ? billingBadge : undefined
  const liveSupportUnread = useLiveSupportCount(activeSlug, supportUnread, pathname, navItems.some((i) => i.moduleId === 'support'))
  const liveMessagesUnread = useLiveMessagesCount(activeSlug, messages?.unread ?? 0, pathname, messages !== null)
  const notificationActions = useMemo<NotificationActions>(
    () => ({
      count: () => clientNotificationCountAction(activeSlug),
      list: () => clientNotificationListAction(activeSlug),
      markRead: (id) => clientNotificationMarkReadAction(activeSlug, id),
    }),
    [activeSlug],
  )
  const notifications = useNotificationCenter({ actions: notificationActions, initialCount: notificationsUnread, pathname, enabled: showBell, showProject: projects.length > 1 })

  // ADR-042: Home stands alone at the top; then the headed groups (Content, Catalogue, Visitors, Library,
  // Insights, Project), each a collapsible disclosure (a flyout in the rail); then the unheaded bottom block
  // (Support, What's New, More You Can Add). One definition: `surfaces.ts` -> `sidebarGroups`.
  const messagesHref = `/${activeSlug}/messages`
  const activeId = isNavItemActive(pathname, homeHref) ? 'home' : messages && isNavItemActive(pathname, messagesHref) ? 'messages' : resolveActiveNavId(pathname, navItems)
  const activeGroup = groupOfNavId(navItems, activeId)
  const sidebarState = useSidebarState()
  const setGroupOpen = sidebarState?.setGroupOpen
  // The person closed the group of the current destination: it stays closed until they go somewhere else (N3).
  const [closedAt, setClosedAt] = useState<string | null>(null)
  const suppressAutoOpen = closedAt === activeId
  useEffect(() => {
    if (activeGroup && !suppressAutoOpen) setGroupOpen?.(activeGroup, true)
  }, [activeGroup, suppressAutoOpen, setGroupOpen])
  const toEntry = (i: ClientNavItem): AppNavItem => ({
    key: i.moduleId,
    href: i.href,
    label: labelOf(i),
    icon: iconFor(i.moduleId),
    badge:
      i.moduleId === 'support' && liveSupportUnread > 0
        ? { count: liveSupportUnread, label: t('supportTickets.list.unreadCount', { count: liveSupportUnread }) }
        : i.moduleId === 'forms'
          ? requestsBadge
          : i.moduleId === 'billing'
            ? billingBadge
            : undefined,
  })
  const { groups, bottom } = sidebarGroups(navItems)
  const items: AppNavEntry[] = [
    { key: 'home', href: homeHref, label: t('nav.home'), icon: ICONS.home },
    ...groups.map((g) => ({
      key: g.group,
      label: t(`navGroups.${g.group}`),
      icon: GROUP_ICONS[g.group],
      items: g.items.map(toEntry),
      open: sidebarState ? effectiveGroupOpen(sidebarState.prefs, g.group, activeGroup, suppressAutoOpen) : true,
      onOpenChange: (open: boolean) => {
        setGroupOpen?.(g.group, open)
        if (!open && g.group === activeGroup) setClosedAt(activeId)
      },
    })),
    // Messages (ADR-050): only when Abluo has written to this person here; first in the bottom block, above Support.
    ...(messages
      ? [
          {
            key: 'messages',
            href: messagesHref,
            label: t('nav.messages'),
            icon: ICONS.messages,
            groupStart: true,
            badge: liveMessagesUnread > 0 ? { count: liveMessagesUnread, label: t('messages.unreadCount', { count: liveMessagesUnread }) } : undefined,
          },
        ]
      : []),
    ...bottom.map((i, n) => ({ ...toEntry(i), groupStart: n === 0 && !messages })),
    ...(news.sidebarRow ? [{ key: 'whatsNew', node: news.sidebarRow, railNode: news.railRow }] : []),
    { key: 'discover', href: `/${activeSlug}/discover`, label: t('nav.discover'), icon: ICONS.discover, groupStart: bottom.length === 0 },
  ]

  // Search (ADR-047): every destination the sidebar offers, in sidebar order, plus the phone-only ones are the same list.
  const destinations = items.flatMap((e): { key: string; label: string; href: string; icon: string }[] =>
    'node' in e ? [] : 'items' in e ? e.items.map(({ key, label, href, icon }) => ({ key, label, href, icon })) : [{ key: e.key, label: e.label, href: e.href, icon: e.icon }],
  )
  const search = useClientSearch({
    projectSlug: activeSlug,
    destinations,
    createMenu,
    iconFor,
    moduleLabel: (id) => t(`nav.${id}`),
    permissions,
    newRequestsCount,
  })

  return (
    <>
    <AppSidebar
      search={search.triggers}
      bell={notifications.bell}
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
      activeKey={activeId}
      collapsible={{ collapseLabel: tShell('collapseSidebar'), expandLabel: tShell('expandSidebar') }}
      drawerSide="right"
      showMenuButton={false}
      bottomBar={({ drawerOpen, setDrawerOpen }) => {
        const isActive = (href: string) => (href === homeHref ? activeId === 'home' : [...content, requests, media].some((i) => i?.href === href && i.moduleId === activeId))
        // Slots (phoneNavLayout): Home · Content · Requests · Media · More. A slot the project does not have is left out.
        const contentActive = content.some((i) => i.moduleId === activeId)
        const moreActive = drawerOpen || overflow.some((i) => i.moduleId === activeId)
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
              badge={drawerOpen ? undefined : moreBadge}
              onClick={() => setDrawerOpen(!drawerOpen)}
              aria-label={drawerOpen ? t('shell.closeMenu') : moreBadge ? `${t('nav.more')} (${moreBadge.label})` : t('nav.more')}
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
          {contentSheetSections(content).map(({ group, headingId, rows }) => (
            // aria-labelledby only when the heading it names is rendered (2+ groups).
            <section key={group} aria-labelledby={headingId ?? undefined} className="flex flex-col gap-2">
              {headingId ? (
                <h3 id={headingId} className="px-1 pt-2 text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">
                  {t(`navGroups.${group}`)}
                </h3>
              ) : null}
              {rows.map((i) => (
                <LinkCard key={i.moduleId} href={i.href} icon={<AppIcon d={iconFor(i.moduleId)} size={20} />} title={labelOf(i)} />
              ))}
            </section>
          ))}
        </div>
      </BottomSheet>
    ) : null}
    {search.dialog}
    {notifications.panel}
    {news.panel}
    {profile ? <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} profile={profile} /> : null}
    </>
  )
}
