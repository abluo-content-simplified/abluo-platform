'use client'

import type { ComponentProps, ReactNode } from 'react'

/**
 * A button that looks like a quiet navigation row in the sidebar footer (icon,
 * label, optional trailing badge): "What's new", help, feedback. Same size and
 * colours as the sidebar's nav links; it opens something instead of navigating.
 *
 *   <SidebarRowButton icon={<AppIcon d={…} size={18} />} badge={<CountBadge count={2} srLabel="2 unread" />} onClick={open} aria-haspopup="dialog">What's new</SidebarRowButton>
 */
export function SidebarRowButton({
  icon,
  badge,
  children,
  type = 'button',
  ...rest
}: Omit<ComponentProps<'button'>, 'className' | 'children'> & { icon: ReactNode; badge?: ReactNode; children: ReactNode }) {
  return (
    <button
      type={type}
      className="flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      {...rest}
    >
      {icon}
      <span className="flex-1 text-left">{children}</span>
      {badge}
    </button>
  )
}
