'use client'

import { AppIcon } from '@/components/app/shell/AppIcon'

/**
 * The button that collapses the sidebar to an icon rail, or expands it again.
 * `collapsed` says which state the sidebar is in now; `label` is the ACTION
 * ("Collapse Sidebar" / "Expand Sidebar"), already translated, and is the
 * accessible name. The caller remembers the choice per person and layout.
 *
 *   <SidebarCollapseToggle collapsed={false} label="Collapse Sidebar" onToggle={…} controls="client-sidebar" />
 */
export function SidebarCollapseToggle({
  collapsed,
  label,
  onToggle,
  controls,
}: {
  collapsed: boolean
  label: string
  onToggle: () => void
  controls?: string
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-controls={controls}
      title={label}
      className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <AppIcon d={collapsed ? 'M13 17l5-5-5-5M6 17l5-5-5-5' : 'M11 17l-5-5 5-5M18 17l-5-5 5-5'} size={18} />
    </button>
  )
}
