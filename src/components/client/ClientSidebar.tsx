'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname, useRouter } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/client'
import { ProjectSwitcher } from './ProjectSwitcher'
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
}

export function ClientSidebar({ navItems, projects, activeSlug }: ClientSidebarProps) {
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
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col bg-zinc-950">
      {/* Brand */}
      <div className="border-b border-zinc-800 px-5 py-5">
        <span className="text-xs font-medium uppercase tracking-[0.25em] text-zinc-100">
          Abluo
        </span>
        <p className="mt-0.5 text-[10px] tracking-wider text-zinc-500">
          {t('shell.brandTagline')}
        </p>
      </div>

      {/* Project switcher */}
      <div className="border-b border-zinc-800 px-4 py-4">
        <ProjectSwitcher projects={projects} activeSlug={activeSlug} />
      </div>

      {/* Module-driven nav */}
      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {navItems.length === 0 ? (
          <p className="px-3 py-2 text-[11px] leading-relaxed text-zinc-600">
            {t('shell.noModules')}
          </p>
        ) : (
          navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
            return (
              <Link
                key={item.moduleId}
                href={item.href}
                className={`block rounded px-3 py-2 text-xs tracking-wide transition-colors ${
                  active
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-300'
                }`}
              >
                {t(`nav.${item.moduleId}`)}
              </Link>
            )
          })
        )}
      </nav>

      {/* Footer — account + sign-out */}
      <div className="space-y-2 border-t border-zinc-800 px-4 py-4">
        <Link
          href="/account"
          className="block text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300"
        >
          {t('shell.account')}
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="text-[10px] uppercase tracking-widest text-zinc-500 transition-colors hover:text-zinc-300"
        >
          {t('shell.signOut')}
        </button>
      </div>
    </aside>
  )
}
