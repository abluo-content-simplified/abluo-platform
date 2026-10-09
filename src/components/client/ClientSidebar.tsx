'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { ProjectSwitcher, type SwitcherProject } from './ProjectSwitcher'
import type { AccountMenuProps } from '@/components/app/shell/AccountMenu'
import { AppIcon, APP_ICONS } from '@/components/app/shell/AppIcon'
import { AppSidebar } from '@/components/app/shell/AppSidebar'
import { useOpenAddContent } from './create/AddContentRoot'
import type { ClientNavItem } from '@/lib/modules/client-navigation'
import { isNavItemActive, phoneNavLayout } from '@/lib/modules/client-nav-layout'
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
 *   • Phones: a slim top bar (menu button + project name) and a bottom tab bar —
 *     Home · Content · [+ Add content] · Forms · More. Both the menu button and
 *     "More" open the drawer: the same sidebar, with EVERY destination
 *     (Galleries, Media, People… have no tab of their own, `phoneNavLayout`)
 *     plus the project switcher — navigation only, no personal settings. The
 *     person's own menu (account, appearance, text size, help, sign out) is the
 *     avatar button at the right of the top bar (a bottom sheet). "More" is shown
 *     active while you are on one of those pages. The drawer closes on
 *     navigation, a tap on the backdrop or any item, and Escape.
 *   • From md up: the fixed sidebar — Home first, then the module-driven items,
 *     and the same account menu (a popover) from the avatar at its bottom.
 * Content and Leads exist only when the project has the module (navItems come
 * from the tenant surface registry, `buildClientNavItems`). Client copy from
 * `clientDashboard.*`; the frame's own (menu buttons) from `app.shell`.
 *
 * The phone tab bar's "+" opens the "What would you like to create?" panel
 * (ADR-025 D8). That panel and the floating "+" live OUTSIDE the sidebar, in
 * `create/AddContentRoot` (rendered by `[tenant]/layout.tsx`), so the FAB is
 * truly fixed to the viewport.
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
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  generic: APP_ICONS.generic,
} as const

const iconFor = (moduleId: string) => (ICONS as Record<string, string>)[moduleId] ?? ICONS.generic

export function ClientSidebar({
  navItems,
  projects,
  activeSlug,
  account,
  homeHref,
  whatsNew = null,
  profile = null,
}: ClientSidebarProps) {
  const [profileOpen, setProfileOpen] = useState(false)
  const t = useTranslations('clientDashboard')
  const openAddContent = useOpenAddContent()
  const activeProjectName = projects.find((p) => p.projectSlug === activeSlug)?.name?.trim() || activeSlug
  const { content: contentItem, forms: leadsItem, overflow } = phoneNavLayout(navItems)
  const news = useWhatsNew(whatsNew)

  const items = [
    { key: 'home', href: homeHref, label: t('nav.home'), icon: ICONS.home },
    ...navItems.map((i) => ({ key: i.moduleId, href: i.href, label: t(`nav.${i.moduleId}`), icon: iconFor(i.moduleId) })),
  ]

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
        ...(news.menuRow ? { extraRows: [news.menuRow] } : {}),
        ...(profile ? { onProfile: () => setProfileOpen(true) } : {}),
      }}
      footer={news.sidebarRow}
      isActive={isNavItemActive}
      bottomBar={({ drawerOpen, setDrawerOpen, isActive }) => {
        // "More" carries the active state for pages without a tab of their own.
        const moreActive = drawerOpen || overflow.some((i) => isActive(i.href))
        return (
          /* ── Bottom tab bar (phones) ──────────────────────────────────── */
          <nav
            aria-label={t('shell.brandTagline')}
            className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-end border-t border-border bg-background pb-[max(8px,env(safe-area-inset-bottom))] pt-2 md:hidden"
          >
            {[
              { key: 'home', href: homeHref, label: t('nav.home'), d: ICONS.home },
              contentItem ? { key: 'blog', href: contentItem.href, label: t('nav.blog'), d: ICONS.blog } : null,
            ].map((tab, i) =>
              tab ? (
                <Link
                  key={tab.key}
                  href={tab.href}
                  aria-current={isActive(tab.href) ? 'page' : undefined}
                  className={`flex min-h-11 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                    isActive(tab.href) ? 'text-foreground' : 'text-muted-foreground'
                  }`}
                >
                  <AppIcon d={tab.d} />
                  {tab.label}
                </Link>
              ) : (
                <span key={`empty-${i}`} />
              ),
            )}
            <button
              type="button"
              onClick={openAddContent}
              aria-label={t('nav.add')}
              className="mx-auto grid size-[52px] -translate-y-3.5 place-items-center rounded-full bg-action text-action-foreground shadow-[var(--shadow-raise)]"
            >
              <AppIcon d={ICONS.plus} width={2.2} />
            </button>
            {leadsItem ? (
              <Link
                href={leadsItem.href}
                aria-current={isActive(leadsItem.href) ? 'page' : undefined}
                className={`flex min-h-11 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                  isActive(leadsItem.href) ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                <AppIcon d={ICONS.forms} />
                {t('nav.forms')}
              </Link>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => setDrawerOpen(!drawerOpen)}
              aria-expanded={drawerOpen}
              aria-controls="client-sidebar"
              className={`flex min-h-11 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
                moreActive ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <AppIcon d={ICONS.more} width={2.4} />
              {t('nav.more')}
            </button>
          </nav>
        )
      }}
    />
    {news.panel}
    {profile ? <ProfilePanel open={profileOpen} onClose={() => setProfileOpen(false)} profile={profile} /> : null}
    </>
  )
}
