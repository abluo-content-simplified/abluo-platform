'use client'

import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import { useTranslations } from 'next-intl'
import type { SaveState } from '@/lib/client/autosave/engine'
import { SavePill } from '@/components/app/ui/SavePill'
import { Button, IconButton } from '@/components/app/ui/Button'
import { SaveNotice } from '@/components/app/ui/SaveNotice'

/**
 * The blog wizard's chrome (WizardShell, v1.0.45) as a frame for the other
 * wizards (gallery, media): the same markup, byte for byte — full-screen
 * Create surface; top bar with "Save & exit" (or a round × while nothing has
 * been saved) and the SavePill; the step column; and the footer with the hint,
 * segmented progress, Back and the h-14 primary button. WizardShell keeps its
 * own copy of this markup; keep the two identical.
 */
export function WizardFrame({
  children,
  onKeyDown,
  mainRef,
  wide = false,
  exit,
  saveState,
  onReload,
  onRetry,
  rejected,
  footer,
  overlay,
}: {
  children: ReactNode
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void
  mainRef?: RefObject<HTMLDivElement | null>
  /** Wider column (the languages step shows original and translation side by side). */
  wide?: boolean
  /** Top-left: "Save & exit" once something is saved, a round × before that; null on the done screen. */
  exit: { kind: 'save' | 'close'; onPress: () => void } | null
  saveState: SaveState
  onReload: () => void
  /** "Retry" on the not-saved notice (offline / retrying). */
  onRetry?: () => void
  /** Paths the server refused (one change not saved; the rest is). */
  rejected?: string[]
  footer: null | {
    hint?: string | null
    progress?: { current: number; total: number } | null
    back?: { onPress: () => void; disabled?: boolean } | null
    primary: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }
  }
  /** Dialogs (confirmations) rendered inside the surface, after the footer. */
  overlay?: ReactNode
}) {
  const t = useTranslations('clientDashboard.create')
  return (
    <div
      data-surface="create"
      onKeyDown={onKeyDown}
      data-portal-root
      className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground"
    >
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

      <div ref={mainRef} className="flex-1 overflow-y-auto">
        <main className={`mx-auto flex min-h-full w-full flex-col px-4 pt-6 pb-10 ${wide ? 'max-w-5xl' : 'max-w-[672px]'}`}>{children}</main>
      </div>

      {footer ? (
        <footer className="border-t border-border-subtle bg-background pb-[max(12px,env(safe-area-inset-bottom))]">
          <div className={`mx-auto w-full px-4 pt-3 ${wide ? 'max-w-5xl' : 'max-w-[672px]'}`}>
            {footer.hint ? (
              <p role="status" className="mb-3 text-[0.9375rem] leading-6 text-muted-foreground">
                {footer.hint}
              </p>
            ) : null}
            {footer.progress ? (
              <div
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={footer.progress.total}
                aria-valuenow={footer.progress.current}
                aria-label={t('shell.progress', { current: footer.progress.current, total: footer.progress.total })}
                className="flex gap-1.5"
              >
                {Array.from({ length: footer.progress.total }, (_, i) => (
                  <span key={i} className={`h-1 flex-1 rounded-full ${i < footer.progress!.current ? 'bg-foreground' : 'bg-muted'}`} />
                ))}
              </div>
            ) : null}
            <div className={`flex items-center justify-between gap-4 ${footer.progress ? 'mt-3' : ''}`}>
              {footer.back ? (
                <Button variant="link" onClick={footer.back.onPress} disabled={footer.back.disabled}>
                  {t('shell.back')}
                </Button>
              ) : (
                <span />
              )}
              <Button variant="primary" size="lg" className="min-w-32" onClick={footer.primary.onPress} disabled={footer.primary.disabled} aria-busy={footer.primary.busy || undefined}>
                {footer.primary.label}
              </Button>
            </div>
          </div>
        </footer>
      ) : null}

      {overlay}
    </div>
  )
}
