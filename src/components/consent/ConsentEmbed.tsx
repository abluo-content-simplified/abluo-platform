'use client'

// ─── Click-to-load embed (ADR-021) ───────────────────────────────────────────
//
// Third-party embeds (Google Maps, YouTube, Vimeo, Cloudflare Stream, any
// iframe host) set their own cookies the moment the iframe loads. The embed
// renders when the visitor accepted the banner's External content category
// (and this vendor is listed under it) or always-allowed this vendor;
// otherwise a design-system placeholder renders instead, with "load once" and
// "Always allow" (remembered 12 months in the same per-site consent cookie).
// Every third-party iframe on a website goes through this component.

import { useId, useState } from 'react'
import { useConsent } from './ConsentProvider'
import { getConsentMessages } from '@/lib/i18n/consent-messages'

interface ConsentEmbedProps {
  vendorId: string
  /** Proper noun shown to the visitor, e.g. "Google Maps". */
  vendorName: string
  locale: string
  /** Placeholder height. Ignored when `aspectRatio` is set. */
  height?: number | string
  /** Placeholder aspect ratio instead of a fixed height, e.g. "4 / 3". */
  aspectRatio?: string
  /**
   * Section-specific copy (already localized by the caller's dictionary).
   * Each falls back to the generic consent-messages text when omitted.
   */
  labels?: { notice?: string; load?: string; alwaysAllow?: string }
  children: React.ReactNode
}

export function ConsentEmbed({ vendorId, vendorName, locale, height, aspectRatio, labels, children }: ConsentEmbedProps) {
  const noticeId = useId()
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
        ...(aspectRatio ? { aspectRatio } : { minHeight: height }),
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        color: 'var(--color-text-secondary)',
        fontFamily: 'var(--font-body)',
      }}
    >
      <p id={noticeId} className="max-w-sm text-sm">{labels?.notice ?? m.embedNotice(vendorName)}</p>
      <button
        type="button"
        aria-describedby={noticeId}
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
        {labels?.load ?? m.embedLoad}
      </button>
      <label className="flex cursor-pointer items-center gap-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
        <input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
        {labels?.alwaysAllow ?? m.embedAlwaysAllow(vendorName)}
      </label>
    </div>
  )
}
