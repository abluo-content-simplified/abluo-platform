'use client'

/**
 * EarlyAccessModal
 *
 * Three-step Early Access request flow.
 *
 * Step 1 — Contact (name + email)
 *   POST /api/inquiries → partial record → get inquiryId → advance to step 2
 *
 * Step 2 — Organisation (name, role cards, org type)
 *   Data collected locally → advance to step 3
 *
 * Step 3 — Streaming Needs (use cases chips, audience size, website, referral, GDPR)
 *   PATCH /api/inquiries/[id] with all step 2+3 data → show success state
 *
 * When opened from footer CTA with startAtStep2=true, step 1 is already
 * recorded and we jump straight to step 2.
 *
 * LOCALIZATION: all user-facing text comes from getEarlyAccessMessages(locale).
 * No English literals appear in this component.
 */

import { useState, useEffect, useRef, useId } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X, Check, ChevronDown } from 'lucide-react'
import { FormField } from '@/components/fields'
import type { FieldConfig } from '@/components/fields'
import { validateField } from '@/components/fields'
import { useEarlyAccess } from './EarlyAccessContext'
import { getEarlyAccessMessages } from '@/lib/forms/early-access-config'
import type { EarlyAccessMessages, EarlyAccessOptionItem } from '@/lib/forms/early-access-config'

// ─── Custom primitives ────────────────────────────────────────────────────────

