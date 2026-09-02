'use client'

/**
 * EarlyAccessFooterCta
 *
 * Compact Name + Email form for the footer CTA section.
 *
 * Flow (ADR-018 slice 1 — new submission contract):
 *   1. User types name + email → submit
 *   2. POST /api/forms/{projectSlug}/early-access/submissions → { submissionId, completionToken }
 *   3. Hold { submissionId, completionToken } in component state (in-memory duplicate guard —
 *      replaces the old sessionStorage inquiryId hack)
 *   4. Open modal at step 2 with prefilled name, email, submissionId, and completionToken
 *   5. User completes step 2 → POST …/submissions/{id}/steps (handled by the modal)
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
import { collectClientSource } from '@/lib/forms/source'
import { submissionEndpoint, projectScopeSlugFromUrlSegment } from '@/lib/forms/render-mapping'

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

interface CreatedSubmission {
  submissionId: string
  completionToken: string | null
  name: string
  email: string
}

export function EarlyAccessFooterCta({
  emailPlaceholder,
  buttonLabel,
}: EarlyAccessFooterCtaProps) {
  const { open, locale, tenantSlug } = useEarlyAccess()
  const m = getEarlyAccessMessages(locale)
  const openedAt = useRef(Date.now())
  // In-memory duplicate guard: once this footer has created a partial submission,
  // resubmitting reopens the modal for the SAME submission instead of creating a new one.
  const createdRef = useRef<CreatedSubmission | null>(null)

  // ⚠️ ONE-TO-N BOUNDARY. The submission route is project-scoped, and this
  // component has only the URL segment. (Context also carries a `projectSlug`;
  // it used to be Sanity's separate name — 'livener-main' — and submitting
  // under it would have 404'd. Since `RENAME.md` Step 4 the two agree, but the
  // scope still comes from the URL segment through the one named cast:
  // `projectScopeSlugFromUrlSegment`, which names this dependency explicitly.)
  const scopeSlug = projectScopeSlugFromUrlSegment(tenantSlug)

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
    const existing = createdRef.current
    if (existing) {
      open({
        name:            existing.name,
        email:           existing.email,
        source:          'footer_cta',
        submissionId:    existing.submissionId,
        completionToken: existing.completionToken ?? undefined,
        startAtStep2:    true,
      })
      return
    }

    // ── Create partial submission ──────────────────────────────────────────────
    setSubmitting(true)
    try {
      const res = await fetch(submissionEndpoint(scopeSlug, 'early-access'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale,
          data: { name: trimmedName, email: trimmedEmail },
          source: collectClientSource({ source: 'footer_cta' }),
          openedAt:        openedAt.current,
          company_website: '',   // honeypot — always empty from real users
        }),
      })

      const data = await res.json()

      if (!res.ok || !data.submissionId) {
        setError(m.submitError)
        return
      }

      createdRef.current = {
        submissionId:    data.submissionId,
        completionToken: data.completionToken ?? null,
        name:            trimmedName,
        email:           trimmedEmail,
      }

      open({
        name:            trimmedName,
        email:           trimmedEmail,
        source:          'footer_cta',
        submissionId:    data.submissionId,
        completionToken: data.completionToken ?? undefined,
        startAtStep2:    true,
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
