'use client'

import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/app/shell/AppIcon'
import { CountBadge } from '@/components/app/ui/CountBadge'

/**
 * One destination row of the expanded sidebar (and of a rail flyout): icon,
 * label, optional attention badge. The current destination is `aria-current=
 * "page"` and drawn selected. Locale-agnostic `href` (the next-intl Link adds
 * the locale). `onNavigate` lets a drawer or flyout close itself.
 *
 *   <SidebarLink href="/livener/posts" label="Posts" icon={PATH} active />
 */
export function SidebarLink({
  href,
  label,
  icon,
  active = false,
  badge,
  onNavigate,
  className = '',
}: {
  href: string
  label: string
  /** An `AppIcon` path. */
  icon: string
  active?: boolean
  badge?: { count: number; label: string }
  onNavigate?: () => void
  className?: string
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`${className} flex min-h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        active ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground'
      }`}
    >
      <AppIcon d={icon} size={18} />
      {label}
      {badge && badge.count > 0 ? (
        <span className="ml-auto inline-flex">
          <CountBadge tone="attention" count={badge.count} srLabel={badge.label} />
        </span>
      ) : null}
    </Link>
  )
}
