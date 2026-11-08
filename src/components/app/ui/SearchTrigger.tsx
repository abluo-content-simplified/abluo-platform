'use client'

import { useSyncExternalStore } from 'react'
import { AppIcon } from '@/components/app/shell/AppIcon'
import { IconButton } from './Button'
import { RailItem } from './RailItem'

/**
 * What opens the search overlay (ADR-047). Three looks, one behaviour:
 *   • field: a search-field-shaped button for the expanded sidebar, with the
 *     keyboard shortcut ("⌘K" on a Mac, "Ctrl K" elsewhere) at its right edge.
 *   • rail: the collapsed icon rail's item (tooltip with the label).
 *   • icon: a 44px icon button, for the phone top bar.
 * `label` names it (visible in `field`, the accessible name in the others).
 * Already translated; so are both shortcut hints.
 *
 *   <SearchTrigger variant="field" label={t('trigger')} shortcut={{ mac: '⌘K', other: 'Ctrl K' }} onOpen={open} />
 */
const SEARCH_ICON = 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5'

const noopSubscribe = () => () => {}
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export function SearchTrigger({
  variant,
  label,
  shortcut,
  onOpen,
  controls,
}: {
  variant: 'field' | 'rail' | 'icon'
  label: string
  /** field only. */
  shortcut?: { mac: string; other: string }
  onOpen: () => void
  /** Optional: the overlay it opens (aria-haspopup is always "dialog"). */
  controls?: string
}) {
  const mac = useSyncExternalStore(noopSubscribe, isMac, () => false)
  if (variant === 'rail') return <RailItem label={label} icon={SEARCH_ICON} onClick={onOpen} popup={false} controls={controls} />
  if (variant === 'icon') {
    return (
      <IconButton aria-label={label} aria-haspopup="dialog" onClick={onOpen}>
        <AppIcon d={SEARCH_ICON} size={22} />
      </IconButton>
    )
  }
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onOpen}
      className="flex h-11 w-full items-center gap-2.5 rounded-xl border border-border bg-background px-3 text-left text-[0.9375rem] text-muted-foreground transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <AppIcon d={SEARCH_ICON} size={18} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? (
        <kbd className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-sans text-[0.6875rem] text-muted-foreground" aria-hidden="true">
          {mac ? shortcut.mac : shortcut.other}
        </kbd>
      ) : null}
    </button>
  )
}
