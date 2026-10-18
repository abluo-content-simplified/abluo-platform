'use client'

import { useTranslations } from 'next-intl'
import type { SaveState } from '@/lib/client/autosave/engine'
import { SavePill } from '@/components/app/ui/SavePill'
import { Button, IconButton } from '@/components/app/ui/Button'
import { SaveNotice } from '@/components/app/ui/SaveNotice'

/**
 * The top bar of the full-screen wizards (WizardShell and WizardFrame):
 * "Save & exit" once something is saved, a round × before that, nothing on the
 * done screen — and the SavePill, with the not-saved notice under it.
 */
export function WizardHeader({
  exit,
  saveState,
  rejected,
  onRetry,
  onReload,
}: {
  /** Top-left: "Save & exit" once something is saved, a round × before that; null on the done screen. */
  exit: { kind: 'save' | 'close'; onPress: () => void } | null
  saveState: SaveState
  /** Paths the server refused (one change not saved; the rest is). */
  rejected?: string[]
  /** "Retry" on the not-saved notice (offline / retrying). */
  onRetry?: () => void
  onReload: () => void
}) {
  const t = useTranslations('clientDashboard.create')
  return (
    <>
      <header className="mx-auto flex w-full max-w-[672px] items-center justify-between gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2">
        {exit && exit.kind === 'close' ? (
          <IconButton onClick={exit.onPress} aria-label={t('shell.close')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </IconButton>
        ) : exit ? (
          <Button onClick={exit.onPress}>{t('shell.saveExit')}</Button>
        ) : (
          <span />
        )}
        <SavePill state={saveState} onReload={onReload} />
      </header>
      <SaveNotice state={saveState} rejected={rejected} onRetry={onRetry} onReload={onReload} />
    </>
  )
}
