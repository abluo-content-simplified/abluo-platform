'use client'

/**
 * EarlyAccessModal
 *
 * Three-step Early Access request flow.
 *
 * Step 1 — Contact (name + email)
 *   POST /api/forms/{projectSlug}/early-access/submissions → { submissionId, completionToken } → step 2
 *
 * Step 2 — Organisation (name, role cards, org type cards)
 *   Data collected locally → advance to step 3
 *
 * Step 3 — Streaming Needs (use cases chips, audience size dropdown, website, referral, GDPR)
 *   POST …/submissions/{id}/steps (stepKey 'details') → finalize → show success state
 *
 * When opened from footer CTA with startAtStep2=true, step 1 is already
 * recorded and we jump straight to step 2.
 *
 * LOCALIZATION: all user-facing text comes from getEarlyAccessMessages(locale).
 * No English literals appear in this component.
 *
 * ACCESSIBILITY: focus is trapped within the modal while open. Tab/Shift+Tab
 * cycles through interactive elements. Escape closes. Backdrop click does NOT
 * close (multi-step flow — users must not lose progress accidentally).
 *
 * GLASS: modal panel uses the same glass recipe as the Livener nav drawer:
 *   backdrop-blur-[24px] saturate-150 shadow-2xl
 *   backgroundColor: color-mix(in oklch, var(--color-background) 90%, transparent)
 *   borderColor: var(--color-border)
 */

import { useState, useEffect, useRef, useId, useCallback, Fragment } from 'react'
import { collectClientSource } from '@/lib/forms/source'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { X, Check, ChevronDown } from 'lucide-react'
import { FormField } from '@/components/fields'
import type { FieldConfig } from '@/components/fields'
import { validateField } from '@/components/fields'
import { useEarlyAccess } from './EarlyAccessContext'
import { getEarlyAccessMessages } from '@/lib/forms/early-access-config'
import type { EarlyAccessMessages, EarlyAccessOptionItem } from '@/lib/forms/early-access-config'

// ─── Focus trap ───────────────────────────────────────────────────────────────

const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function useFocusTrap(containerRef: React.RefObject<HTMLElement | null>, isActive: boolean) {
  useEffect(() => {
    if (!isActive || !containerRef.current) return

    const container = containerRef.current

    const getFocusables = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
        (el) => !el.closest('[aria-hidden="true"]'),
      )

    const firstFocusable = getFocusables()[0]
    ;(firstFocusable ?? container).focus()

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const elements = getFocusables()
      if (!elements.length) return
      const first = elements[0]
      const last  = elements[elements.length - 1]
      if (e.shiftKey) {
        if (document.activeElement === first || document.activeElement === container) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [isActive, containerRef])
}

// ─── PillStepper ─────────────────────────────────────────────────────────────

/**
 * Horizontal pill stepper.
 * Completed steps show a checkmark. Active step is highlighted in orange.
 * Upcoming steps are muted. Pills wrap on narrow screens.
 */
function PillStepper({
  step,
  stepOfLabel,
  stepNames,
}: {
  step: 1 | 2 | 3
  stepOfLabel: string
  stepNames: string[]
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {stepNames.map((name, i) => {
          const s = i + 1
          const isCompleted = step > s
          const isActive    = step === s
          return (
            <div
              key={s}
              className="flex items-center gap-1.5 rounded-[var(--radius-btn)] border px-3 py-1.5 text-xs font-semibold transition-all duration-200"
              style={{
                backgroundColor: isActive
                  ? 'var(--color-primary)'
                  : isCompleted
                    ? 'color-mix(in oklch, var(--color-primary) 10%, transparent)'
                    : 'transparent',
                borderColor: isActive || isCompleted
                  ? 'var(--color-primary)'
                  : 'var(--color-border)',
                color: isActive
                  ? '#fff'
                  : isCompleted
                    ? 'var(--color-primary)'
                    : 'var(--color-text-muted)',
              }}
            >
              {isCompleted && <Check size={10} strokeWidth={2.5} aria-hidden="true" />}
              {name}
            </div>
          )
        })}
      </div>

      <p className="text-[11px] leading-none" style={{ color: 'var(--color-text-muted)' }}>
        {stepOfLabel}
      </p>
    </div>
  )
}

// ─── SelectionCards ───────────────────────────────────────────────────────────

/**
 * Single-select card grid. Used for both Role and Organisation Type.
 * Cards are keyboard-navigable via Space/Enter (native button behaviour).
 * Accepts an optional helpText rendered under the section label.
 */
function SelectionCards({
  options,
  value,
  onChange,
  label,
  helpText,
  error,
  required,
  columns = 2,
}: {
  options: EarlyAccessOptionItem[]
  value: string
  onChange: (v: string) => void
  label: string
  helpText?: string
  error?: string
  required?: boolean
  columns?: 2 | 3
}) {
  return (
    <div>
      <p className="mb-1 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
        {label}
        {required && (
          <span style={{ color: 'var(--color-danger)', marginLeft: '3px' }} aria-hidden="true">
            *
          </span>
        )}
      </p>

      {helpText && (
        <p className="mb-2.5 text-xs" style={{ color: 'var(--color-text-muted)' }}>
          {helpText}
        </p>
      )}

      <div
        role="radiogroup"
        aria-label={label}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gap: '8px',
        }}
      >
        {options.map((opt) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(opt.value)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault()
                  onChange(opt.value)
                }
              }}
              className="rounded-[var(--radius-md)] border px-3 py-2.5 text-left text-sm font-medium transition-all"
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

