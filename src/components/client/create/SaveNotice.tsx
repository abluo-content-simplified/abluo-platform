'use client'

import { useTranslations } from 'next-intl'
import type { SaveState } from '@/lib/client/autosave/engine'

const FIELDS = ['title', 'subtitle', 'body', 'categories', 'cta', 'gallery', 'cover', 'wizard', 'description', 'tags', 'items']

/** The human name of a refused patch path (`title.de` → "title"). */
function fieldKey(path: string): string {
  const head = path.split('.')[0]
  return FIELDS.includes(head) ? head : 'other'
}

/**
 * The calm notice line under the wizard's top bar, shown only while saving is
 * NOT succeeding: offline / retrying ("Not saved yet…" + Retry), edited
 * elsewhere or refused ("Couldn't save…" + Reload), or one change the server
 * refused (the rest is saved). Gone as soon as everything is saved. The
 * SavePill stays the one save indicator; this line explains it.
 */
export function SaveNotice({
  state,
  rejected = [],
  onRetry,
  onReload,
}: {
  state: SaveState
  rejected?: string[]
  onRetry?: () => void
  onReload?: () => void
}) {
  const t = useTranslations('clientDashboard.create.saveNotice')

  let text: string | null = null
  let action: { label: string; onPress: () => void } | null = null
  if (state === 'offline') {
    text = t('offline')
    if (onRetry) action = { label: t('retry'), onPress: onRetry }
  } else if (state === 'conflict' || state === 'error') {
    text = t(state)
    if (onReload) action = { label: t('reload'), onPress: onReload }
  } else if (rejected.length) {
    text = t('rejected', { field: t(`fields.${fieldKey(rejected[rejected.length - 1])}`) })
    if (onReload) action = { label: t('reload'), onPress: onReload }
  }
  if (!text) return null

  const alert = state !== 'offline'
  return (
    <div role={alert ? 'alert' : 'status'} aria-live={alert ? 'assertive' : 'polite'} className="w-full bg-muted">
      <div className="mx-auto flex w-full max-w-[672px] flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2">
        <p className="text-[0.9375rem] leading-6 text-foreground">{text}</p>
        {action ? (
          <button
            type="button"
            onClick={action.onPress}
            className="inline-flex min-h-11 items-center rounded-full px-1 text-[0.9375rem] font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {action.label}
          </button>
        ) : null}
      </div>
    </div>
  )
}
