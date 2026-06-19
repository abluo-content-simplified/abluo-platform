'use client'

/**
 * EarlyAccessFooterCta
 *
 * Compact Name + Email form for the footer CTA section.
 *
 * Flow:
 *   1. User types name + email → submit
 *   2. POST /api/inquiries (partial: true) → get inquiryId
 *   3. Store inquiryId in sessionStorage (duplicate guard)
 *   4. Open modal at step 2 with prefilled name, email, and inquiryId
 *   5. User completes step 2 → PATCH /api/inquiries/[id]
 *
 * LOCALIZATION: all user-facing text is resolved via getEarlyAccessMessages(locale).
 * No English literals appear in this component. Locale is read from EarlyAccessContext.
 *
 * @param emailPlaceholder — optional Sanity override for the email input placeholder
 * @param buttonLabel — optional Sanity override for the submit button label
 */

import { useState, useRef, FormEvent } from 'react'
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

const SESSION_KEY       = 'earlyAccessInquiryId'
const SESSION_NAME_KEY  = 'earlyAccessName'
const SESSION_EMAIL_KEY = 'earlyAccessEmail'

export function EarlyAccessFooterCta({
  emailPlaceholder,
  buttonLabel,
}: EarlyAccessFooterCtaProps) {
  const { open, locale, tenantSlug } = useEarlyAccess()
  const m = getEarlyAccessMessages(locale)
  const openedAt = useRef(Date.now())

  const [name, setName]             = useState('')
  const [email, setEmail]           = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]           = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const trimmedName  = name.trim()
    const trimmedEmail = email.trim()

    if (!trimmedName) { setError(m.nameRequiredError); return }
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError(m.emailInvalidError)
      return
    }

    // ── Duplicate guard ────────────────────────────────────────────────────────
    const existingId = typeof window !== 'undefined'
      ? sessionStorage.getItem(SESSION_KEY)
      : null

    if (existingId) {
      open({
        name:         sessionStorage.getItem(SESSION_NAME_KEY)  ?? trimmedName,
        email:        sessionStorage.getItem(SESSION_EMAIL_KEY) ?? trimmedEmail,
        source:       'footer_cta',
        inquiryId:    existingId,
        startAtStep2: true,
      })
      return
    }

    // ── Create partial inquiry ─────────────────────────────────────────────────
    setSubmitting(true)
    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:            trimmedName,
          email:           trimmedEmail,
          source:          'footer_cta',
          tenantSlug,
          partial:         true,
          openedAt:        openedAt.current,
          company_website: '',   // honeypot — always empty from real users
          inquiryType:     'early_access',
        }),
      })

      const data = await res.json()

      if (data.id) {
        sessionStorage.setItem(SESSION_KEY,       data.id)
        sessionStorage.setItem(SESSION_NAME_KEY,  trimmedName)
        sessionStorage.setItem(SESSION_EMAIL_KEY, trimmedEmail)
      }

      open({
        name:         trimmedName,
        email:        trimmedEmail,
        source:       'footer_cta',
        inquiryId:    data.id ?? undefined,
        startAtStep2: true,
      })
    } catch {
      setError(m.submitError)
    } finally {
      setSubmitting(false)
    }
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
          className="flex-1 rounded-xl px-4 py-3 text-sm transition-colors focus:outline-none"
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
          className="flex-1 rounded-xl px-4 py-3 text-sm transition-colors focus:outline-none"
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
          className="rounded-xl px-6 py-3 text-sm font-semibold transition-colors"
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