// ─── ChipGrid ─────────────────────────────────────────────────────────────────

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
      <p className="mb-1 text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
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
              aria-pressed={active}
              onClick={() => toggle(opt.value)}
              className="flex items-center gap-1.5 rounded-[var(--radius-btn)] border px-3 py-1.5 text-sm font-medium transition-all"
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

// ─── CustomSelect (Step 3 dropdowns only) ─────────────────────────────────────

/**
 * Portal-based dropdown for Step 3 (audience size, referral source).
 * Renders into document.body to avoid overflow clipping by the modal scroll container.
 */
function CustomSelect({
  options,
  value,
  onChange,
  label,
  placeholder,
}: {
  options: EarlyAccessOptionItem[]
  value: string
  onChange: (v: string) => void
  label: string
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({})
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const selected = options.find((o) => o.value === value)

  useEffect(() => { setMounted(true) }, [])

  const computeMenuPosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    const estimatedHeight = Math.min(options.length * 42 + 12, 228)
    const openUpward = spaceBelow < estimatedHeight + 8 && rect.top > estimatedHeight + 8
    setMenuStyle({
      position: 'fixed' as const,
      left: rect.left,
      width: rect.width,
      ...(openUpward ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    })
  }, [options.length])

  const handleToggle = () => {
    if (!open) computeMenuPosition()
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const t = e.target as Node
      if (!triggerRef.current?.contains(t) && !menuRef.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

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

  return (
    <div>
      <p className="mb-2 text-sm font-medium" style={{ color: 'var(--color-text-primary)' }}>
        {label}
      </p>

      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-[var(--radius-md)] border px-4 py-2.5 text-sm transition-all"
        style={{
          borderColor: open ? 'var(--color-primary)' : 'var(--color-border)',
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
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-border)',
                  backgroundColor: 'color-mix(in oklch, var(--color-background) 90%, transparent)',
                  backdropFilter: 'blur(24px) saturate(1.5)',
                  boxShadow: '0 8px 32px color-mix(in oklch, var(--color-border) 150%, transparent)',
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
                      onClick={() => { onChange(opt.value); setOpen(false) }}
                      className="flex cursor-pointer items-center gap-2 px-4 py-2.5 text-sm transition-colors"
                      style={{
                        color: isSelected ? 'var(--color-primary)' : 'var(--color-text-primary)',
                        backgroundColor: isSelected
                          ? 'color-mix(in oklch, var(--color-primary) 10%, transparent)'
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
                      {isSelected ? (
                        <Check size={13} strokeWidth={2.5} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
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
    </div>
  )
}

// ─── AnimatedCheck ────────────────────────────────────────────────────────────

/**
 * Large animated checkmark for the success screen.
 * Scales in, then the path draws itself.
 * Uses only existing design tokens — no hardcoded colours.
 */
function AnimatedCheck() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.65 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] }}
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{
        width: 80,
        height: 80,
        backgroundColor: 'color-mix(in oklch, var(--color-primary) 12%, transparent)',
        boxShadow: '0 0 48px color-mix(in oklch, var(--color-primary) 22%, transparent)',
      }}
    >
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <motion.path
          d="M 8 20 L 17 29 L 32 12"
          strokeWidth={3}
          stroke="var(--color-primary)"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.22, ease: 'easeOut' }}
        />
      </svg>
    </motion.div>
  )
}

