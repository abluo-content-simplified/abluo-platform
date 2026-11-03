'use client'

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { usePathname } from '@/i18n/navigation'
import { RailFlyout } from '@/components/app/ui/RailFlyout'
import { RailItem } from '@/components/app/ui/RailItem'
import { SidebarCollapseToggle } from '@/components/app/ui/SidebarCollapseToggle'
import { SidebarGroup } from '@/components/app/ui/SidebarGroup'
import { SidebarLink } from '@/components/app/ui/SidebarLink'
import { AccountMenu, type AccountMenuProps } from './AccountMenu'
import { AppIcon, APP_ICONS } from './AppIcon'
import { currentNavLayout, useSidebarState } from './SidebarState'

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
  /** Starts a new group: rendered with extra space above (no heading). */
  groupStart?: boolean
  /**
   * Starts a new group WITH a small heading above it (already translated). The
   * admin uses headings; the client dashboard separates groups by space only.
   */
  groupHeading?: string
  /** A small count after the label (unread items). `label` is what a screen reader hears. Hidden at 0. */
  badge?: { count: number; label: string }
}

/**
 * A row that is not a link (e.g. the client's "What's new", which opens a
 * panel): rendered as given, in its place in the list. Same grouping fields.
 */
export type AppNavSlot = {
  key: string
  node: ReactNode
  groupStart?: boolean
  groupHeading?: string
  /** What the collapsed rail shows instead (e.g. an icon-only RailItem). None → the row is left out of the rail. */
  railNode?: ReactNode
}

/**
 * A collapsible group of destinations (ADR-042): a disclosure heading when the
 * sidebar is expanded, one icon with a flyout in the rail. The caller owns the
 * open state (remembered per person).
 */
