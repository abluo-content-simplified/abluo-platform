'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { ProjectSwitcher } from './ProjectSwitcher'
import { AccountMenu, type AccountMenuProps } from './AccountMenu'
import { useOpenAddContent } from './create/AddContentRoot'
import type { ClientNavItem } from '@/lib/modules/client-navigation'
import { isNavItemActive, phoneNavLayout } from '@/lib/modules/client-nav-layout'

/**
 * Client-dashboard navigation shell (ADR-017 Phase 2, restyled in S1 / ADR-025).
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
 * from the tenant surface registry, `buildClientNavItems`). All copy from `clientDashboard.*`.
 *
 * The phone tab bar's "+" opens the "What would you like to create?" panel
 * (ADR-025 D8). That panel and the floating "+" live OUTSIDE the sidebar, in
 * `create/AddContentRoot` (rendered by `[tenant]/layout.tsx`), so the FAB is
 * truly fixed to the viewport.
 */

export type ClientSidebarProps = {
  navItems: ClientNavItem[]
  /** Projects the user may switch between (resolved slugs). */
  projects: { projectSlug: string }[]
  /** Active project slug (URL first segment). */
  activeSlug: string
  /** The signed-in person and their app preferences, for the account menu. */
  account: Omit<AccountMenuProps, 'variant'>
  /** Locale-agnostic href of the project's dashboard home. */
  homeHref: string
}

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  blog: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  forms: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  gallery: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M15 9h.01',
  media: 'M3 7h4l2-3h6l2 3h4v13H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  people: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  menu: 'M4 6h16M4 12h16M4 18h16',
  plus: 'M12 5v14M5 12h14',
  generic: 'M4 6h16M4 12h16M4 18h10',
} as const

