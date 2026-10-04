'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'
import { ProjectSwitcher } from './ProjectSwitcher'
import { AppThemeSwitch } from './AppThemeSwitch'
import type { AppTheme } from '@/lib/app-theme'
import type { ClientNavItem } from '@/lib/modules/client-navigation'

/**
 * Client-dashboard sidebar (ADR-017 Phase 2 / task #81). Mirrors AdminSidebar's
 * structure (fixed rail, logo, nav, footer with identity + sign-out) but is
 * MODULE-DRIVEN and fully localized:
 *   • Nav items come from `buildClientNavItems(activeGrant)` — the sidebar shows
 *     only the modules enabled for the active project. Labels are translated
 *     from each item's `labelKey` (`clientDashboard.nav.<moduleId>`), never a
 *     hardcoded or Studio-English string (Tom's locked decision #2).
 *   • A `ProjectSwitcher` sits at the top so a multi-project user can move
 *     between projects; the active project is always the URL's first segment.
 *
 * A Client Component: it needs `usePathname` for active-route highlighting,
 * `useTranslations` for labels, and a browser Supabase client for sign-out.
 */

export type ClientSidebarProps = {
  navItems: ClientNavItem[]
  /** Projects the user may switch between (resolved slugs). */
  projects: { projectSlug: string }[]
  /** Active project slug (URL first segment). */
  activeSlug: string
  /** The app theme preference, read from the cookie on the server. */
  theme: AppTheme
}

export function ClientSidebar({ navItems, projects, activeSlug, theme }: ClientSidebarProps) {
  const t = useTranslations('clientDashboard')
  const pathname = usePathname() // locale-stripped, e.g. "/livener/posts"
  const router = useRouter()

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-border bg-card text-card-foreground">
      {/* Brand */}
      <div className="border-b border-border-subtle px-5 py-5">
        <span className="text-sm font-semibold tracking-tight text-foreground">
          Abluo
        </span>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('shell.brandTagline')}
        </p>
      </div>

      {/* Project switcher */}
      <div className="border-b border-border-subtle px-4 py-4">
        <ProjectSwitcher projects={projects} activeSlug={activeSlug} />
      </div>

      {/* Module-driven nav */}
      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navItems.length === 0 ? (
          <p className="px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {t('shell.noModules')}
          </p>
        ) : (
          navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.moduleId}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-10 items-center rounded-md px-3 text-sm transition-colors ${
                  active
                    ? 'bg-muted font-semibold text-foreground'
                    : 'text-muted-foreground hover:bg-hover hover:text-foreground'
                }`}
              >
                {t(`nav.${item.moduleId}`)}
              </Link>
            )
          })
        )}
      </nav>

      {/* Footer — account + sign-out */}
      <div className="space-y-3 border-t border-border-subtle px-4 py-4">
        <AppThemeSwitch initial={theme} />
        <Link
          href="/account"
          className="block text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('shell.account')}
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('shell.signOut')}
        </button>
      </div>
    </aside>
  )
}
