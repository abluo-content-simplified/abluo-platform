'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'
import { ProjectSwitcher } from './ProjectSwitcher'
import { AppThemeSwitch } from './AppThemeSwitch'
import { AppVersion } from './AppVersion'
import { AddContentSheet } from './create/AddContentSheet'
import type { CreateMenu } from '@/lib/modules/create-menu'
import type { AppTheme } from '@/lib/app-theme'
import type { ClientNavItem } from '@/lib/modules/client-navigation'

/**
 * Client-dashboard navigation shell (ADR-017 Phase 2, restyled in S1 / ADR-025).
 *
 * One component, two layouts, one set of destinations:
 *   • Phones: a slim top bar with the project name, and a bottom tab bar —
 *     Home · Content · [+ Add content] · Leads · More. "More" opens the drawer
 *     (project switcher, appearance, account, sign out).
 *   • From md up: the fixed sidebar — Home first, then the module-driven items,
 *     and "+ Add content" as the one action button.
 * Content and Leads exist only when the project has the module (navItems are
 * module-driven, `buildClientNavItems`). All copy from `clientDashboard.*`.
 *
 * "+ Add content" (desktop button and the phone tab bar's "+") opens the
 * "What would you like to create?" sheet (ADR-025 D8, `AddContentSheet`).
 */

export type ClientSidebarProps = {
  navItems: ClientNavItem[]
  /** Projects the user may switch between (resolved slugs). */
  projects: { projectSlug: string }[]
  /** Active project slug (URL first segment). */
  activeSlug: string
  /** The app theme preference, read from the cookie on the server. */
  theme: AppTheme
  /** Locale-agnostic href of the project's dashboard home. */
  homeHref: string
  /** What this user can create in this project (server-computed, `buildCreateMenu`). */
  createMenu?: CreateMenu
  /** Abluo contact for "Ask us to add it" (optional). */
  contactEmail?: string | null
}

const ICONS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  blog: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  forms: 'M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
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
  theme,
  homeHref,
  createMenu = { available: [], more: [] },
  contactEmail = null,
}: ClientSidebarProps) {
  const t = useTranslations('clientDashboard')
  const pathname = usePathname() // locale-stripped, e.g. "/livener/posts"
  const router = useRouter()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)

  useEffect(() => {
    setDrawerOpen(false)
    setAddOpen(false)
  }, [pathname])

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const contentItem = navItems.find((i) => i.moduleId === 'blog')
  const leadsItem = navItems.find((i) => i.moduleId === 'forms')

  return (
    <>
      {/* ── Phone top bar ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 flex h-14 items-center border-b border-border-subtle bg-background px-4 md:hidden">
        <span className="truncate text-[15px] font-semibold">{activeSlug}</span>
      </div>

      {/* ── Drawer backdrop (phones) ─────────────────────────────────────── */}
      {drawerOpen && (
        <button
          type="button"
          aria-label={t('shell.closeMenu')}
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-40 bg-overlay md:hidden"
        />
      )}

      {/* ── Sidebar (md+) / drawer (phones) ──────────────────────────────── */}
      <aside
        id="client-sidebar"
        className={`fixed left-0 top-0 z-50 flex h-dvh w-64 flex-col border-r border-border bg-card text-card-foreground transition-transform duration-200 md:z-40 md:h-screen md:w-56 md:translate-x-0 ${
          drawerOpen ? 'translate-x-0 shadow-[var(--shadow-raise)]' : '-translate-x-full'
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
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="mb-3 hidden h-11 w-full items-center justify-center gap-2 rounded-md bg-action text-sm font-semibold text-action-foreground md:flex"
          >
            <Icon d={ICONS.plus} size={18} width={2.2} />
            {t('nav.add')}
          </button>
          {[{ moduleId: 'home', href: homeHref, label: t('nav.home') }, ...navItems.map((i) => ({ moduleId: i.moduleId, href: i.href, label: t(`nav.${i.moduleId}`) }))].map(
            (item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.moduleId}
                  href={item.href}
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

        <div className="space-y-3 border-t border-border-subtle px-4 py-4">
          <AppThemeSwitch initial={theme} />
          <Link href="/account" className="flex min-h-8 items-center text-sm text-muted-foreground transition-colors hover:text-foreground">
            {t('shell.account')}
          </Link>
          <button type="button" onClick={handleSignOut} className="min-h-8 text-sm text-muted-foreground transition-colors hover:text-foreground">
            {t('shell.signOut')}
          </button>
          <AppVersion />
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
          onClick={() => setAddOpen(true)}
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
          onClick={() => setDrawerOpen(true)}
          aria-expanded={drawerOpen}
          aria-controls="client-sidebar"
          className="flex min-h-11 flex-col items-center justify-center gap-0.5 text-xs font-medium text-muted-foreground"
        >
          <Icon d={ICONS.more} width={2.4} />
          {t('nav.more')}
        </button>
      </nav>

      {/* ── "+ Add content" → "What would you like to create?" ───────────── */}
      <AddContentSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        projectSlug={activeSlug}
        menu={createMenu}
        contactEmail={contactEmail}
      />
    </>
  )
}
