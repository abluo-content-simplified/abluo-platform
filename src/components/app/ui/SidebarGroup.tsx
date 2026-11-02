'use client'

import type { ReactNode } from 'react'
import { AppIcon } from '@/components/app/shell/AppIcon'
import { CountBadge } from '@/components/app/ui/CountBadge'

/**
 * A group of the expanded sidebar: a heading that is a disclosure control (not
 * a link) opening and closing its destinations. The heading carries
 * `aria-expanded` / `aria-controls`; closed, the destinations leave the tab
 * order and the screen reader, and the group's aggregated attention badge
 * stays visible on the heading (`badge`, the sum of its destinations').
 * `active` marks that the current destination is inside the group, so a closed
 * group still shows where you are. The caller owns the open state.
 *
 *   <SidebarGroup id="nav-group-content" label="Content" open={open} onOpenChange={setOpen}>…SidebarLinks…</SidebarGroup>
 */
export function SidebarGroup({
  id,
  label,
  open,
  onOpenChange,
  active = false,
  badge,
  children,
}: {
  id: string
  /** Already translated. */
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  active?: boolean
  badge?: { count: number; label: string }
  children: ReactNode
}) {
  const panelId = `${id}-items`
  return (
    <div className="mt-4 first:mt-0">
      <button
        type="button"
        id={id}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className="flex min-h-8 w-full items-center gap-2 rounded-md px-3 text-left text-[0.6875rem] font-medium tracking-wider uppercase text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <span className={`flex-1 ${active && !open ? 'text-foreground' : ''}`}>{label}</span>
        {!open && badge && badge.count > 0 ? <CountBadge tone="attention" count={badge.count} srLabel={badge.label} /> : null}
        <span className={`inline-flex transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}>
          <AppIcon d="M9 6l6 6-6 6" size={14} width={2} />
        </span>
      </button>
      <div id={panelId} role="group" aria-labelledby={id} hidden={!open} className="mt-0.5 space-y-0.5">
        {children}
      </div>
    </div>
  )
}
