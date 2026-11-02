'use client'

import { useRef, useState, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/app/shell/AppIcon'
import { portalTarget } from '@/components/app/ui/anchored-popover'

/**
 * One destination (or action) in the collapsed sidebar rail: an icon with the
 * label as its ACCESSIBLE NAME and as a tooltip. The tooltip shows on hover and
 * on keyboard focus, and Escape hides it (it never covers the trigger). The
 * current destination is `aria-current="page"` and drawn selected. A count
 * badge is a small dot on the icon; the screen reader hears it after the label.
 *
 * `href` → a link; `onClick` (no href) → a button, e.g. "What's New". As a
 * flyout trigger pass `popup` + `expanded`, and `suppressTooltip` while open.
 *
 *   <RailItem href="/livener/posts" label="Posts" icon={PATH} active />
 */
export type RailItemProps = {
  /** Already translated; the accessible name and the tooltip. */
  label: string
  /** An `AppIcon` path. */
  icon: string
  href?: string
  onClick?: () => void
  active?: boolean
  badge?: { count: number; label: string }
  popup?: boolean
  expanded?: boolean
  suppressTooltip?: boolean
  controls?: string
  ref?: Ref<HTMLElement>
}

const LOOK = (active: boolean) =>
  `relative grid size-10 place-items-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
    active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground'
  }`

export function RailItem({ label, icon, href, onClick, active = false, badge, popup, expanded, suppressTooltip, controls, ref }: RailItemProps) {
  const own = useRef<HTMLElement | null>(null)
  const [tip, setTip] = useState<{ top: number; left: number; target: HTMLElement } | null>(null)
  const name = badge && badge.count > 0 ? `${label}, ${badge.label}` : label

  const show = () => {
    const el = own.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setTip({ top: Math.round(r.top + r.height / 2), left: Math.round(r.right + 8), target: portalTarget(el) })
  }
  const hide = () => setTip(null)
  const setRef = (el: HTMLElement | null) => {
    own.current = el
    if (typeof ref === 'function') ref(el)
    else if (ref) (ref as { current: HTMLElement | null }).current = el
  }
  const handlers = {
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') hide()
    },
  }
  const inner = (
    <>
      <AppIcon d={icon} size={20} />
      {badge && badge.count > 0 ? <span aria-hidden="true" className="absolute top-1.5 right-1.5 size-2.5 rounded-full bg-attention ring-2 ring-card" /> : null}
    </>
  )
  return (
    <>
      {href ? (
        <Link ref={setRef as Ref<HTMLAnchorElement>} href={href} aria-label={name} aria-current={active ? 'page' : undefined} className={LOOK(active)} {...handlers}>
          {inner}
        </Link>
      ) : (
        <button
          ref={setRef as Ref<HTMLButtonElement>}
          type="button"
          aria-label={name}
          aria-haspopup={popup ? 'true' : undefined}
          aria-expanded={popup ? Boolean(expanded) : undefined}
          aria-controls={controls}
          onClick={() => {
            hide()
            onClick?.()
          }}
          className={LOOK(active)}
          {...handlers}
        >
          {inner}
        </button>
      )}
      {tip && !suppressTooltip
        ? createPortal(
            <span
              role="presentation"
              style={{ position: 'fixed', top: tip.top, left: tip.left, transform: 'translateY(-50%)' }}
              className="pointer-events-none z-50 rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium whitespace-nowrap text-popover-foreground shadow-[var(--shadow-raise)]"
            >
              {label}
            </span>,
            tip.target,
          )
        : null}
    </>
  )
}