// ─── SuccessScreen ────────────────────────────────────────────────────────────

/**
 * Layout:  [body text + Close button]    [large animated check]
 * The check acts as a visual counterweight on the right side.
 */
function SuccessScreen({
  body,
  closeLabel,
  onClose,
}: {
  body: string
  closeLabel: string
  onClose: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0, 0, 0.2, 1] }}
    >
      <div className="flex items-start justify-between gap-6 pt-1">
        {/* Text + action — left side */}
        <div className="flex flex-col gap-5">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
            {body}
          </p>
          <button
            type="button"
            onClick={onClose}
            className="self-start rounded-[var(--radius-btn)] px-7 py-2.5 text-sm font-semibold transition-opacity"
            style={{
              backgroundColor: 'var(--color-primary)',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {closeLabel}
          </button>
        </div>

        {/* Animated check — right side, visual counterweight */}
        <AnimatedCheck />
      </div>
    </motion.div>
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
      className={`rounded-[var(--radius-btn)] py-2.5 text-sm font-semibold transition-opacity ${className}`}
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
      className="rounded-[var(--radius-btn)] px-5 py-2.5 text-sm font-medium transition-colors"
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
      // an inline field error, never collapsed into the generic banner.
      validation: [
        { type: 'required', message: m.emailRequiredError },
        { type: 'email',    message: m.emailInvalidError  },
      ],
    },
  ]
}

