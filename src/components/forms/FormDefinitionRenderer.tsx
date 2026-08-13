'use client'

/**
 * FormDefinitionRenderer — ADR-018 slice 4.
 *
 * Renders a tenant-owned, single-step `formDefinition` (GROQ-resolved,
 * locale-applied) through the Field Library and submits to the new
 * `/api/forms/{tenantSlug}/{formId}/submissions` endpoint — the one that
 * resolves the published definition, validates + freezes the snapshot, and
 * emits `form.submitted` (slices 1/3). Appearance derives entirely from the
 * website Design System CSS variables the field components already consume;
 * this component imposes no styling of its own beyond DS tokens.
 *
 * Single-step only (slice 4). A multi-step definition is declined by
 * `singleStepFields()` and this renders nothing — the stepper + rotating-token
 * flow is slice 5.
 */

import { useState, useCallback, useRef } from 'react'
import { FormField, validateForm } from '@/components/fields'
import type { RenderableFormDefinition } from '@/lib/sanity/types'
import {
  singleStepFields,
  buildFieldConfigs,
  buildSubmissionPayload,
  submissionEndpoint,
} from '@/lib/forms/render-mapping'

export interface FormDefinitionRendererMessages {
  submitLabel: string
  submitting: string
  successMessage: string
  errorMessage: string
}

interface Props {
  definition: RenderableFormDefinition
  messages: FormDefinitionRendererMessages
  /** BCP 47 locale — used for localized validation error messages. */
  locale?: string
  /** URL tenant slug — the submission route scope; resolved server-side to tenant/project. */
  tenantSlug: string
  /** Presentation context: 'overlay' pins the submit button as a sticky footer. */
  layout?: 'inline' | 'overlay'
}

export function FormDefinitionRenderer({ definition, messages, locale = 'en', tenantSlug, layout = 'inline' }: Props) {
  const fields = singleStepFields(definition)
  // Presentation (ADR-018 slice 7): submit spans full width unless explicitly disabled.
  const fullWidth = definition.fullWidthButton !== false

  // Spam protection — capture the moment the form becomes visible (mirrors
  // FormRenderer/EarlyAccessFooterCta). A ~0ms elapsed time trips isTooFast().
  const openedAt = useRef(Date.now())
  const honeypotRef = useRef<HTMLInputElement>(null)

  const fieldConfigs = fields ? buildFieldConfigs(definition, fields) : []
  const [values, setValues] = useState<Record<string, unknown>>(
    () => Object.fromEntries(fieldConfigs.map((f) => [f.id, f.type === 'checkbox' ? false : ''])),
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')

  const handleChange = useCallback((id: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [id]: value }))
    setErrors((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  // Multi-step / malformed definitions are not rendered this slice (slice 5).
  if (!fields) {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn(`[FormDefinitionRenderer] "${definition.formId}" is multi-step or empty — not rendered (slice 4 is single-step).`)
    }
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (status === 'submitting') return

    const validationErrors = validateForm(fieldConfigs, values, locale)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setStatus('submitting')
    setErrors({})

    const payload = buildSubmissionPayload(values, {
      locale,
      openedAt: openedAt.current,
      honeypot: honeypotRef.current?.value ?? '',
    })

    try {
      const res = await fetch(submissionEndpoint(tenantSlug, definition.formId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      // The server returns { ok: true } even for a spam-quarantined submission,
      // so the visitor always sees success — never a signal that they were flagged.
      if (!res.ok) {
        setStatus('error')
        return
      }
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="py-8 text-center">
        {definition.successTitle && (
          <p className="text-[var(--color-text-primary)] text-lg font-medium">{definition.successTitle}</p>
        )}
        <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed mt-2">
          {definition.successBody ?? messages.successMessage}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-0">
      <div className="grid grid-cols-12 gap-4">
        {fieldConfigs.map((config) => {
          const colClass = config.width === '50%' ? 'col-span-12 sm:col-span-6' : 'col-span-12'
          return (
            <div key={config.id} className={colClass}>
              <FormField
                config={config}
                value={values[config.id]}
                onChange={(val) => handleChange(config.id, val)}
                error={errors[config.id]}
              />
            </div>
          )
        })}
      </div>

      {/* Honeypot — hidden from humans, caught by spam.ts as `company_website`. */}
      <input
        ref={honeypotRef}
        type="text"
        name="company_website"
        autoComplete="off"
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
      />

      {status === 'error' && (
        <p className="mt-4 text-sm text-[var(--color-danger)]">{messages.errorMessage}</p>
      )}

      <div
        className={layout === 'overlay' ? 'sticky bottom-0 -mx-6 mt-6 px-6 pt-4 pb-1' : 'mt-6'}
        style={layout === 'overlay' ? {
          background: 'color-mix(in oklch, var(--color-background, var(--background)) 92%, transparent)',
          backdropFilter: 'blur(12px) saturate(1.4)',
          borderTop: '1px solid color-mix(in oklch, var(--color-border, var(--border)) 45%, transparent)',
        } : undefined}
      >
        <button
          type="submit"
          disabled={status === 'submitting'}
          className={`${fullWidth ? 'w-full ' : ''}inline-flex items-center justify-center rounded-[var(--radius-btn)] px-6 py-3.5 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] text-sm font-semibold transition-all disabled:opacity-60 hover:bg-[var(--btn-primary-hover-bg)]`}
        >
          {status === 'submitting' ? messages.submitting : messages.submitLabel}
        </button>
      </div>
    </form>
  )
}
