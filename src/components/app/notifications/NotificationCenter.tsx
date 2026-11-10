'use client'

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { APP_ICONS } from '@/components/app/shell/AppIcon'
import { NotificationBell } from '@/components/app/ui/NotificationBell'
import { NotificationPanel, type NotificationPanelItem } from '@/components/app/ui/NotificationPanel'
import { useVisibleInterval } from '@/components/app/use-visible-interval'
import { useDateLocale } from '@/lib/i18n/date-locale-context'
import type { NotificationItem } from '@/lib/notification-center/model'

/**
 * The Notification Center for one dashboard (ADR-050 D9/D10): the bell's three
 * triggers for AppSidebar's `bell` slot, and the panel. The dashboard passes
 * its own server actions (client: its session's notifications; admin: the
 * Abluo team's), so this file never decides whose rows it reads.
 *
 * The number is re-read after every page change (opening a conversation marks
 * its row read) and every 60 s while the tab is visible. Rows are worded here,
 * in the reader's language (`app.notifications.kinds.*`).
 */
export type NotificationActions = {
  count: () => Promise<number>
  list: () => Promise<NotificationItem[] | null>
  markRead: (id?: string) => Promise<void>
}

const ICON: Record<string, string> = {
  message: APP_ICONS.messages,
  ticket: APP_ICONS.support,
  announcement: APP_ICONS.bell,
}

export function useNotificationCenter({
  actions,
  initialCount,
  pathname,
  enabled = true,
  showProject = true,
}: {
  actions: NotificationActions
  initialCount: number
  pathname: string
  /** Off: no bell at all (e.g. an Abluo admin's support visit). */
  enabled?: boolean
  /** Name the site on each row (people on several sites; the Abluo team). */
  showProject?: boolean
}): { bell: { field: ReactNode; rail: ReactNode; icon: ReactNode } | undefined; panel: ReactNode } {
  const t = useTranslations('app.notifications')
  const dateLocale = useDateLocale()
  const panelId = useId()
  const [count, setCount] = useState(initialCount)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => setCount(initialCount), [initialCount])
  const refreshCount = useCallback(async () => {
    try {
      const n = await actions.count()
      if (typeof n === 'number' && Number.isFinite(n)) setCount(Math.max(0, n))
    } catch {
      /* keep the last number */
    }
  }, [actions])
  useEffect(() => {
    if (enabled) void refreshCount()
  }, [refreshCount, pathname, enabled])
  useVisibleInterval(refreshCount, 60_000, enabled)

  const load = useCallback(async () => {
    setState('loading')
    try {
      const list = await actions.list()
      if (!list) throw new Error('unavailable')
      setItems(list)
      setCount(list.filter((i) => !i.read).length)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [actions])

  const openPanel = (el: HTMLElement | null) => {
    if (open) {
      setOpen(false)
      return
    }
    setAnchor(el)
    setOpen(true)
    void load()
  }

  const fmt = new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const sentence = (i: NotificationItem): string => {
    const p = i.params
    const str = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : '')
    const values = {
      subject: str('subject'),
      reference: str('reference'),
      project: str('project') || i.projectName || '',
      from: str('name') ? t('fromAbluo', { name: str('name') }) : t('abluo'),
      name: str('name') || t('someone'),
      count: i.count,
    }
    return t(`kinds.${i.kind}`, values)
  }
  const panelItems: NotificationPanelItem[] = items.map((i) => ({
    id: i.id,
    href: i.href,
    icon: ICON[i.kind.split('.')[0]] ?? APP_ICONS.bell,
    text: sentence(i),
    meta: [showProject ? i.projectName : null, fmt.format(new Date(i.createdAt))].filter(Boolean).join(' · '),
    unread: !i.read,
  }))

  if (!enabled) return { bell: undefined, panel: null }
  const common = { label: t('title'), count, countLabel: t('unread', { count }), onOpen: openPanel, expanded: open, controls: panelId }
  return {
    bell: {
      field: <NotificationBell variant="field" {...common} />,
      rail: <NotificationBell variant="rail" {...common} />,
      icon: <NotificationBell variant="icon" {...common} />,
    },
    panel: (
      <NotificationPanel
        id={panelId}
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        items={panelItems}
        state={state}
        onRetry={() => void load()}
        onItem={(id) => {
          setItems((prev) => prev.map((x) => (x.id === id ? { ...x, read: true } : x)))
          setCount((c) => Math.max(0, c - (items.find((x) => x.id === id && !x.read) ? 1 : 0)))
          void actions.markRead(id)
        }}
        onMarkAll={() => {
          setItems((prev) => prev.map((x) => ({ ...x, read: true })))
          setCount(0)
          void actions.markRead()
        }}
        labels={{ title: t('title'), empty: t('empty'), markAll: t('markAll'), error: t('error'), retry: t('retry'), unread: t('unreadRow') }}
      />
    ),
  }
}