function Icon({ d, size = 24, width = 1.8 }: { d: string; size?: number; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const iconFor = (moduleId: string) => (ICONS as Record<string, string>)[moduleId] ?? ICONS.generic

export function ClientSidebar({
  navItems,
  projects,
  activeSlug,
  account,
  homeHref,
}: ClientSidebarProps) {
  const t = useTranslations('clientDashboard')
  const pathname = usePathname() // locale-stripped, e.g. "/livener/posts"
  // Open on the page it was opened on: navigating closes it. The page is then
  // forgotten (adjusting state during render, no effect), so coming BACK to
  // that page never pops the drawer open again by itself.
  const [drawerOpenOn, setDrawerOpenOn] = useState<string | null>(null)
  if (drawerOpenOn !== null && drawerOpenOn !== pathname) setDrawerOpenOn(null)
  const drawerOpen = drawerOpenOn === pathname
  const setDrawerOpen = (next: boolean) => setDrawerOpenOn(next ? pathname : null)
  const closeDrawer = () => setDrawerOpenOn(null)
  const drawerRef = useRef<HTMLElement>(null)
  const openAddContent = useOpenAddContent()

  // While the drawer is open (phones): Escape closes it, focus moves into it
  // and goes back to the button that opened it, the page behind does not scroll.
  // Widening the window to the desktop layout closes it (the sidebar is then
  // always there, and the scroll lock must not stay behind).
  useEffect(() => {
    if (!drawerOpen) return
    const panel = drawerRef.current
    const desktop = window.matchMedia('(min-width: 48rem)')
    const onDesktop = () => {
      if (desktop.matches) setDrawerOpenOn(null)
    }
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpenOn(null)
    }
    const root = document.documentElement
    const prevOverflow = root.style.overflow
    root.style.overflow = 'hidden'
    document.addEventListener('keydown', onKey)
    desktop.addEventListener('change', onDesktop)
    panel?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener('keydown', onKey)
      desktop.removeEventListener('change', onDesktop)
      root.style.overflow = prevOverflow
      if (panel?.contains(document.activeElement)) trigger?.focus({ preventScroll: true })
    }
  }, [drawerOpen])

  const isActive = (href: string) => isNavItemActive(pathname, href)

  const { content: contentItem, forms: leadsItem, overflow } = phoneNavLayout(navItems)
  // "More" carries the active state for pages without a tab of their own.
  const moreActive = drawerOpen || overflow.some((i) => isActive(i.href))

  return (
    <>
      {/* ── Phone top bar ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border-subtle bg-background pl-1 pr-1 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label={t('shell.openMenu')}
          aria-expanded={drawerOpen}
          aria-controls="client-sidebar"
          className="grid size-11 shrink-0 place-items-center rounded-md text-foreground hover:bg-hover"
        >
          <Icon d={ICONS.menu} size={22} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">{activeSlug}</span>
        <AccountMenu variant="bar" {...account} />
      </div>

      {/* ── Drawer backdrop (phones) ─────────────────────────────────────── */}
      {drawerOpen && (
        <button
          type="button"
          aria-label={t('shell.closeMenu')}
          onClick={closeDrawer}
          className="fixed inset-0 z-40 bg-overlay md:hidden"
        />
      )}

      {/* ── Sidebar (md+) / drawer (phones) ──────────────────────────────── */}
      {/* Closed on phones it is also invisible, so it leaves the tab order and the
          screen reader. Visibility is transitioned only when closing (hidden after the
          slide-out); opening shows it at once, so focus can move in. md+ always visible. */}
      <aside
        id="client-sidebar"
        ref={drawerRef}
        tabIndex={-1}
        className={`fixed left-0 top-0 z-50 flex h-dvh w-64 flex-col overflow-y-auto overscroll-contain border-r border-border bg-card text-card-foreground outline-none duration-200 motion-reduce:transition-none md:visible md:z-40 md:h-screen md:w-56 md:translate-x-0 ${
          drawerOpen
            ? 'visible translate-x-0 shadow-[var(--shadow-raise)] transition-[translate]'
            : 'invisible -translate-x-full transition-[translate,visibility]'
        }`}
      >
        <div className="border-b border-border-subtle px-5 py-5">
          <span className="text-sm font-semibold tracking-tight text-foreground">Abluo</span>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('shell.brandTagline')}</p>
        </div>

        <div className="border-b border-border-subtle px-4 py-4">
          <ProjectSwitcher projects={projects} activeSlug={activeSlug} />
        </div>

        <nav aria-label={t('shell.brandTagline')} className="flex-1 space-y-0.5 px-3 py-4">
          {[{ moduleId: 'home', href: homeHref, label: t('nav.home') }, ...navItems.map((i) => ({ moduleId: i.moduleId, href: i.href, label: t(`nav.${i.moduleId}`) }))].map(
            (item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.moduleId}
                  href={item.href}
                  onClick={closeDrawer}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors ${
                    active ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground'
                  }`}
                >
                  <Icon d={iconFor(item.moduleId)} size={18} />
                  {item.label}
                </Link>
              )
            },
          )}
          {navItems.length === 0 && (
            <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">{t('shell.noModules')}</p>
          )}
        </nav>

        {/* Desktop only: on phones the account menu lives in the top bar. */}
        <div className="hidden border-t border-border-subtle px-3 py-3 md:block">
          <AccountMenu variant="sidebar" {...account} />
        </div>
      </aside>

      {/* ── Bottom tab bar (phones) ──────────────────────────────────────── */}
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
              <Icon d={tab.d} />
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
          <Icon d={ICONS.plus} width={2.2} />
        </button>
        {leadsItem ? (
          <Link
            href={leadsItem.href}
            aria-current={isActive(leadsItem.href) ? 'page' : undefined}
            className={`flex min-h-11 flex-col items-center justify-center gap-0.5 text-xs font-medium ${
              isActive(leadsItem.href) ? 'text-foreground' : 'text-muted-foreground'
            }`}
          >
            <Icon d={ICONS.forms} />
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
          <Icon d={ICONS.more} width={2.4} />
          {t('nav.more')}
        </button>
      </nav>

    </>
  )
}
