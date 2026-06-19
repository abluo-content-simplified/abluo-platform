'use client'

/**
 * EarlyAccessModal
 *
 * Two-step Early Access request flow.
 *
 * Step 1 — Contact (name + email)
 *   POST /api/inquiries → partial record → get inquiryId → advance to step 2
 *
 * Step 2 — Qualification (org, role, use cases, GDPR, etc.)
 *   PATCH /api/inquiries/[id] → complete record → show success state
 *
 * When opened from footer CTA, step 1 is already done (partial record
 * created, name + email prefilled) → startAtStep2=true skips to step 2.
 *
 * LOCALIZATION: all user-facing text is resolved via getEarlyAccessMessages(locale).
 * No English literals appear in this component.
 */

import { useState, useEffect, useRef, useId } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { FormField } from '@/components/fields'
import type { FieldConfig } from '@/components/fields'
import { validateField } from '@/components/fields'
import { useEarlyAccess } from './EarlyAccessContext'
import { getEarlyAccessMessages } from '@/lib/forms/early-access-config'
import type { EarlyAccessMessages } from '@/lib/forms/early-access-config'

// ─── Field config builders ────────────────────────────────────────────────────
// Built from messages so labels, placeholders, and options are locale-aware.

function buildStep1Fields(m: EarlyAccessMessages): FieldConfig[] {
  return [
    {
      id: 'name',
      type: 'text',
      label: m.nameLabel,
      placeholder: m.namePlaceholder,
      required: true,
      width: '100%',
    },
    {
      id: 'email',
      type: 'email',
      label: m.emailLabel,
      placeholder: m.emailPlaceholder,
      required: true,
      width: '100%',
    },
  ]
}