export type AppNavGroup = {
  key: string
  /** Already translated. */
  label: string
  /** An `AppIcon` path (the rail shows it). */
  icon: string
  items: AppNavItem[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

export type AppNavEntry = AppNavItem | AppNavSlot | AppNavGroup

const isSlot = (entry: AppNavEntry): entry is AppNavSlot => 'node' in entry
const isGroup = (entry: AppNavEntry): entry is AppNavGroup => 'items' in entry

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
  items: AppNavEntry[]
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
  /** The current destination's key, when the caller resolves it (nested routes). Wins over `isActive`. */
  activeKey?: string | null
  /** Desktop and tablet can collapse to an icon rail (needs a `SidebarStateProvider` around the frame). Labels already translated. */
  collapsible?: { collapseLabel: string; expandLabel: string }
  /** Phone-only bottom tab bar. None → no tab bar. */
  bottomBar?: (bar: AppSidebarBottomBar) => ReactNode
  /** Phones: the side the drawer slides in from. Default `left` (admin); the client dashboard uses `right` (its "More" tab). md+ is always the left sidebar. */
  drawerSide?: 'left' | 'right'
  /** Phones: the hamburger at the left of the top bar. Default true; the client dashboard hides it (its "More" tab opens the same drawer). */
  showMenuButton?: boolean
}

const BRAND = 'Abluo'

/** A group's aggregated badge: the sum of its destinations' counts (and their labels), or undefined when nothing waits. */
function sumBadges(items: AppNavItem[]): { count: number; label: string } | undefined {
  const withBadge = items.filter((i) => i.badge && i.badge.count > 0)
  const count = withBadge.reduce((n, i) => n + (i.badge?.count ?? 0), 0)
  return count > 0 ? { count, label: withBadge.map((i) => i.badge?.label).filter(Boolean).join(', ') } : undefined
}

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
  activeKey,
  collapsible,
  bottomBar,
  drawerSide = 'left',
  showMenuButton = true,
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

  const sidebarState = useSidebarState()
  const isActive = (href: string) => isActiveFor(pathname, href)
  const itemActive = (item: AppNavItem) => (activeKey !== undefined ? item.key === activeKey : isActive(item.href))
  const links = items.flatMap((i): AppNavItem[] => (isSlot(i) ? [] : isGroup(i) ? i.items : [i]))
  const heading = title ?? links.find(itemActive)?.label ?? tagline
  const railEnabled = Boolean(collapsible && sidebarState)
  // Which of the two renderings shows: below md the drawer is always the expanded one; md-lg follows the tablet
  // preference, lg+ the desktop one (the attributes sit on the SidebarStateProvider wrapper).
  const EXPANDED_ONLY = railEnabled ? 'md:group-data-[nav-t=rail]/nav:max-lg:hidden lg:group-data-[nav-d=rail]/nav:hidden' : ''
  const RAIL_ONLY = 'hidden md:group-data-[nav-t=rail]/nav:max-lg:contents lg:group-data-[nav-d=rail]/nav:contents'
  const toggle = () => sidebarState?.toggleLayout(currentNavLayout())

  return (
    <>
      {/* ── Phone top bar ─────────────────────────────────────────────────── */}
      <div className={`sticky top-0 z-30 flex h-14 items-center gap-1 border-b border-border-subtle bg-background pr-1 md:hidden ${showMenuButton ? 'pl-1' : 'pl-4'}`}>
        {showMenuButton ? (
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
        ) : null}
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
        className={`fixed top-0 z-50 flex h-dvh w-64 flex-col overflow-y-auto overscroll-contain border-border bg-card text-card-foreground outline-none duration-200 motion-reduce:transition-none md:visible md:z-40 md:h-screen md:w-64 md:translate-x-0 ${railEnabled ? 'md:group-data-[nav-t=rail]/nav:max-lg:w-14 lg:group-data-[nav-d=rail]/nav:w-14' : ''} ${
          drawerSide === 'right'
            ? `right-0 border-l pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:right-auto md:left-0 md:border-l-0 md:border-r md:pb-0 ${drawerOpen ? '' : 'translate-x-full'}`
            : `left-0 border-r ${drawerOpen ? '' : '-translate-x-full'}`
        } ${
          drawerOpen
            ? 'visible translate-x-0 shadow-[var(--shadow-raise)] transition-[translate]'
            : 'invisible transition-[translate,visibility]'
        }`}
      >
        {/* ── Expanded (always on phones, in the drawer) ───────────────── */}
        <div className={`contents ${EXPANDED_ONLY}`}>
          <div className="flex items-start justify-between gap-2 border-b border-border-subtle px-5 py-5">
            <div>
              <span className="text-sm font-semibold tracking-tight text-foreground">{BRAND}</span>
              <p className="mt-0.5 text-xs text-muted-foreground">{tagline}</p>
            </div>
            {railEnabled && collapsible ? (
              <span className="hidden md:inline-flex">
                <SidebarCollapseToggle collapsed={false} label={collapsible.collapseLabel} onToggle={toggle} controls={id} />
              </span>
            ) : null}
          </div>

          {top ? <div className="border-b border-border-subtle px-4 py-4">{top}</div> : null}

          <nav aria-label={navLabel ?? tagline} className="flex-1 space-y-0.5 px-3 py-4">
            {items.map((item) => {
              if (isGroup(item)) {
                const badge = sumBadges(item.items)
                return (
                  <SidebarGroup
                    key={item.key}
                    id={`${id}-group-${item.key}`}
                    label={item.label}
                    open={item.open}
                    onOpenChange={item.onOpenChange}
                    active={item.items.some(itemActive)}
                    badge={badge}
                  >
                    {item.items.map((child) => (
                      <SidebarLink key={child.key} href={child.href} label={child.label} icon={child.icon} active={itemActive(child)} badge={child.badge} onNavigate={closeDrawer} />
                    ))}
                  </SidebarGroup>
                )
              }
              // A heading or a plain group start puts space above the row; a heading also labels it.
              const groupHead = item.groupHeading ? (
                <p className="mt-5 mb-1 px-3 text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">
                  {item.groupHeading}
                </p>
              ) : null
              const spaced = !item.groupHeading && item.groupStart
              if (isSlot(item)) {
                return (
                  <Fragment key={item.key}>
                    {groupHead}
                    <div className={spaced ? 'mt-4' : undefined}>{item.node}</div>
                  </Fragment>
                )
              }
              return (
                <Fragment key={item.key}>
                  {groupHead}
                  <SidebarLink
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={itemActive(item)}
                    badge={item.badge}
                    onNavigate={closeDrawer}
                    className={spaced ? 'mt-4' : ''}
                  />
                </Fragment>
              )
            })}
            {navFooter}
          </nav>

          {/* Desktop only: on phones the account menu lives in the top bar. */}
          <div className="hidden border-t border-border-subtle px-3 py-3 md:block">
            {footer ? <div className="mb-1">{footer}</div> : null}
            <AccountMenu variant="sidebar" {...account} />
          </div>
        </div>

        {/* ── Icon rail (tablet / desktop, when collapsed) ─────────────── */}
        {railEnabled && collapsible ? (
          <div className={RAIL_ONLY}>
            <div className="flex flex-col items-center gap-2 border-b border-border-subtle py-3">
              <span aria-hidden="true" className="text-sm font-semibold text-foreground">{BRAND.charAt(0)}</span>
              <SidebarCollapseToggle collapsed label={collapsible.expandLabel} onToggle={toggle} controls={id} />
            </div>
            <nav aria-label={navLabel ?? tagline} className="flex flex-1 flex-col items-center gap-1 px-2 py-3">
              {items.map((item) => {
                if (isGroup(item)) {
                  return (
                    <RailFlyout key={item.key} label={item.label} icon={item.icon} active={item.items.some(itemActive)} badge={sumBadges(item.items)}>
                      {item.items.map((child) => (
                        <SidebarLink key={child.key} href={child.href} label={child.label} icon={child.icon} active={itemActive(child)} badge={child.badge} />
                      ))}
                    </RailFlyout>
                  )
                }
                if (isSlot(item)) return item.railNode ? <Fragment key={item.key}>{item.railNode}</Fragment> : null
                return <RailItem key={item.key} href={item.href} label={item.label} icon={item.icon} active={itemActive(item)} badge={item.badge} />
              })}
            </nav>
            <div className="flex justify-center border-t border-border-subtle px-2 py-3">
              <AccountMenu variant="sidebar" compact {...account} />
            </div>
          </div>
        ) : null}
      </aside>

      {bottomBar?.({ drawerOpen, setDrawerOpen, isActive })}
    </>
  )
}
