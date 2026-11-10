'use client'

import { useRef, type MouseEvent } from 'react'
import { AppIcon, APP_ICONS } from '@/components/app/shell/AppIcon'
import { IconButton } from './Button'
import { CountBadge } from './CountBadge'
import { RailItem } from './RailItem'

/**
 * What opens the Notification Center panel (ADR-050 D10). Three looks, one
 * behaviour, like SearchTrigger:
 *   • field: a 44px icon button for the top of the expanded sidebar (beside
 *     the search field), the unread count on its corner;
 *   • rail: the collapsed icon rail's item (tooltip, dot when unread);
 *   • icon: the same 44px button for the phone top bar.
 * `label` is the accessible name ("Notifications"); `countLabel` is what a
 * screen reader hears for the number ("3 unread"). No count at 0. The click
 * passes its own element so the panel can anchor to the bell that was used.
 *
 *   <NotificationBell variant="field" label={t('title')} count={3} countLabel={t('unread', { count: 3 })} onOpen={open} />
 */
export function NotificationBell({
  variant,
  label,
  count,
  countLabel,
  onOpen,
  expanded = false,
  controls,
}: {
  variant: 'field' | 'rail' | 'icon'
  label: string
  count: number
  countLabel: string
  onOpen: (anchor: HTMLElement | null) => void
  expanded?: boolean
  controls?: string
}) {
  const railRef = useRef<HTMLElement | null>(null)
  const name = count > 0 ? `${label}, ${countLabel}` : label
  if (variant === 'rail') {
    return (
      <RailItem
        ref={railRef}
        label={label}
        icon={APP_ICONS.bell}
        onClick={() => onOpen(railRef.current)}
        badge={count > 0 ? { count, label: countLabel } : undefined}
        popup
        expanded={expanded}
        controls={controls}
      />
    )
  }
  return (
    <IconButton
      aria-label={name}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={(e: MouseEvent<HTMLButtonElement>) => onOpen(e.currentTarget)}
      className={variant === 'field' ? 'relative shrink-0 border border-border bg-background' : 'relative'}
    >
      <span className="relative inline-flex">
        <AppIcon d={APP_ICONS.bell} size={variant === 'icon' ? 22 : 20} />
        <CountBadge overlap count={count} srLabel={countLabel} />
      </span>
    </IconButton>
  )
}
