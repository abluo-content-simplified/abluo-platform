'use client'

/**
 * FormRenderer — Abluo Form System
 *
 * Converts a SanityForm (GROQ-resolved, locale-applied) into a rendered form
 * using the existing Form Field Library. Submits to POST /api/form-submissions.
 *
 * Architecture:
 * - Receives fully resolved (locale-applied) data — no raw localizedString objects
 * - Converts SanityFormField → FieldConfig for the field library
 * - Maps special field IDs (name, email, phone) to top-level inquiry columns
 * - Everything else goes into the data JSONB payload
 * - No hardcoded strings — all labels come from the form document or the messages prop
 */

import { useState, useCallback } from 'react'
import { FormField, validateForm } from '@/components/fields'
import type { FieldConfig, OptionItem } from '@/components/fields'
import type { SanityForm, SanityFormField } from '@/lib/sanity/types'

// ─── Messages ─────────────────────────────────────────────────────────────────

export interface FormRendererMessages {
  submitLabel: string
  submitting: string
  successMessage: string
  errorMessage: string
}

// ─── SanityFormField → FieldConfig conversion ─────────────────────────────────

function toFieldConfig(field: SanityFormField): FieldConfig | null {
  const base = {
    id: field.id,
    label: field.label ?? field.id,
    placeholder: field.placeholder,
    helpText: field.helpText,
    required: field.required ?? false,
    width: field.width ?? '100%',
    validation: field.required
      ? [{ type: 'required' as const, message: undefined }]
      : [],
  }

  const options: OptionItem[] = (field.options ?? []).map((o) => ({
    value: o.value,
    label: o.label ?? o.value,
  }))

  switch (field.type) {
    case 'text':
      return { ...base, type: 'text' }
    case 'email':
      return { ...base, type: 'email', validation: [...base.validation, { type: 'email' as const }] }
    case 'phone':
      return { ...base, type: 'phone' }
    case 'textarea':
      return { ...base, type: 'textarea', rows: field.rows ?? 4 }
    case 'select':
      return { ...base, type: 'select', options, emptyOption: field.placeholder }
    case 'radio-group':
      return { ...base, type: 'radio-group', options }
    case 'checkbox':
      return { ...base, type: 'checkbox', checkboxLabel: field.checkboxLabel }
    case 'checkbox-group':
      return { ...base, type: 'checkbox-group', options }
    default:
      return null
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FormRendererProps {
  form: SanityForm
  messages: FormRendererMessages
  /** BCP 47 locale — used for localized validation error messages */
  locale?: string
  /** Tenant slug (URL segment) — resolved server-side to tenant_id */
  tenantSlug?: string
  /** Spam protection — timestamp when the section became visible */
  openedAt?: number
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FormRenderer({ form, messages, locale = 'en', tenantSlug, openedAt }: FormRendererProps) {
  const fieldConfigs = (form.fields ?? [])
    .map(toFieldConfig)
    .filter((f): f is FieldConfig => f !== null)

  const initialValues = Object.fromEntries(fieldConfigs.map((f) => [f.id, '']))

  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle')

  const handleChange = useCallback((id: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [id]: value }))
    // Clear error on change
    if (errors[id]) setErrors((prev) => { const next = { ...prev }; delete next[id]; return next })
  }, [errors])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (status === 'submitting') return

    // ── Client-side validation ────────────────────────────────────────────────
    const validationErrors = validateForm(fieldConfigs, values, locale)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setStatus('submitting')
    setErrors({})

    // ── Build payload ─────────────────────────────────────────────────────────
    // Map: name, email, phone → top-level. gdprConsent → gdpr_consent. Rest → data.{}
    const TOP_LEVEL_KEYS = ['name', 'email', 'phone'] as const

    const topLevel: Record<string, unknown> = {}
    const extraData: Record<string, unknown> = {}
    let gdprConsent: boolean | undefined

    for (const [key, val] of Object.entries(values)) {
      if ((TOP_LEVEL_KEYS as readonly string[]).includes(key)) {
        topLevel[key] = val
      } else if (key === 'gdprConsent' || key === 'gdpr_consent') {
        gdprConsent = val === true || val === 'true'
      } else {
        extraData[key] = val
      }
    }

    const payload: Record<string, unknown> = {
      ...topLevel,
      inquiryType: form.inquiryType ?? 'contact',
      openedAt: openedAt ?? Date.now(),
      ...(tenantSlug ? { tenantSlug } : {}),
      ...(form.projectSlug ? { projectSlug: form.projectSlug } : {}),
      ...extraData,
    }

    if (gdprConsent !== undefined) {
      payload.gdprConsent = gdprConsent
    }

    // ── Submit ────────────────────────────────────────────────────────────────
    try {
      const res = await fetch('/api/form-submissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        setStatus('error')
        return
      }

      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  // ── Success state ─────────────────────────────────────────────────────────
  if (status === 'success') {
    return (
      <div className="py-8 text-center">
        <p className="text-[var(--text-primary)] text-lg font-medium">
          {form.successMessage ?? messages.successMessage}
        </p>
      </div>
    )
  }

  // ── Error state ───────────────────────────────────────────────────────────
  const showGlobalError = status === 'error'

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-0">
      {form.description && (
        <p className="mb-6 text-[var(--text-secondary)] text-sm leading-relaxed">
          {form.description}
        </p>
      )}

      {/* Field grid — 12-column grid, fields use 6 or 12 cols based on width */}
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

      {/* Honeypot — hidden from humans, caught by spam.ts */}
      <input
        type="text"
        name="company_website"
        autoComplete="off"
        tabIndex={-1}
        aria-hidden="true"
        style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px', overflow: 'hidden' }}
      />

      {showGlobalError && (
        <p className="mt-4 text-sm text-[var(--danger)]">
          {messages.errorMessage}
        </p>
      )}

      <div className="mt-6">
        <button
          type="submit"
          disabled={status === 'submitting'}
          className="px-6 py-3 rounded-[var(--radius-md)] bg-[var(--primary)] text-[var(--btn-primary-text,#fff)] text-sm font-medium transition-opacity disabled:opacity-60 hover:opacity-90"
        >
          {status === 'submitting'
            ? messages.submitting
            : (form.submitLabel ?? messages.submitLabel)}
        </button>
      </div>
    </form>
  )
}
