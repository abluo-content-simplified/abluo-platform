'use client'

import { WizardFooter, type WizardFooterProps } from './WizardFooter'
import type { KeyboardEvent, ReactNode, RefObject } from 'react'
import type { SaveState } from '@/lib/client/autosave/engine'
import { WizardHeader } from './WizardHeader'

/**
 * The blog wizard's chrome (WizardShell, v1.0.45) as a frame for the other
 * wizards (gallery, media): the same markup, byte for byte — full-screen
 * Create surface; top bar with "Save & exit" (or a round × while nothing has
 * been saved) and the SavePill; the step column; and the footer with the hint,
 * segmented progress, Back and the primary button (WizardFooter, shared with
 * WizardShell).
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
  footer: null | WizardFooterProps
  /** Dialogs (confirmations) rendered inside the surface, after the footer. */
  overlay?: ReactNode
}) {
  return (
    <div
      data-surface="create"
      onKeyDown={onKeyDown}
      data-portal-root
      className="fixed inset-0 z-[60] flex flex-col bg-background text-foreground"
    >
      <WizardHeader exit={exit} saveState={saveState} rejected={rejected} onRetry={onRetry} onReload={onReload} />

      <div ref={mainRef} className="flex-1 overflow-y-auto">
        <main className={`mx-auto flex min-h-full w-full flex-col px-4 pt-6 pb-10 ${wide ? 'max-w-5xl' : 'max-w-[672px]'}`}>{children}</main>
      </div>

      {footer ? <WizardFooter wide={wide} {...footer} /> : null}

      {overlay}
    </div>
  )
}
