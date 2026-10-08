'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { AccountMenu, type AccountMenuProps } from './AccountMenu'
import { AppIcon, APP_ICONS } from './AppIcon'

/**
 * The navigation frame of every Abluo App surface (ADR-030) — the client
 * dashboard and the Abluo admin compose it; neither draws its own.
 *
 * One component, two layouts, one set of destinations:
 *   • Phones: a slim top bar (menu button, title, the person's avatar) and a
 *     drawer — the same sidebar — that the menu button opens. The drawer closes
 *     on navigation, a tap on the backdrop or any item, and Escape. A surface
 *     may add a bottom tab bar (`bottomBar`); it gets the drawer state, so a
 *     "More" tab can open the same drawer.
 *   • From md up: the fixed sidebar — brand, an optional `top` slot (the client
 *     puts its project switcher there), the nav, and the account menu (a
 *     popover) from the avatar at its bottom.
 *
 * Everything a person reads arrives translated from the caller (labels, title,
 * tagline); the only copy owned here is the menu buttons' (`app.shell`).
 * "Abluo" is the product name and is never translated.
 */

export type AppNavItem = {
  /** Stable key (module id, route name). */
  key: string
  /** Locale-agnostic href. */
  href: string
  /** Already translated. */
  label: string
  /** An `AppIcon` path. */
  icon: string
}

/** What a surface's phone tab bar needs from the frame. */
export type AppSidebarBottomBar = {
  drawerOpen: boolean
  setDrawerOpen: (open: boolean) => void
  isActive: (href: string) => boolean
}

export type AppSidebarProps = {
  /** id of the drawer element (the menu buttons' aria-controls). */
  id: string
  /** Under the brand, e.g. "Dashboard" / "Admin". Also names the nav landmark unless `navLabel` is given. */
  tagline: string
  navLabel?: string
  /** Phone top bar title. Defaults to the active item's label (then the tagline). */
  title?: string
  items: AppNavItem[]
  /** Between the brand and the nav (md+ and in the drawer). */
  top?: ReactNode
  /** After the nav items, inside the nav (e.g. "no modules yet"). */
  navFooter?: ReactNode
  /** md+ only: at the bottom of the sidebar, above the account menu (e.g. the client's "What's new"). */
  footer?: ReactNode
  /** The signed-in person, for the account menu (both variants). */
  account: Omit<AccountMenuProps, 'variant'>
  /** Is `href` the current page? Defaults to "this page or a page under it". */
  isActive?: (pathname: string, href: string) => boolean
  /** Phone-only bottom tab bar. None → no tab bar. */
  bottomBar?: (bar: AppSidebarBottomBar) => ReactNode
}

const BRAND = 'Abluo'

/** `/x` is active on `/x` and `/x/…`, never on `/xy`. Pure; both sides locale-agnostic. */
export function isHrefActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function AppSidebar({
  id,
  tagline,
  navLabel,
  title,
  items,
  top,
  navFooter,
  footer,
  account,
  isActive: isActiveFor = isHrefActive,
  bottomBar,
}: AppSidebarProps) {
  const t = useTranslations('app.shell')
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

  const isActive = (href: string) => isActiveFor(pathname, href)
  const heading = title ?? items.find((i) => isActive(i.href))?.label ?? tagline

  return (
    <>
      {/* ── Phone top bar ─────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border-subtle bg-background pl-1 pr-1 md:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label={t('openMenu')}
          aria-expanded={drawerOpen}
          aria-controls={id}
          className="grid size-11 shrink-0 place-items-center rounded-md text-foreground hover:bg-hover"
        >
          <AppIcon d={APP_ICONS.menu} size={22} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold">{heading}</span>
        <AccountMenu variant="bar" {...account} />
      </div>

      {/* ── Drawer backdrop (phones) ─────────────────────────────────────── */}
      {drawerOpen && (
        <button
          type="button"
          aria-label={t('closeMenu')}
          onClick={closeDrawer}
          className="fixed inset-0 z-40 bg-overlay md:hidden"
        />
      )}

      {/* ── Sidebar (md+) / drawer (phones) ──────────────────────────────── */}
      {/* Closed on phones it is also invisible, so it leaves the tab order and the
          screen reader. Visibility is transitioned only when closing (hidden after the
          slide-out); opening shows it at once, so focus can move in. md+ always visible. */}
      <aside
        id={id}
        ref={drawerRef}
        tabIndex={-1}
        className={`fixed left-0 top-0 z-50 flex h-dvh w-64 flex-col overflow-y-auto overscroll-contain border-r border-border bg-card text-card-foreground outline-none duration-200 motion-reduce:transition-none md:visible md:z-40 md:h-screen md:w-56 md:translate-x-0 ${
          drawerOpen
            ? 'visible translate-x-0 shadow-[var(--shadow-raise)] transition-[translate]'
            : 'invisible -translate-x-full transition-[translate,visibility]'
        }`}
      >
        <div className="border-b border-border-subtle px-5 py-5">
          <span className="text-sm font-semibold tracking-tight text-foreground">{BRAND}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">{tagline}</p>
        </div>

        {top ? <div className="border-b border-border-subtle px-4 py-4">{top}</div> : null}

        <nav aria-label={navLabel ?? tagline} className="flex-1 space-y-0.5 px-3 py-4">
          {items.map((item) => {
            const active = isActive(item.href)
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={closeDrawer}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors ${
                  active ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground'
                }`}
              >
                <AppIcon d={item.icon} size={18} />
                {item.label}
              </Link>
            )
          })}
          {navFooter}
        </nav>

        {/* Desktop only: on phones the account menu lives in the top bar. */}
        <div className="hidden border-t border-border-subtle px-3 py-3 md:block">
          {footer ? <div className="mb-1">{footer}</div> : null}
          <AccountMenu variant="sidebar" {...account} />
        </div>
      </aside>

      {bottomBar?.({ drawerOpen, setDrawerOpen, isActive })}
    </>
  )
}
