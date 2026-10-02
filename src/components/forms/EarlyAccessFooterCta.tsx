'use client'

/**
 * EarlyAccessFooterCta
 *
 * Compact Name + Email form for the footer CTA section.
 *
 * Flow (consent-first, ADR-018 amendment 2026-10):
 *   1. User types name + email → submit (validated locally; nothing is sent)
 *   2. The Early Access modal opens at step 1 with both pre-filled, where the
 *      GDPR consent checkbox is; the modal POSTs name + email + consent together.
 *
 * LOCALIZATION: all user-facing text is resolved via getEarlyAccessMessages(locale).
 * No English literals appear in this component. Locale is read from EarlyAccessContext.
 *
 * @param emailPlaceholder — optional Sanity override for the email input placeholder
 * @param buttonLabel — optional Sanity override for the submit button label
 */

import { useState, FormEvent } from 'react'
import { useEarlyAccess } from './EarlyAccessContext'
import { getEarlyAccessMessages } from '@/lib/forms/early-access-config'

interface EarlyAccessFooterCtaProps {
  /**
   * Optional override for the email placeholder from Sanity siteConfig.
   * Falls back to the localised default from messages.
   */
  emailPlaceholder?: string
  /**
   * Optional override for the CTA button label from Sanity siteConfig.
   * Falls back to the localised default from messages.
   */
  buttonLabel?: string
}

export function EarlyAccessFooterCta({
  emailPlaceholder,
  buttonLabel,
}: EarlyAccessFooterCtaProps) {
  const { open, locale } = useEarlyAccess()
  const m = getEarlyAccessMessages(locale)

  const [name, setName]   = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Nothing is sent from here any more, so the button never waits.
  const submitting = false

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedName  = name.trim()
    const trimmedEmail = email.trim()

    if (!trimmedName) { setError(m.nameRequiredError); return }
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(m.emailInvalidError)
      return
    }

    // Consent-first (ADR-018 amendment): the footer no longer creates the
    // partial submission itself — that stored name + email before the visitor
    // had agreed to anything. It hands both to the modal's step 1, where the
    // consent checkbox is, and the modal sends them together with consent.
    open({
      name:   trimmedName,
      email:  trimmedEmail,
      source: 'footer_cta',
    })
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {/* Honeypot — real input, CSS-hidden. Do NOT use type=hidden. */}
      <input
        type="text"
        name="company_website"
        autoComplete="off"
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: 'absolute', opacity: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={m.footerNamePlaceholder}
          required
          disabled={submitting}
          aria-label={m.nameLabel}
          className="flex-1 rounded-[var(--form-border-radius)] px-4 py-3 text-sm transition-colors focus:outline-none"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-body)',
          }}
        />

        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={emailPlaceholder ?? m.footerEmailPlaceholder}
          required
          disabled={submitting}
          aria-label={m.emailLabel}
          className="flex-1 rounded-[var(--form-border-radius)] px-4 py-3 text-sm transition-colors focus:outline-none"
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            color: 'var(--color-text-primary)',
            fontFamily: 'var(--font-body)',
          }}
        />

        <button
          type="submit"
          disabled={submitting}
          className="rounded-[var(--radius-btn)] px-6 py-3 text-sm font-semibold transition-colors"
          style={{
            backgroundColor: 'var(--color-primary)',
            color: '#fff',
            border: 'none',
            cursor: submitting ? 'not-allowed' : 'pointer',
            opacity: submitting ? 0.7 : 1,
            fontFamily: 'var(--font-body)',
            whiteSpace: 'nowrap',
          }}
        >
          {submitting ? m.submittingLabel : (buttonLabel ?? m.footerCtaLabel)}
        </button>
      </div>

      {error && (
        <p
          className="mt-2 text-xs"
          role="alert"
          style={{ color: 'var(--color-danger, #ef4444)' }}
        >
          {error}
        </p>
      )}
    </form>
  )
}
