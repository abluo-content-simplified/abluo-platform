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

import { useState, useEffect, useRef, useId, useCallback, Fragment } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X, Check, ChevronDown } from 'lucide-react'
import { FormField } from '@/components/fields'
import type { FieldConfig } from '@/components/fields'
import { validateField } from '@/components/fields'
import { useEarlyAccess } from './EarlyAccessContext'
import { getEarlyAccessMessages } from '@/lib/forms/early-access-config'
import type { EarlyAccessMessages, EarlyAccessOptionItem } from '@/lib/forms/early-access-config'

// ─── Custom primitives ────────────────────────────────────────────────────────

/** Card-grid single-select (role picker). */
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
      <p className="mb-2 text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
        {label}
        {required && (
          <span style={{ color: 'var(--color-danger)', marginLeft: '3px' }} aria-hidden="true">
            *
          </span>
        )}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px' }}>
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
      <p className="mb-1 text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
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

/**
 * CustomSelect — portal-based dropdown.
 *
 * Renders the dropdown panel into document.body (via React portal) so it is
 * never clipped by the modal's overflow:auto container. Position is computed
 * from the trigger button's getBoundingClientRect and is recalculated on open.
 * The panel flips upward when there is not enough space below the trigger.
 */
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
  const [mounted, setMounted] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const selected = options.find((o) => o.value === value)

  // Avoid SSR portal mismatch — only render portal after hydration
  useEffect(() => { setMounted(true) }, [])

  const computeMenuPosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const spaceBelow = viewportHeight - rect.bottom
    const estimatedMenuHeight = Math.min(options.length * 42 + 12, 228)
    const openUpward = spaceBelow < estimatedMenuHeight + 8 && rect.top > estimatedMenuHeight + 8

    setMenuStyle({
      position: 'fixed' as const,
      left: rect.left,
      width: rect.width,
      ...(openUpward
        ? { bottom: viewportHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    })
  }, [options.length])

  const handleToggle = () => {
    if (!open) computeMenuPosition()
    setOpen((v) => !v)
  }

  // Close on outside click — checks both trigger and portal menu
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close when viewport scrolls or resizes so fixed panel does not drift
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, { capture: true, passive: true })
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const selectOption = (v: string) => {
    onChange(v)
    setOpen(false)
  }

  return (
    <div>
      <p className="mb-2 text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
        {label}
        {required && (
          <span style={{ color: 'var(--color-danger)', marginLeft: '3px' }} aria-hidden="true">
            *
          </span>
        )}
      </p>

      {/* Trigger */}
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
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
          boxShadow: open
            ? '0 0 0 3px color-mix(in oklch, var(--color-primary) 15%, transparent)'
            : 'none',
        }}
      >
        <span>{selected ? selected.label : placeholder}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          style={{ color: open ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
        />
      </button>

      {/* Portal dropdown — escapes modal overflow containment */}
      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && (
              <motion.ul
                ref={menuRef}
                key="dropdown"
                role="listbox"
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.14, ease: [0, 0, 0.2, 1] }}
                style={{
                  ...menuStyle,
                  zIndex: 9999,
                  maxHeight: '228px',
                  overflowY: 'auto',
                  borderRadius: '14px',
                  border: '1px solid color-mix(in oklch, var(--color-border) 80%, transparent)',
                  backgroundColor: 'color-mix(in oklch, var(--color-background) 90%, transparent)',
                  backdropFilter: 'blur(20px) saturate(180%)',
                  WebkitBackdropFilter: 'blur(20px) saturate(180%)',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.08)',
                  padding: '6px 0',
                  listStyle: 'none',
                  margin: 0,
                }}
              >
                {options.map((opt) => {
                  const isSelected = opt.value === value
                  return (
                    <li
                      key={opt.value}
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => selectOption(opt.value)}
                      className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm transition-colors"
                      style={{
                        color: isSelected ? 'var(--color-primary)' : 'var(--color-text-primary)',
                        backgroundColor: isSelected
                          ? 'color-mix(in oklch, var(--color-primary) 10%, transparent)'
                          : 'transparent',
                        fontWeight: isSelected ? 600 : 400,
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                          ;(e.currentTarget as HTMLElement).style.backgroundColor =
                            'color-mix(in oklch, var(--color-text-primary) 5%, transparent)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                          ;(e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'
                        }
                      }}
                    >
                      {isSelected ? (
                        <Check
                          size={13}
                          strokeWidth={2.5}
                          style={{ color: 'var(--color-primary)', flexShrink: 0 }}
                        />
                      ) : (
                        <span style={{ width: 13, flexShrink: 0 }} />
                      )}
                      {opt.label}
                    </li>
                  )
                })}
              </motion.ul>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {error && (
        <p className="mt-1.5 text-xs" style={{ color: 'var(--color-danger)' }} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

// ─── Numbered step indicator ──────────────────────────────────────────────────

function StepIndicator({ step, names }: { step: 1 | 2 | 3; names: string[] }) {
  const total = 3
  return (
    <div className="flex flex-col gap-1.5">
      {/* Circles + connecting lines */}
      <div className="flex items-center">
        {Array.from({ length: total }, (_, i) => i + 1).map((s, i) => (
          <Fragment key={s}>
            <div
              className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[10px] font-bold transition-all duration-300"
              style={{
                backgroundColor:
                  step > s
                    ? 'color-mix(in oklch, var(--color-primary) 60%, transparent)'
                    : step === s
                      ? 'var(--color-primary)'
                      : 'transparent',
                border: step >= s ? 'none' : '1.5px solid var(--color-border)',
                color: step >= s ? '#fff' : 'var(--color-text-muted)',
              }}
            >
              {step > s ? <Check size={10} strokeWidth={3} /> : s}
            </div>

            {i < total - 1 && (
              <div
                className="h-px shrink-0 transition-all duration-300"
                style={{
                  width: '28px',
                  backgroundColor: step > s
                    ? 'color-mix(in oklch, var(--color-primary) 60%, transparent)'
                    : 'var(--color-border)',
                }}
              />
            )}
          </Fragment>
        ))}
      </div>

      {/* "Step N of 3 — Name" */}
      <p className="text-[11px] leading-none" style={{ color: 'var(--color-text-muted)' }}>
        {`Step ${step} of ${total}`}
        <span style={{ opacity: 0.6 }}>{' — '}{names[step - 1]}</span>
      </p>
    </div>
  )
}

// ─── Shared button primitives ─────────────────────────────────────────────────

function PrimaryBtn({
  children,
  type = 'submit',
  disabled,
  onClick,
  className = '',
}: {
  children: React.ReactNode
  type?: 'button' | 'submit'
  disabled?: boolean
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl py-2.5 text-sm font-semibold transition-opacity ${className}`}
      style={{
        backgroundColor: 'var(--color-primary)',
        color: '#fff',
        opacity: disabled ? 0.65 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        border: 'none',
      }}
    >
      {children}
    </button>
  )
}

function SecondaryBtn({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl px-5 py-2.5 text-sm font-medium transition-colors"
      style={{
        backgroundColor: 'transparent',
        border: '1px solid var(--color-border)',
        color: 'var(--color-text-secondary)',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  )
}

// ─── Field config builders ────────────────────────────────────────────────────

function buildStep1Fields(m: EarlyAccessMessages): FieldConfig[] {
  return [
    {
      id: 'name',
      type: 'text',
      label: m.nameLabel,
      placeholder: m.namePlaceholder,
      required: true,
      width: '100%',
      // Locale-specific message baked in so validateStep shows it inline
      validation: [{ type: 'required', message: m.nameRequiredError }],
    },
    {
      id: 'email',
      type: 'email',
      label: m.emailLabel,
      placeholder: m.emailPlaceholder,
      required: true,
      width: '100%',
      // Both rules carry locale-specific messages — invalid email shows as
      // an inline field error, never collapsed into the generic banner
      validation: [
        { type: 'required', message: m.emailRequiredError },
        { type: 'email',    message: m.emailInvalidError  },
      ],
    },
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
    // rule.message overrides locale defaults — set by buildStep1Fields / buildStep3TextFields
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

  const step1Fields     = buildStep1Fields(m)
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

  // ── Reset when modal opens ───────────────────────────────────────────────────
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
      const res  = await fetch('/api/inquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok) { setSubmitError(m.submitError); return }
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
    if (!String(step2Values.organization ?? '').trim()) errs.organization = m.nameRequiredError
    if (!step2Values.role)    errs.role    = m.roleRequiredError
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
        const res = await fetch(`/api/inquiries/${inquiryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...qualificationData, partial: false }),
        })
        if (!res.ok) { setSubmitError(m.submitError); return }
      } else {
        const res  = await fetch('/api/inquiries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          }),
        })
        const data = await res.json()
        if (!res.ok) { setSubmitError(m.submitError); return }
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

  // ─── Step metadata ─────────────────────────────────────────────────────────

  const STEP_NAMES  = [m.step1Name,     m.step2Name,     m.step3Name]
  const STEP_TITLES = [m.step1Title,    m.step2Title,    m.step3Title]
  const STEP_SUBS   = [m.step1Subtitle, m.step2Subtitle, m.step3Subtitle]

  // ─── Render ────────────────────────────────────────────────────────────────

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
            className="fixed inset-0 z-[500] bg-black/50 backdrop-blur-sm"
            onClick={close}
            aria-hidden="true"
          />

          {/* Panel */}
          <motion.div
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-title`}
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
            className="fixed inset-x-4 top-[50%] z-[510] mx-auto max-w-lg -translate-y-1/2 rounded-2xl md:inset-x-auto md:left-1/2 md:-translate-x-1/2"
            style={{
              backgroundColor: 'var(--color-background)',
              backdropFilter: 'blur(16px) saturate(160%)',
              WebkitBackdropFilter: 'blur(16px) saturate(160%)',
              border: '1px solid color-mix(in oklch, var(--color-border) 80%, transparent)',
              boxShadow:
                '0 24px 64px rgba(0,0,0,0.18), 0 6px 24px rgba(0,0,0,0.1), 0 0 0 0.5px color-mix(in oklch, var(--color-border) 40%, transparent)',
              maxHeight: 'calc(100dvh - 2rem)',
              overflowY: 'auto',
            }}
          >
            {/* ── Header ─────────────────────────────────────────────── */}
            <div
              className="sticky top-0 z-10 flex items-start justify-between px-6 pt-6 pb-5"
              style={{
                backgroundColor: 'var(--color-background)',
                borderBottom: '1px solid color-mix(in oklch, var(--color-border) 40%, transparent)',
              }}
            >
              <div className="flex flex-col gap-2.5 pr-4">
                <p
                  className="text-[10px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {m.modalTitle}
                </p>

                {!success && <StepIndicator step={step} names={STEP_NAMES} />}
              </div>

              <button
                onClick={close}
                aria-label={m.closeLabel}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
                style={{
                  color: 'var(--color-text-muted)',
                  backgroundColor: 'color-mix(in oklch, var(--color-text-primary) 5%, transparent)',
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Body ───────────────────────────────────────────────── */}
            <div className="px-6 pb-8 pt-5">

              <h2
                id={`${dialogId}-title`}
                className="mb-1.5 text-xl font-semibold"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
              >
                {success ? m.successTitle : STEP_TITLES[step - 1]}
              </h2>
              <p className="mb-6 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {success
                  ? m.successBody(String(step1Values.name ?? ''))
                  : STEP_SUBS[step - 1]}
              </p>

              {/* ── Success ──────────────────────────────────────────── */}
              {success && (
                <div className="flex justify-end pt-2">
                  <PrimaryBtn type="button" onClick={close} className="px-6">
                    {m.successCloseLabel}
                  </PrimaryBtn>
                </div>
              )}

              {/* ── Step 1 — Contact ─────────────────────────────────── */}
              {!success && step === 1 && (
                <form onSubmit={handleStep1Submit} noValidate>
                  {/* Honeypot — real input, visually hidden */}
                  <input
                    type="text"
                    name="company_website"
                    autoComplete="off"
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{ position: 'absolute', opacity: 0, height: 0, overflow: 'hidden', pointerEvents: 'none' }}
                  />

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--form-field-gap, 16px)' }}>
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

                  <PrimaryBtn disabled={submitting} className="mt-6 w-full">
                    {submitting ? m.submittingLabel : m.step1SubmitLabel}
                  </PrimaryBtn>
                </form>
              )}

              {/* ── Step 2 — Organisation ────────────────────────────── */}
              {!success && step === 2 && (
                <form onSubmit={handleStep2Next} noValidate>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--form-field-gap, 16px)' }}>
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

                    <RoleCards
                      options={m.roleOptions}
                      value={String(step2Values.role ?? '')}
                      onChange={(v) => setStep2Values((prev) => ({ ...prev, role: v }))}
                      label={m.roleLabel}
                      error={errors.role}
                      required
                    />

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
                    <SecondaryBtn onClick={() => { setStep(1); setErrors({}); setSubmitError(null) }}>
                      {m.backLabel}
                    </SecondaryBtn>
                    <PrimaryBtn className="flex-1">
                      {m.step2NextLabel}
                    </PrimaryBtn>
                  </div>
                </form>
              )}

              {/* ── Step 3 — Streaming Needs ─────────────────────────── */}
              {!success && step === 3 && (
                <form onSubmit={handleStep3Submit} noValidate>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--form-field-gap, 16px)' }}>
                    <ChipGrid
                      options={m.useCaseOptions}
                      value={(step3Values.useCases as string[]) ?? []}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, useCases: v }))}
                      label={m.useCasesLabel}
                      helpText={m.useCasesHelpText}
                    />

                    <CustomSelect
                      options={m.audienceSizeOptions}
                      value={String(step3Values.audienceSize ?? '')}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, audienceSize: v }))}
                      label={m.audienceSizeLabel}
                      placeholder={m.audienceSizePlaceholder}
                    />

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

                    <CustomSelect
                      options={m.referralOptions}
                      value={String(step3Values.referralSource ?? '')}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, referralSource: v }))}
                      label={m.referralSourceLabel}
                      placeholder={m.referralSourcePlaceholder}
                    />

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
                    <SecondaryBtn onClick={() => { setStep(2); setErrors({}); setSubmitError(null) }}>
                      {m.backLabel}
                    </SecondaryBtn>
                    <PrimaryBtn disabled={submitting} className="flex-1">
                      {submitting ? m.submittingLabel : m.step3SubmitLabel}
                    </PrimaryBtn>
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