/** Card-grid single-select (replaces free-text role input). */
function RoleCards({
  options,
  value,
  onChange,
  label,
  error,
  required,
}: {
  options: EarlyAccessOptionItem[]
  value: string
  onChange: (v: string) => void
  label: string
  error?: string
  required?: boolean
}) {
  return (
    <div>
      <p
        className="mb-2 text-sm font-medium"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {label}
        {required && (
          <span style={{ color: 'var(--color-danger)', marginLeft: '3px' }} aria-hidden="true">*</span>
        )}
      </p>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '8px',
        }}
      >
        {options.map((opt) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className="rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all"
              style={{
                borderColor: active
                  ? 'var(--color-primary)'
                  : error
                    ? 'var(--form-input-error-border)'
                    : 'var(--color-border)',
                backgroundColor: active
                  ? 'color-mix(in oklch, var(--color-primary) 8%, transparent)'
                  : 'var(--form-input-bg)',
                color: active ? 'var(--color-primary)' : 'var(--color-text-primary)',
                cursor: 'pointer',
                lineHeight: '1.3',
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
      {error && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--color-danger)' }} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

/** Chip-grid multi-select (use cases). */
function ChipGrid({
  options,
  value,
  onChange,
  label,
  helpText,
}: {
  options: EarlyAccessOptionItem[]
  value: string[]
  onChange: (v: string[]) => void
  label: string
  helpText?: string
}) {
  const toggle = (v: string) => {
    if (value.includes(v)) onChange(value.filter((x) => x !== v))
    else onChange([...value, v])
  }

  return (
    <div>
      <p
        className="mb-1 text-sm font-medium"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {label}
      </p>
      {helpText && (
        <p className="mb-2.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {helpText}
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {options.map((opt) => {
          const active = value.includes(opt.value)
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-all"
              style={{
                borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                backgroundColor: active
                  ? 'color-mix(in oklch, var(--color-primary) 10%, transparent)'
                  : 'transparent',
                color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                cursor: 'pointer',
              }}
            >
              {active && <Check size={12} strokeWidth={2.5} />}
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Custom dropdown — replaces native <select>. Works in dark mode. */
function CustomSelect({
  options,
  value,
  onChange,
  label,
  placeholder,
  error,
  required,
}: {
  options: EarlyAccessOptionItem[]
  value: string
  onChange: (v: string) => void
  label: string
  placeholder: string
  error?: string
  required?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref}>
      <p
        className="mb-2 text-sm font-medium"
        style={{ color: 'var(--color-text-primary)' }}
      >
        {label}
        {required && (
          <span style={{ color: 'var(--color-danger)', marginLeft: '3px' }} aria-hidden="true">*</span>
        )}
      </p>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-sm transition-all"
          style={{
            borderColor: error
              ? 'var(--form-input-error-border)'
              : open
                ? 'var(--color-primary)'
                : 'var(--color-border)',
            backgroundColor: 'var(--form-input-bg)',
            color: selected ? 'var(--color-text-primary)' : 'var(--color-text-muted)',
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span>{selected ? selected.label : placeholder}</span>
          <ChevronDown
            size={14}
            className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
            style={{ color: 'var(--color-text-muted)' }}
          />
        </button>

        <AnimatePresence>
          {open && (
            <motion.ul
              role="listbox"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
              className="absolute left-0 right-0 z-[600] mt-1 max-h-56 overflow-y-auto rounded-xl border py-1 shadow-lg"
              style={{
                backgroundColor: 'var(--color-background-alt)',
                borderColor: 'var(--color-border)',
              }}
            >
              {options.map((opt) => {
                const isSelected = opt.value === value
                return (
                  <li
                    key={opt.value}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => { onChange(opt.value); setOpen(false) }}
                    className="flex cursor-pointer items-center gap-2 px-4 py-2 text-sm transition-colors"
                    style={{
                      color: isSelected ? 'var(--color-primary)' : 'var(--color-text-primary)',
                      backgroundColor: isSelected
                        ? 'color-mix(in oklch, var(--color-primary) 8%, transparent)'
                        : 'transparent',
                      fontWeight: isSelected ? 600 : 400,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected)
                        (e.currentTarget as HTMLElement).style.backgroundColor =
                          'color-mix(in oklch, var(--color-text-primary) 5%, transparent)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected)
                        (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                    }}
                  >
                    {isSelected && <Check size={13} strokeWidth={2.5} />}
                    {!isSelected && <span style={{ width: 13 }} />}
                    {opt.label}
                  </li>
                )
              })}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
      {error && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--color-danger)' }} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Field config builders ────────────────────────────────────────────────────

function buildStep1Fields(m: EarlyAccessMessages): FieldConfig[] {
  return [
    { id: 'name',  type: 'text',  label: m.nameLabel,  placeholder: m.namePlaceholder,  required: true, width: '100%' },
    { id: 'email', type: 'email', label: m.emailLabel, placeholder: m.emailPlaceholder, required: true, width: '100%' },
  ]
}

function buildStep3TextFields(m: EarlyAccessMessages): FieldConfig[] {
  return [
    {
      id: 'website',
      type: 'url',
      label: m.websiteLabel,
      placeholder: m.websitePlaceholder,
      required: false,
      width: '100%',
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
  return { organization: '', role: '', orgType: '' }
}

function getInitialStep3Values(): FormValues {
  return { useCases: [], audienceSize: '', website: '', referralSource: '', gdprConsent: false }
}

function validateStep(fields: FieldConfig[], values: FormValues): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const result = validateField(field, values[field.id])
    if (!result.valid && result.error) errors[field.id] = result.error
  }
  return errors
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EarlyAccessModal() {
  const { isOpen, options, tenantSlug, projectSlug, locale, close } = useEarlyAccess()
  const m = getEarlyAccessMessages(locale)
  const formStartedAt = useRef<number>(Date.now())
  const dialogId = useId()

  const step1Fields = buildStep1Fields(m)
  const step3TextFields = buildStep3TextFields(m)

  const [step, setStep]               = useState<1 | 2 | 3>(1)
  const [inquiryId, setInquiryId]     = useState<string | null>(null)
  const [step1Values, setStep1Values] = useState<FormValues>({ name: '', email: '' })
  const [step2Values, setStep2Values] = useState<FormValues>(getInitialStep2Values())
  const [step3Values, setStep3Values] = useState<FormValues>(getInitialStep3Values())
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
        setStep3Values(getInitialStep3Values())
      } else {
        setStep(1)
        setInquiryId(options.inquiryId ?? null)
        setStep1Values({ name: options.name ?? '', email: options.email ?? '' })
        setStep2Values(getInitialStep2Values())
        setStep3Values(getInitialStep3Values())
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
      const payload = {
        name:            step1Values.name,
        email:           step1Values.email,
        source:          options?.source ?? 'header_cta',
        tenantSlug,
        projectSlug,
        partial:         true,
        openedAt:        formStartedAt.current,
        company_website: '',
        inquiryType:     'early_access',
      }
      const res = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) {
        setSubmitError(m.submitError)
        return
      }
      if (data.id) setInquiryId(data.id)
      setStep(2)
      setErrors({})
    } catch (err) {
      console.error('[EarlyAccessModal] step1 fetch error:', err)
      setSubmitError(m.submitError)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Step 2 advance ───────────────────────────────────────────────────────────
  function handleStep2Next(e: React.FormEvent) {
    e.preventDefault()
    const errs: Record<string, string> = {}
    if (!String(step2Values.organization ?? '').trim()) {
      errs.organization = m.nameRequiredError
    }
    if (!step2Values.role) errs.role = m.roleRequiredError
    if (!step2Values.orgType) errs.orgType = m.orgTypeRequiredError
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    setStep(3)
  }

  // ── Step 3 submit ────────────────────────────────────────────────────────────
  async function handleStep3Submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitError(null)

    const errs = validateStep(step3TextFields, step3Values)
    if (Object.keys(errs).length) { setErrors(errs); return }

    setSubmitting(true)
    try {
      const qualificationData = { ...step2Values, ...step3Values }

      if (inquiryId) {
        const patchPayload = { ...qualificationData, partial: false }
        const res = await fetch(`/api/inquiries/${inquiryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patchPayload),
        })
        const data = await res.json()
        if (!res.ok) {
          setSubmitError(m.submitError)
          return
        }
      } else {
        const postPayload = {
          name:            step1Values.name,
          email:           step1Values.email,
          source:          options?.source ?? 'header_cta',
          tenantSlug,
          projectSlug,
          partial:         false,
          openedAt:        formStartedAt.current,
          company_website: '',
          inquiryType:     'early_access',
          ...qualificationData,
        }
        const res = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(postPayload),
        })
        const data = await res.json()
        if (!res.ok) {
          setSubmitError(m.submitError)
          return
        }
        if (data.id) setInquiryId(data.id)
      }

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

  // ─── Step metadata ────────────────────────────────────────────────────────────

  const STEP_NAMES = [m.step1Name, m.step2Name, m.step3Name]
  const STEP_TITLES = [m.step1Title, m.step2Title, m.step3Title]
  const STEP_SUBTITLES = [m.step1Subtitle, m.step2Subtitle, m.step3Subtitle]

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
            {/* ── Header ───────────────────────────────────────────── */}
            <div
              className="sticky top-0 z-10 flex items-center justify-between px-6 pt-6 pb-4"
              style={{ backgroundColor: 'var(--color-background)' }}
            >
              <div className="flex flex-col gap-2">
                {/* Modal title (primary accent) */}
                <p
                  className="text-xs font-semibold uppercase tracking-widest"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {m.modalTitle}
                </p>

                {/* Progress indicator */}
                {!success && (
                  <div className="flex items-center gap-2">
                    {/* Step dots */}
                    <div className="flex items-center gap-1">
                      {[1, 2, 3].map((s) => (
                        <div
                          key={s}
                          className="rounded-full transition-all duration-300"
                          style={{
                            height: '6px',
                            width: step === s ? '20px' : '6px',
                            backgroundColor:
                              step > s
                                ? 'var(--color-primary)'
                                : step === s
                                  ? 'var(--color-primary)'
                                  : 'var(--color-border)',
                            opacity: step > s ? 0.4 : 1,
                          }}
                        />
                      ))}
                    </div>
                    {/* "Step X of 3 — Name" */}
                    <span
                      className="text-xs"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {m.stepOfLabel(step, 3)} — {STEP_NAMES[step - 1]}
                    </span>
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

            {/* ── Body ─────────────────────────────────────────────── */}
            <div className="px-6 pb-8">

              {/* Title + subtitle */}
              <h2
                id={`${dialogId}-title`}
                className="mb-2 text-xl font-semibold"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
              >
                {success ? m.successTitle : STEP_TITLES[step - 1]}
              </h2>
              <p className="mb-6 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                {success
                  ? m.successBody(String(step1Values.name ?? ''))
                  : STEP_SUBTITLES[step - 1]}
              </p>

              {/* ── Success ──────────────────────────────────────────── */}
              {success && (
                <div className="flex justify-end pt-2">
                  <button
                    onClick={close}
                    className="rounded-xl px-6 py-2.5 text-sm font-semibold"
                    style={{
                      backgroundColor: 'var(--color-primary)',
                      color: '#fff',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    {m.successCloseLabel}
                  </button>
                </div>
              )}

              {/* ── Step 1 — Contact ─────────────────────────────────── */}
              {!success && step === 1 && (
                <form onSubmit={handleStep1Submit} noValidate>
                  {/* Honeypot — real input, CSS-hidden. Do NOT use type=hidden. */}
                  <input
                    type="text"
                    name="company_website"
                    autoComplete="off"
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      opacity: 0,
                      height: 0,
                      overflow: 'hidden',
                      pointerEvents: 'none',
                    }}
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

              {/* ── Step 2 — Organisation ────────────────────────────── */}
              {!success && step === 2 && (
                <form onSubmit={handleStep2Next} noValidate>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--form-field-gap, 16px)' }}>
                    {/* Organisation name */}
                    <FormField
                      config={{
                        id: 'organization',
                        type: 'text',
                        label: m.organizationLabel,
                        placeholder: m.organizationPlaceholder,
                        required: true,
                        width: '100%',
                      }}
                      value={String(step2Values.organization ?? '')}
                      onChange={(v) => setStep2Values((prev) => ({ ...prev, organization: v }))}
                      error={errors.organization}
                    />

                    {/* Role — card grid */}
                    <RoleCards
                      options={m.roleOptions}
                      value={String(step2Values.role ?? '')}
                      onChange={(v) => setStep2Values((prev) => ({ ...prev, role: v }))}
                      label={m.roleLabel}
                      error={errors.role}
                      required
                    />

                    {/* Organisation type — custom dropdown */}
                    <CustomSelect
                      options={m.orgTypeOptions}
                      value={String(step2Values.orgType ?? '')}
                      onChange={(v) => setStep2Values((prev) => ({ ...prev, orgType: v }))}
                      label={m.orgTypeLabel}
                      placeholder={m.orgTypePlaceholder}
                      error={errors.orgType}
                      required
                    />
                  </div>

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
                      className="flex-1 rounded-xl py-3 text-sm font-semibold"
                      style={{
                        backgroundColor: 'var(--color-primary)',
                        color: '#fff',
                        cursor: 'pointer',
                        border: 'none',
                      }}
                    >
                      {m.step2NextLabel}
                    </button>
                  </div>
                </form>
              )}

              {/* ── Step 3 — Streaming Needs ─────────────────────────── */}
              {!success && step === 3 && (
                <form onSubmit={handleStep3Submit} noValidate>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--form-field-gap, 16px)' }}>
                    {/* Use cases — chip grid */}
                    <ChipGrid
                      options={m.useCaseOptions}
                      value={(step3Values.useCases as string[]) ?? []}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, useCases: v }))}
                      label={m.useCasesLabel}
                      helpText={m.useCasesHelpText}
                    />

                    {/* Audience size — custom dropdown */}
                    <CustomSelect
                      options={m.audienceSizeOptions}
                      value={String(step3Values.audienceSize ?? '')}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, audienceSize: v }))}
                      label={m.audienceSizeLabel}
                      placeholder={m.audienceSizePlaceholder}
                    />

                    {/* Organisation website (optional) */}
                    <FormField
                      config={{
                        id: 'website',
                        type: 'url',
                        label: m.websiteLabel,
                        placeholder: m.websitePlaceholder,
                        required: false,
                        width: '100%',
                      }}
                      value={String(step3Values.website ?? '')}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, website: v }))}
                      error={errors.website}
                    />

                    {/* Referral source — custom dropdown (optional, no default) */}
                    <CustomSelect
                      options={m.referralOptions}
                      value={String(step3Values.referralSource ?? '')}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, referralSource: v }))}
                      label={m.referralSourceLabel}
                      placeholder={m.referralSourcePlaceholder}
                    />

                    {/* GDPR consent */}
                    <FormField
                      config={{
                        id: 'gdprConsent',
                        type: 'checkbox',
                        label: m.gdprFieldLabel,
                        checkboxLabel: m.gdprConsentText,
                        required: true,
                        width: '100%',
                      }}
                      value={step3Values.gdprConsent ?? false}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, gdprConsent: v }))}
                      error={errors.gdprConsent}
                    />
                  </div>

                  {submitError && (
                    <p className="mt-3 text-sm" role="alert" style={{ color: 'var(--color-danger)' }}>
                      {submitError}
                    </p>
                  )}

                  <div className="mt-6 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => { setStep(2); setErrors({}); setSubmitError(null) }}
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
                      {submitting ? m.submittingLabel : m.step3SubmitLabel}
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