/** Website field — used for both validation and rendering in Step 3. */
function buildStep3WebsiteField(m: EarlyAccessMessages): FieldConfig {
  return {
    id: 'website',
    type: 'url',
    label: m.websiteLabel,
    placeholder: m.websitePlaceholder,
    required: false,
    width: '100%',
  }
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

function validateOrgName(value: string, m: EarlyAccessMessages): string | null {
  const trimmed = value.trim()
  if (trimmed.length < 2)    return m.orgNameMinLengthError
  if (/^\d+$/.test(trimmed)) return m.orgNameInvalidError
  return null
}

// ─── SectionDivider ───────────────────────────────────────────────────────────

function SectionDivider() {
  return (
    <div
      className="my-1"
      style={{
        height: '1px',
        backgroundColor: 'color-mix(in oklch, var(--color-border) 60%, transparent)',
      }}
      aria-hidden="true"
    />
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function EarlyAccessModal() {
  const { isOpen, options, tenantSlug, locale, close } = useEarlyAccess()
  const m = getEarlyAccessMessages(locale)
  const formStartedAt = useRef<number>(Date.now())
  const dialogId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  // Focus trap
  useFocusTrap(panelRef, isOpen)

  const step1Fields    = buildStep1Fields(m)
  const websiteField   = buildStep3WebsiteField(m)

  const [step, setStep]               = useState<1 | 2 | 3>(1)
  const [submissionId, setSubmissionId]       = useState<string | null>(null)
  const [completionToken, setCompletionToken] = useState<string | null>(null)
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

      if (options.startAtStep2 && options.submissionId) {
        setStep(2)
        setSubmissionId(options.submissionId)
        setCompletionToken(options.completionToken ?? null)
        setStep1Values({ name: options.name ?? '', email: options.email ?? '' })
        setStep2Values(getInitialStep2Values())
        setStep3Values(getInitialStep3Values())
      } else {
        setStep(1)
        setSubmissionId(options.submissionId ?? null)
        setCompletionToken(options.completionToken ?? null)
        setStep1Values({ name: options.name ?? '', email: options.email ?? '' })
        setStep2Values(getInitialStep2Values())
        setStep3Values(getInitialStep3Values())
      }
    }
  }, [isOpen, options])

  // ── Keyboard close (Escape only) ─────────────────────────────────────────────
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
      const res  = await fetch(`/api/forms/${tenantSlug}/early-access/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale,
          data: { name: step1Values.name, email: step1Values.email },
          source: collectClientSource({
            source:             options?.source ?? 'header_cta',
            cta_internal_name:  options?.ctaInternalName  ?? null,
            cta_label_snapshot: options?.ctaLabelSnapshot ?? null,
          }),
          openedAt:        formStartedAt.current,
          company_website: '',
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.submissionId) { setSubmitError(m.submitError); return }
      setSubmissionId(data.submissionId)
      setCompletionToken(data.completionToken ?? null)
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

    const orgErr = validateOrgName(String(step2Values.organization ?? ''), m)
    if (orgErr) errs.organization = orgErr

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

    // Validate the website field via the shared validator
    const errs = validateStep([websiteField], step3Values)

    // GDPR consent is required — validate explicitly
    if (!step3Values.gdprConsent) errs.gdprConsent = m.gdprRequiredError

    if (Object.keys(errs).length) { setErrors(errs); return }

    setSubmitting(true)
    try {
      const detailsData = { ...step2Values, ...step3Values }

      if (!submissionId || !completionToken) {
        setSubmitError(m.submitError)
        return
      }

      const res = await fetch(
        `/api/forms/${tenantSlug}/early-access/submissions/${submissionId}/steps`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stepKey: 'details',
            completionToken,
            data: detailsData,
            gdprConsent: step3Values.gdprConsent === true,
          }),
        },
      )
      const data = await res.json()
      if (!res.ok || !data.done) { setSubmitError(m.submitError); return }

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
  const submitterName = String(step1Values.name ?? '').split(' ')[0] ?? ''

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ── Backdrop — matches Livener nav overlay. Does NOT close the modal. ── */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[500] bg-black/45 backdrop-blur-sm"
            aria-hidden="true"
          />

          {/* ── Panel — glass recipe from Livener nav drawer ────────────────── */}
          <motion.div
            ref={panelRef}
            key="panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-title`}
            tabIndex={-1}
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: 0.25, ease: [0, 0, 0.2, 1] }}
            className="fixed inset-x-4 top-[50%] z-[510] mx-auto max-w-lg -translate-y-1/2 rounded-[var(--radius-lg)] shadow-2xl backdrop-blur-[24px] saturate-150 md:inset-x-auto md:left-1/2 md:-translate-x-1/2"
            style={{
              backgroundColor: 'color-mix(in oklch, var(--color-background) 90%, transparent)',
              border: '1px solid var(--color-border)',
              maxHeight: 'calc(100dvh - 2rem)',
              overflowY: 'auto',
              outline: 'none',
            }}
          >
            {/* ── Header ─────────────────────────────────────────────────────── */}
            <div
              className="sticky top-0 z-10 flex items-start justify-between px-6 pt-6 pb-5 backdrop-blur-[24px] saturate-150"
              style={{
                backgroundColor: 'color-mix(in oklch, var(--color-background) 88%, transparent)',
                borderBottom: '1px solid color-mix(in oklch, var(--color-border) 50%, transparent)',
              }}
            >
              <div className="flex flex-col gap-3 pr-4">
                <p
                  className="text-[10px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {m.modalTitle}
                </p>

                {!success && (
                  <PillStepper
                    step={step}
                    stepOfLabel={m.stepOfLabel(step, 3)}
                    stepNames={STEP_NAMES}
                  />
                )}
              </div>

              <button
                onClick={close}
                aria-label={m.closeLabel}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors"
                style={{
                  color: 'var(--color-text-muted)',
                  backgroundColor: 'color-mix(in oklch, var(--color-border) 50%, transparent)',
                }}
              >
                <X size={16} />
              </button>
            </div>

            {/* ── Body ───────────────────────────────────────────────────────── */}
            <div className="px-6 pb-8 pt-5">

              <h2
                id={`${dialogId}-title`}
                className="mb-1.5 text-xl font-semibold"
                style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-heading)' }}
              >
                {success ? m.successTitle(submitterName) : STEP_TITLES[step - 1]}
              </h2>

              {!success && (
                <p className="mb-6 text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                  {STEP_SUBS[step - 1]}
                </p>
              )}

              {/* ── Success ─────────────────────────────────────────────────── */}
              {success && (
                <SuccessScreen
                  body={m.successBody}
                  closeLabel={m.successCloseLabel}
                  onClose={close}
                />
              )}

              {/* ── Step 1 — Contact ────────────────────────────────────────── */}
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

              {/* ── Step 2 — Organisation ───────────────────────────────────── */}
              {!success && step === 2 && (
                <form onSubmit={handleStep2Next} noValidate>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {/* Organisation name — field label is implicitly strong via FormField */}
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

                    {/* Role — card grid with section heading + helper text */}
                    <SelectionCards
                      options={m.roleOptions}
                      value={String(step2Values.role ?? '')}
                      onChange={(v) => setStep2Values((prev) => ({ ...prev, role: v }))}
                      label={m.roleLabel}
                      helpText={m.roleHelpText}
                      error={errors.role}
                      required
                    />

                    {/* Organisation Type — same pattern */}
                    <SelectionCards
                      options={m.orgTypeOptions}
                      value={String(step2Values.orgType ?? '')}
                      onChange={(v) => setStep2Values((prev) => ({ ...prev, orgType: v }))}
                      label={m.orgTypeLabel}
                      helpText={m.orgTypeHelpText}
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

              {/* ── Step 3 — Streaming Needs ────────────────────────────────── */}
              {!success && step === 3 && (
                <form onSubmit={handleStep3Submit} noValidate>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

                    {/* Use cases — primary field, sits at top */}
                    <ChipGrid
                      options={m.useCaseOptions}
                      value={(step3Values.useCases as string[]) ?? []}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, useCases: v }))}
                      label={m.useCasesLabel}
                      helpText={m.useCasesHelpText}
                    />

                    <SectionDivider />

                    {/* Audience + referral — operational pair */}
                    <CustomSelect
                      options={m.audienceSizeOptions}
                      value={String(step3Values.audienceSize ?? '')}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, audienceSize: v }))}
                      label={m.audienceSizeLabel}
                      placeholder={m.audienceSizePlaceholder}
                    />

                    <CustomSelect
                      options={m.referralOptions}
                      value={String(step3Values.referralSource ?? '')}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, referralSource: v }))}
                      label={m.referralSourceLabel}
                      placeholder={m.referralSourcePlaceholder}
                    />

                    <SectionDivider />

                    {/* Website — optional, less prominent */}
                    <FormField
                      config={websiteField}
                      value={String(step3Values.website ?? '')}
                      onChange={(v) => setStep3Values((prev) => ({ ...prev, website: v }))}
                      error={errors.website}
                    />

                    {/* GDPR — custom premium checkbox, intentionally lighter */}
                    <div>
                      <label
                        className="flex cursor-pointer items-start gap-3 rounded-[var(--radius-md)] border p-4 transition-colors"
                        style={{
                          borderColor: errors.gdprConsent
                            ? 'var(--form-input-error-border, var(--color-danger))'
                            : 'var(--color-border)',
                          backgroundColor: 'color-mix(in oklch, var(--color-border) 25%, transparent)',
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(step3Values.gdprConsent)}
                          onChange={(e) =>
                            setStep3Values((prev) => ({ ...prev, gdprConsent: e.target.checked }))
                          }
                          style={{
                            marginTop: 2,
                            flexShrink: 0,
                            accentColor: 'var(--color-primary)',
                            width: 15,
                            height: 15,
                          }}
                        />
                        <span
                          className="text-sm leading-relaxed"
                          style={{ color: 'var(--color-text-secondary)' }}
                        >
                          {m.gdprConsentText}
                        </span>
                      </label>
                      {errors.gdprConsent && (
                        <p
                          className="mt-1.5 text-xs"
                          role="alert"
                          style={{ color: 'var(--color-danger)' }}
                        >
                          {errors.gdprConsent}
                        </p>
                      )}
                    </div>

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
