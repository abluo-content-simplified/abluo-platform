'use client'

import { useTranslations } from 'next-intl'
import type { SaveState } from '@/lib/client/autosave/engine'

/**
 * The one save indicator (ADR-025 D2): Saving… / Saved ✓ / Offline — saved on
 * this device / Edited elsewhere (+ Reload). There is never a Save button.
 */
export function SavePill({ state, onReload }: { state: SaveState; onReload?: () => void }) {
  const t = useTranslations('clientDashboard.create.save')
  if (state === 'idle') return <span aria-live="polite" className="min-h-11" />

  const label =
    state === 'saving'
      ? t('saving')
      : state === 'saved'
        ? t('saved')
        : state === 'offline'
          ? t('offline')
          : state === 'conflict'
            ? t('conflict')
            : t('error')
  const tone = state === 'conflict' || state === 'error' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground'

  return (
    <span role="status" aria-live="polite" className="flex items-center gap-2">
      <span className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium ${tone}`} data-save-state={state}>
        {state === 'saved' ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-success">
            <path d="m5 12 5 5L20 7" />
          </svg>
        ) : state === 'saving' ? (
          <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-current motion-reduce:animate-none" />
        ) : null}
        {label}
      </span>
      {(state === 'conflict' || state === 'error') && onReload ? (
        <button
          type="button"
          onClick={onReload}
          className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t('reload')}
        </button>
      ) : null}
    </span>
  )
}
