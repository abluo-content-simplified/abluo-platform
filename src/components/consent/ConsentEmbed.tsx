'use client'

// ─── Click-to-load embed (ADR-021) ───────────────────────────────────────────
//
// Third-party embeds (Google Maps, later YouTube/Vimeo) set their own cookies
// the moment the iframe loads. Until the visitor asks for the content, render a
// design-system placeholder instead — so a site whose only third party is a map
// needs no banner at all. "Always allow" is remembered for 12 months in the
// same per-site consent cookie.

import { useState } from 'react'
import { useConsent } from './ConsentProvider'
import { getConsentMessages } from '@/lib/i18n/consent-messages'

interface ConsentEmbedProps {
  vendorId: string
  /** Proper noun shown to the visitor, e.g. "Google Maps". */
  vendorName: string
  locale: string
  height: number | string
  children: React.ReactNode
}

export function ConsentEmbed({ vendorId, vendorName, locale, height, children }: ConsentEmbedProps) {
  const consent = useConsent()
  const [localLoaded, setLocalLoaded] = useState(false)
  const [always, setAlways] = useState(false)
  const m = getConsentMessages(consent?.locale ?? locale)

  const loaded = localLoaded || consent?.isVendorLoaded(vendorId) === true
  if (loaded) return <>{children}</>

  return (
    <div
      className="flex w-full flex-col items-center justify-center gap-3 p-6 text-center"
      style={{
        minHeight: height,
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        color: 'var(--color-text-secondary)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <p className="max-w-sm text-sm">{m.embedNotice(vendorName)}</p>
      <button
        type="button"
        onClick={() => {
          setLocalLoaded(true)
          consent?.loadVendor(vendorId, always)
        }}
        className="min-h-11 px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-85"
        style={{
          background: 'var(--btn-primary-bg, var(--color-primary))',
          color: 'var(--btn-primary-text, var(--color-background))',
          borderRadius: 'var(--radius-btn, var(--radius-md))',
        }}
      >
        {m.embedLoad}
      </button>
      <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
        {m.embedAlwaysAllow(vendorName)}
      </label>
    </div>
  )
}
