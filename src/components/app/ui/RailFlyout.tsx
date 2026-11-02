'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { FLOATING_STYLE, portalTarget } from '@/components/app/ui/anchored-popover'
import { RailItem } from '@/components/app/ui/RailItem'

/**
 * A group in the collapsed sidebar rail: the group's icon (a RailItem) that
 * opens a flyout listing its destinations beside the rail. Activating the icon
 * toggles it; the flyout closes on Escape (focus returns to the icon), on a
 * press outside, on scroll or resize, and when a destination inside is chosen.
 * Focus moves into the flyout when it opens. `active` marks that the current
 * destination is inside the group; `badge` is the group's aggregated count.
 * Children are the destinations (SidebarLink rows).
 *
 *   <RailFlyout label="Catalogue" icon={PATH} active badge={…}><SidebarLink … /></RailFlyout>
 */
export function RailFlyout({
  label,
  icon,
  active = false,
  badge,
  children,
}: {
  /** Already translated: the icon's accessible name and the flyout's heading. */
  label: string
  icon: string
  active?: boolean
  badge?: { count: number; label: string }
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState<HTMLElement | null>(null)
  const triggerRef = useRef<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useId()

  const dismiss = useCallback((refocus: boolean) => {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }, [])

  // Beside the rail, top aligned with the icon, kept inside the viewport.
  useLayoutEffect(() => {
    if (!open) return
    const trigger = triggerRef.current
    const panel = panelRef.current
    if (!trigger || !panel) return
    const r = trigger.getBoundingClientRect()
    const margin = 8
    const top = Math.max(margin, Math.min(r.top, window.innerHeight - panel.offsetHeight - margin))
    panel.style.top = `${Math.round(top)}px`
    panel.style.left = `${Math.round(r.right + 8)}px`
    panel.style.visibility = 'visible'
    panel.focus({ preventScroll: true })
  }, [open, target])

  useEffect(() => {
    if (!open) return
    const inside = (n: EventTarget | null) => n instanceof Node && (triggerRef.current?.contains(n) || panelRef.current?.contains(n))
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target)) dismiss(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        dismiss(true)
      }
    }
    const onMove = (e: Event) => {
      if (e.type === 'scroll' && inside(e.target)) return
      dismiss(false)
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, dismiss])

  return (
    <>
      <RailItem
        ref={triggerRef}
        label={label}
        icon={icon}
        active={active}
        badge={badge}
        popup
        expanded={open}
        suppressTooltip={open}
        controls={open ? id : undefined}
        onClick={() => {
          setTarget(portalTarget(triggerRef.current))
          setOpen((o) => !o)
        }}
      />
      {open && target
        ? createPortal(
            <div
              ref={panelRef}
              id={id}
              role="group"
              aria-label={label}
              tabIndex={-1}
              style={FLOATING_STYLE}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('a')) setOpen(false)
              }}
              className="z-50 w-56 rounded-2xl border border-border bg-popover p-1.5 text-popover-foreground shadow-[var(--shadow-raise)] outline-none"
            >
              <p className="px-3 pt-1.5 pb-1 text-[0.6875rem] font-medium tracking-wider text-muted-foreground uppercase">{label}</p>
              <div className="space-y-0.5">{children}</div>
            </div>,
            target,
          )
        : null}
    </>
  )
}
