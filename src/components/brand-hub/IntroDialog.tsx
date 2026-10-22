'use client'

/**
 * Brand Hub welcome (ADR-036). Opens on a visitor's first page of each visit
 * until they tick "Don't show this again"; closing without the tick shows it
 * again on the next visit. Not shown on the "Using the Brand Hub" page itself.
 *
 * Browser storage only (no login on websites): localStorage for the permanent
 * choice, sessionStorage for "already shown this visit". Every access is
 * guarded — private windows and blocked storage simply show the dialog.
 */

import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { SiteDialog } from '@/components/site/SiteDialog'
import type { BrandHubMessages } from '@/lib/i18n/brand-hub-messages'
import { introDismissKey } from '@/lib/modules/brand-hub/navigation'

function read(storage: () => Storage, key: string): string | null {
  try { return storage().getItem(key) } catch { return null }
}
function write(storage: () => Storage, key: string, value: string) {
  try { storage().setItem(key, value) } catch { /* storage unavailable — nothing to remember */ }
}

export function IntroDialog({ m, basePath, guideHref }: { m: BrandHubMessages; basePath: string; guideHref: string }) {
  const key = introDismissKey(basePath)
  const sessionKey = `${key}:shown-this-visit`
  const checkboxId = useId()
  const [open, setOpen] = useState(false)
  const [dontShow, setDontShow] = useState(false)

  useEffect(() => {
    if (read(() => window.localStorage, key) === '1') return
    if (read(() => window.sessionStorage, sessionKey) === '1') return
    write(() => window.sessionStorage, sessionKey, '1')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is only readable after mount
    setOpen(true)
  }, [key, sessionKey])

  const close = () => {
    if (dontShow) write(() => window.localStorage, key, '1')
    setOpen(false)
  }

  const t = m.introDialog
  return (
    <SiteDialog
      isOpen={open}
      onClose={close}
      closeLabel={t.close}
      title={t.title}
      closeOnBackdrop
      footer={
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <label htmlFor={checkboxId} className="inline-flex cursor-pointer items-center gap-2.5 text-sm" style={{ color: 'var(--color-text-secondary)', fontFamily: 'var(--font-body)' }}>
            <input
              id={checkboxId}
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              className="h-4 w-4 shrink-0 cursor-pointer rounded-none"
              style={{ accentColor: 'var(--color-primary)' }}
            />
            {t.dontShowAgain}
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <button
              type="button"
              onClick={close}
              className="inline-flex h-11 items-center justify-center px-5 text-sm font-medium transition-opacity hover:opacity-80"
              style={{ border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', borderRadius: 'var(--radius-btn)' }}
            >
              {t.close}
            </button>
            <Link
              href={guideHref}
              onClick={close}
              className="inline-flex h-11 items-center justify-center px-5 text-sm font-semibold transition-opacity hover:opacity-90"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', borderRadius: 'var(--radius-btn)' }}
            >
              {t.readGuide}
            </Link>
          </div>
        </div>
      }
    >
      <p className="text-base leading-relaxed" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-body)' }}>
        {t.body}
      </p>
    </SiteDialog>
  )
}
