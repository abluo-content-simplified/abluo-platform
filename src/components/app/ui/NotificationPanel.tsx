'use client'

import { useCallback, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Link } from '@/i18n/navigation'
import { AppIcon } from '@/components/app/shell/AppIcon'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { Notice } from './Notice'
import { PopoverPanel } from './PopoverPanel'
import { Skeleton } from './Skeleton'
import { FLOATING_STYLE, portalTarget, useAnchoredPopover } from './anchored-popover'

/**
 * The Notification Center panel (ADR-050 D10): the newest notifications, each
 * one line that links to what it is about. From md up a compact popover
 * anchored to the bell that opened it; on phones a bottom sheet. Unread rows
 * are bold with a dot; "Mark all as read" in the footer. No toasts, no sound —
 * the panel only opens when the person asks.
 *
 * All text arrives worded (`items[].text`, `meta`, `labels`); the panel reaches
 * no backend. `onItem` runs before the link navigates (mark that row read).
 */
export type NotificationPanelItem = {
  id: string
  href: string
  /** An AppIcon path. */
  icon: string
  /** The sentence, already in the reader's language. */
  text: string
  /** Second line: site · time. */
  meta: string
  unread: boolean
}

export type NotificationPanelLabels = {
  title: string
  empty: string
  markAll: string
  error: string
  retry: string
  /** Screen-reader word for an unread row. */
  unread: string
}

const DESKTOP = '(min-width: 48rem)'
const subscribe = (cb: () => void) => {
  const mq = window.matchMedia(DESKTOP)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

export function NotificationPanel({
  open,
  anchor,
  onClose,
  items,
  state,
  labels,
  onMarkAll,
  onRetry,
  onItem,
  id,
}: {
  open: boolean
  /** The bell that opened it (desktop popover anchor). */
  anchor: HTMLElement | null
  onClose: () => void
  items: NotificationPanelItem[]
  state: 'loading' | 'ready' | 'error'
  labels: NotificationPanelLabels
  onMarkAll?: () => void
  onRetry?: () => void
  onItem?: (id: string) => void
  id?: string
}) {
  const desktop = useSyncExternalStore(subscribe, () => window.matchMedia(DESKTOP).matches, () => false)
  const anchorRef = useRef<HTMLElement | null>(null)
  anchorRef.current = anchor
  const panelRef = useRef<HTMLDivElement>(null)
  const dismiss = useCallback(
    (refocus: boolean) => {
      onClose()
      if (refocus) anchorRef.current?.focus()
    },
    [onClose],
  )
  useAnchoredPopover({ open: open && desktop, anchorRef, panelRef, align: 'left', gap: 6, onDismiss: dismiss })

  const anyUnread = items.some((i) => i.unread)
  const body = (
    <div className="flex flex-col gap-1">
      {state === 'loading' ? (
        <div className="flex flex-col gap-3 p-2" aria-busy="true">
          <Skeleton className="h-10" shape="block" />
          <Skeleton className="h-10" shape="block" />
          <Skeleton className="h-10" shape="block" />
        </div>
      ) : state === 'error' ? (
        <Notice tone="error" action={onRetry ? <Button variant="secondary" onClick={onRetry}>{labels.retry}</Button> : undefined}>
          {labels.error}
        </Notice>
      ) : items.length === 0 ? (
        <p className="px-2 py-6 text-center text-[0.9375rem] leading-6 text-muted-foreground">{labels.empty}</p>
      ) : (
        <ul className="flex flex-col">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                onClick={() => {
                  onItem?.(item.id)
                  onClose()
                }}
                className="flex items-start gap-3 rounded-xl px-2 py-2.5 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="mt-0.5 shrink-0 text-muted-foreground">
                  <AppIcon d={item.icon} size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[0.9375rem] leading-6 break-words ${item.unread ? 'font-semibold text-foreground' : 'text-foreground'}`}>
                    {item.unread ? <span className="sr-only">{labels.unread}: </span> : null}
                    {item.text}
                  </span>
                  <span className="block text-xs leading-5 text-muted-foreground">{item.meta}</span>
                </span>
                {item.unread ? <span aria-hidden="true" className="mt-2 size-2.5 shrink-0 rounded-full bg-attention" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {onMarkAll && anyUnread && state === 'ready' ? (
        <div className="mt-1 flex items-start justify-end border-t border-border-subtle pt-2">
          <Button variant="secondary" onClick={onMarkAll}>
            {labels.markAll}
          </Button>
        </div>
      ) : null}
    </div>
  )

  if (!desktop) {
    return (
      <BottomSheet open={open} title={labels.title} onClose={onClose}>
        {body}
      </BottomSheet>
    )
  }
  if (!open || !anchor) return null
  return createPortal(
    <PopoverPanel ref={panelRef} id={id} role="dialog" aria-label={labels.title} style={FLOATING_STYLE} className="flex max-h-[70vh] w-96 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto">
      <h2 className="px-2 pt-1 pb-2 text-[0.9375rem] leading-6 font-semibold">{labels.title}</h2>
      {body}
    </PopoverPanel>,
    portalTarget(anchor),
  )
}
