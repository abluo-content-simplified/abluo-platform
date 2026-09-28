'use client'

// Footer "Cookie settings" link (ADR-021) — the permanent withdrawal path.
// Renders nothing when the site uses nothing that needs consent.

import { useConsent } from './ConsentProvider'
import { getConsentMessages } from '@/lib/i18n/consent-messages'

export function CookieSettingsLink({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const consent = useConsent()
  if (!consent?.requiresConsent) return null
  return (
    <button type="button" onClick={consent.openSettings} className={className} style={style}>
      {getConsentMessages(consent.locale).footerLink}
    </button>
  )
}