function buildStep2Fields(m: EarlyAccessMessages): FieldConfig[] {
  return [
    {
      id: 'organization',
      type: 'text',
      label: m.organizationLabel,
      placeholder: m.organizationPlaceholder,
      required: true,
      width: '100%',
    },
    {
      id: 'role',
      type: 'text',
      label: m.roleLabel,
      placeholder: m.rolePlaceholder,
      required: true,
      width: '100%',
    },
    {
      id: 'website',
      type: 'url',
      label: m.websiteLabel,
      placeholder: m.websitePlaceholder,
      required: false,
      width: '100%',
    },
    {
      id: 'country',
      type: 'country-select',
      label: m.countryLabel,
      required: true,
      width: '100%',
      prioritize: ['IT', 'GB', 'DE', 'FR', 'ES', 'NL', 'PT', 'CH', 'BE', 'AT'],
    },
    {
      id: 'orgType',
      type: 'select',
      label: m.orgTypeLabel,
      required: true,
      width: '100%',
      placeholder: m.orgTypePlaceholder,
      options: m.orgTypeOptions,
    },
    {
      id: 'useCases',
      type: 'multi-select',
      label: m.useCasesLabel,
      required: false,
      width: '100%',
      options: m.useCaseOptions,
      helpText: m.useCasesHelpText,
    },
    {
      id: 'referralSource',
      type: 'select',
      label: m.referralSourceLabel,
      required: false,
      width: '100%',
      placeholder: m.referralSourcePlaceholder,
      options: m.referralOptions,
    },
    {
      id: 'message',
      type: 'textarea',
      label: m.messageLabel,
      placeholder: m.messagePlaceholder,
      required: false,
      width: '100%',
      rows: 3,
    },
    {
      id: 'gdprConsent',
      type: 'checkbox',
      label: m.gdprFieldLabel,
      checkboxLabel: m.gdprConsentText,
      required: true,
      width: '100%',
    },
  ]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type FormValues = Record<string, unknown>

function getInitialStep2Values(): FormValues {
  return {
    organization: '', role: '', website: '',
    country: '', orgType: '', useCases: [],
    referralSource: '', message: '', gdprConsent: false,
  }
}

function validateStep(fields: FieldConfig[], values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const result = validateField(field, values[field.id])
    if (!result.valid && result.error) {
      errors[field.id] = result.error
    }
  }
  return errors
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EarlyAccessModal() {
  const { isOpen, options, tenantSlug, locale, close } = useEarlyAccess()
  const m = getEarlyAccessMessages(locale)
  const formStartedAt = useRef<number>(Date.now())
  const dialogId = useId()

  const step1Fields = buildStep1Fields(m)
  const step2Fields = buildStep2Fields(m)

  const [step, setStep]               = useState<1 | 2>(1)
  const [inquiryId, setInquiryId]     = useState<string | null>(null)
  const [step1Values, setStep1Values] = useState<FormValues>({ name: '', email: '' })
  const [step2Values, setStep2Values] = useState<FormValues>(getInitialStep2Values())
  const [errors, setErrors]           = useState<Record<string, string>>({})
  const [submitting, setSubmitting]   = useState(false)
  const [success, setSuccess]         = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // ── Reset and prefill when modal opens ──────────────────────────────────────
  useEffect(() => {
    if (isOpen && options) {
      formStartedAt.current = Date.now()
      setErrors({})
      setSubmitting(false)
      setSuccess(false)
      setSubmitError(null)

      if (options.startAtStep2 && options.inquiryId) {
        setStep(2)
        setInquiryId(options.inquiryId)
        setStep1Values({ name: options.name ?? '', email: options.email ?? '' })
        setStep2Values(getInitialStep2Values())
      } else {
        setStep(1)
        setInquiryId(options.inquiryId ?? null)
        setStep1Values({ name: options.name ?? '', email: options.email ?? '' })
        setStep2Values(getInitialStep2Values())
      }
    }
  }, [isOpen, options])

  // ── Keyboard close ───────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    if (isOpen) window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, close])

  // ── Body scroll lock ─────────────────────────────────────────────────────────
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  // ── Step 1 submit ────────────────────────────────────────────────────────────
  async function handleStep1Submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    const errs = validateStep(step1Fields, step1Values)
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSubmitting(true)
    try {
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:            step1Values.name,
          email:           step1Values.email,
          source:          options?.source ?? 'header_cta',
          tenantSlug,
          partial:         true,
          openedAt:        formStartedAt.current,
          company_website: '',   // honeypot — always empty from real users
          inquiryType:     'early_access',
        }),
      })
      const data = await res.json()
      if (data.id) setInquiryId(data.id)
      setStep(2)
      setErrors({})
    } catch {
      setSubmitError(m.submitError)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Step 2 submit ────────────────────────────────────────────────────────────
  async function handleStep2Submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)
    const errs = validateStep(step2Fields, step2Values)
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSubmitting(true)
    try {
      if (inquiryId) {
        await fetch(`/api/inquiries/${inquiryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...step2Values, partial: false }),
        })
      } else {
        // Fallback: create a full record in one shot
        const res = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name:            step1Values.name,
            email:           step1Values.email,
            source:          options?.source ?? 'header_cta',
            tenantSlug,
            partial:         false,
            openedAt:        formStartedAt.current,
            company_website: '',
            inquiryType:     'early_access',
            ...step2Values,
          }),
        })
        const data = await res.json()
        if (data.id) setInquiryId(data.id)
      }

      // Clear sessionStorage duplicate guard
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem('earlyAccessInquiryId')
      }

      setSuccess(true)
      setErrors({})
    } catch {
      setSubmitError(m.submitError)
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[500] bg-black/60 backdrop-blur-sm"
            onClick={close}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-title`}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
            className="fixed inset-x-4 top-[50%] z-[510] mx-auto max-w-lg -translate-y-1/2 overflow-hidden rounded-2xl shadow-2xl md:inset-x-auto md:left-1/2 md:-translate-x-1/2"
            style={{
              backgroundColor: 'var(--color-background)',
              border: '1px solid var(--color-border)',
              maxHeight: 'calc(100dvh - 2rem)',
              overflowY: 'auto',
            }}
          >
            {/* Header */}
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-6 pt-6 pb-4"
              style={{ backgroundColor: 'var(--color-background)' }}
            >
              <div>
                <p
                  className="text-xs font-semibold uppercase tracking-widest mb-1"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {m.modalTitle}
                </p>
                {!success && (
                  <div className="flex items-center gap-1.5">
                    {[1, 2].map((s) => (
                      <div
                        key={s}
                        className="h-1 rounded-full transition-all duration-300"
                        style={{
                          width: step === s ? '24px' : '8px',
                          backgroundColor: step >= s
                            ? 'var(--color-primary)'
                            : 'var(--color-border)',
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={close}
                aria-label={m.closeLabel}
                className="flex h-8 w-8 items-center justify-center rounded-full transition-colors"
                style={{ color: 'var(--color-text-muted)' }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="px-6 pb-8">

              {/* Title + subtitle */}
              <h2
                id={`${dialogId}-title`}
                className="mb-2 text-xl font-semibold"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
              >
                {success ? m.successTitle : step === 1 ? m.step1Title : m.step2Title}
              </h2>
              <p className="mb-6 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {success
                  ? m.successBody(String(step1Values.name ?? ''))
                  : step === 1
                    ? m.step1Subtitle
                    : m.step2Subtitle}
              </p>

              {/* ── Success state ──────────────────────────────────── */}
              {success && (
                <div className="flex justify-end pt-2">
                  <button
                    onClick={close}
                    className="rounded-xl px-6 py-2.5 text-sm font-semibold"
                    style={{ backgroundColor: 'var(--color-primary)', color: '#fff', border: 'none', cursor: 'pointer' }}
                  >
                    {m.successCloseLabel}
                  </button>
                </div>
              )}

              {/* ── Step 1 ────────────────────────────────────────── */}
              {!success && step === 1 && (
                <form onSubmit={handleStep1Submit} noValidate>
                  {/* Honeypot — real input, CSS-hidden. Do NOT use type=hidden. */}
                  <input
                    type="text"
                    name="company_website"
                    autoComplete="off"
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{ position: 'absolute', opacity: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
                  />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--form-field-gap)' }}>
                    {step1Fields.map((field) => (
                      <FormField
                        key={field.id}
                        config={field}
                        value={step1Values[field.id] ?? ''}
                        onChange={(v) => setStep1Values((prev) => ({ ...prev, [field.id]: v }))}
                        error={errors[field.id]}
                      />
                    ))}
                  </div>

                  {submitError && (
                    <p className="mt-3 text-sm" role="alert" style={{ color: 'var(--color-danger)' }}>
                      {submitError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="mt-6 w-full rounded-xl py-3 text-sm font-semibold"
                    style={{
                      backgroundColor: 'var(--color-primary)',
                      color: '#fff',
                      opacity: submitting ? 0.7 : 1,
                      cursor: submitting ? 'not-allowed' : 'pointer',
                      border: 'none',
                    }}
                  >
                    {submitting ? m.submittingLabel : m.step1SubmitLabel}
                  </button>
                </form>
              )}

              {/* ── Step 2 ────────────────────────────────────────── */}
              {!success && step === 2 && (
                <form onSubmit={handleStep2Submit} noValidate>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--form-field-gap)' }}>
                    {step2Fields.map((field) => (
                      <FormField
                        key={field.id}
                        config={field}
                        value={step2Values[field.id] ?? (
                          field.type === 'multi-select' ? [] :
                          field.type === 'checkbox' ? false : ''
                        )}
                        onChange={(v) => setStep2Values((prev) => ({ ...prev, [field.id]: v }))}
                        error={errors[field.id]}
                      />
                    ))}
                  </div>

                  {submitError && (
                    <p className="mt-3 text-sm" role="alert" style={{ color: 'var(--color-danger)' }}>
                      {submitError}
                    </p>
                  )}

                  <div className="mt-6 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => { setStep(1); setErrors({}); setSubmitError(null) }}
                      className="rounded-xl px-5 py-3 text-sm font-medium"
                      style={{
                        backgroundColor: 'transparent',
                        border: '1px solid var(--color-border)',
                        color: 'var(--color-text-secondary)',
                        cursor: 'pointer',
                      }}
                    >
                      {m.backLabel}
                    </button>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="flex-1 rounded-xl py-3 text-sm font-semibold"
                      style={{
                        backgroundColor: 'var(--color-primary)',
                        color: '#fff',
                        opacity: submitting ? 0.7 : 1,
                        cursor: submitting ? 'not-allowed' : 'pointer',
                        border: 'none',
                      }}
                    >
                      {submitting ? m.submittingLabel : m.step2SubmitLabel}
                    </button>
                  </div>
                </form>
              )}

            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
