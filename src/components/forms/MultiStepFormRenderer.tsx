'use client'

/**
 * MultiStepFormRenderer — ADR-018 slice 5.
 *
 * Drives a multi-step `formDefinition` through the anonymous rotating-token
 * flow: `POST …/submissions` creates the partial with step 1's data and returns
 * a `completionToken`; each subsequent step posts to `…/submissions/{id}/steps`
 * with the current token, which the server spends and rotates; the final step
 * finalizes and emits `form.submitted`. Values accumulate client-side and each
 * step is server-validated against the row's pinned snapshot (slice 3).
 *
 * Context-aware (ADR-018 §7): a placement's Context pre-fills `contextMappable`
 * fields (mirroring the server's sanitizeContext — the server stays
 * authoritative) and the visitor opens at the first step with an unsatisfied
 * required field. Leading steps that Context fully satisfies are auto-advanced
 * on mount; if that fails for any reason it falls back to starting at step 1
 * with the fields still pre-filled. Forward-only (no back) this slice.
 *
 * Appearance derives entirely from the website Design System CSS variables the
 * Field Library consumes — no styling of its own beyond DS tokens.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { FormField, validateForm } from '@/components/fields'
import type { RenderableFormDefinition } from '@/lib/sanity/types'
import type { FormSectionMessages } from '@/lib/i18n/form-section-messages'
import { buildFieldConfigs, buildSubmissionPayload, submissionEndpoint, CONSENT_FIELD_ID } from '@/lib/forms/render-mapping'
import {
  mapContextToValues,
  firstIncompleteStepIndex,
  autoAdvanceSteps,
  stepValues,
  isFinalStepIndex,
} from '@/lib/forms/multistep'

interface StepResponse {
  ok?: boolean
  submissionId?: string
  done?: boolean
  completionToken?: string
  nextStepKey?: string | null
}

interface Props {
  definition: RenderableFormDefinition
  messages: FormSectionMessages
  locale?: string
  tenantSlug: string
  /** Placement Context — only contextMappable keys are honored (client + server). */
  context?: Record<string, unknown> | null
  /** Presentation context: 'overlay' pins the submit button as a sticky footer. */
  layout?: 'inline' | 'overlay'
}

export function MultiStepFormRenderer({ definition: def, messages, locale = 'en', tenantSlug, context, layout = 'inline' }: Props) {
  const openedAt = useRef(Date.now())
  const honeypotRef = useRef<HTMLInputElement>(null)
  const preparedRef = useRef(false)
  // Context → initial values (contextMappable only), computed once.
  const initialContext = useRef(mapContextToValues(def, context ?? undefined)).current

  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const base: Record<string, unknown> = { [CONSENT_FIELD_ID]: false }
    for (const s of def.steps) for (const f of s.fields) base[f.id] = f.type === 'checkbox' ? false : ''
    return { ...base, ...initialContext }
  })
  const landingIndex = firstIncompleteStepIndex(def, initialContext)
  const [stepIndex, setStepIndex] = useState(landingIndex)
  // The first step the visitor actually sees. Steps auto-advanced by Context are
  // "done" and excluded from the progress count (e.g. landing on step 2 of 3 →
  // "Step 1 of 2"; landing on the only remaining step → no counter). Resets to 0
  // if auto-advance falls back to a full run.
  const [baseStep, setBaseStep] = useState(landingIndex)
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<'preparing' | 'idle' | 'submitting' | 'success' | 'error'>(
    landingIndex > 0 ? 'preparing' : 'idle',
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  const handleChange = useCallback((id: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [id]: value }))
    setErrors((prev) => {
      if (!prev[id]) return prev
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const endpoint = submissionEndpoint(tenantSlug, def.formId)

  const postCreate = useCallback(
    async (stepData: Record<string, unknown>, timed = true): Promise<StepResponse | null> => {
      // `timed` false for the machine-paced auto-advance create: it omits
      // openedAt so the server's too-fast spam heuristic does not apply to a
      // context-satisfied step the visitor never filled.
      const base = buildSubmissionPayload(stepData, {
        locale,
        openedAt: timed ? openedAt.current : undefined,
        honeypot: honeypotRef.current?.value ?? '',
      })
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, context: context ?? undefined }),
      })
      if (!res.ok) return null
      return res.json()
    },
    [endpoint, locale, context],
  )

  const postStep = useCallback(
    async (sid: string, tok: string | null, stepKey: string, data: Record<string, unknown>, gdprConsent: boolean): Promise<StepResponse | null> => {
      const res = await fetch(`${endpoint}/${sid}/steps`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stepKey, completionToken: tok ?? undefined, data, gdprConsent }),
      })
      if (!res.ok) return null
      return res.json()
    },
    [endpoint],
  )

  // ── Auto-advance context-satisfied leading steps on mount ────────────────────
  useEffect(() => {
    if (preparedRef.current) return
    preparedRef.current = true
    const leading = autoAdvanceSteps(def, initialContext) // steps [0 .. landingIndex-1]
    if (leading.length === 0) {
      setStatus('idle')
      return
    }
    ;(async () => {
      try {
        const created = await postCreate(stepValues(def.steps[0], initialContext), false)
        if (!created?.submissionId) throw new Error('create failed')
        let sid = created.submissionId
        let tok = created.completionToken ?? null
        if (created.done) { setSubmissionId(sid); setStatus('success'); return }
        for (let i = 1; i < leading.length; i++) {
          const r = await postStep(sid, tok, def.steps[i].key, stepValues(def.steps[i], initialContext), false)
          if (!r) throw new Error('step failed')
          tok = r.completionToken ?? null
          if (r.done) { setSubmissionId(sid); setStatus('success'); return }
        }
        setSubmissionId(sid)
        setToken(tok)
        setStatus('idle')
      } catch {
        // Fallback: start at step 1 with Context still pre-filled — full run.
        setSubmissionId(null)
        setToken(null)
        setStepIndex(0)
        setBaseStep(0)
        setStatus('idle')
      }
    })()
    // Mount-only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const currentStep = def.steps[stepIndex]
  const finalStep = isFinalStepIndex(def, stepIndex)
  const includeConsent = finalStep && !!def.requireConsent
  const fieldConfigs = currentStep ? buildFieldConfigs(def, currentStep.fields, includeConsent) : []
  // Presentation (ADR-018 slice 7): full-width button + Option A progress bar.
  const fullWidth = def.fullWidthButton !== false
  const visibleTotal = def.steps.length - baseStep
  const visibleCurrent = stepIndex - baseStep + 1
  const progressPct = visibleTotal > 0 ? Math.round((visibleCurrent / visibleTotal) * 100) : 0

  const advanceTo = (nextStepKey: string | null | undefined) => {
    const i = nextStepKey ? def.steps.findIndex((s) => s.key === nextStepKey) : -1
    if (i >= 0) setStepIndex(i)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (status === 'submitting' || !currentStep) return

    const validationErrors = validateForm(fieldConfigs, values, locale)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setStatus('submitting')
    setErrors({})
    const data = stepValues(currentStep, values)
    const consent = includeConsent ? values[CONSENT_FIELD_ID] === true : false

    try {
      if (!submissionId) {
        // First interactive submit → create the submission with this step's data.
        const created = await postCreate(data)
        if (!created?.submissionId) { setStatus('error'); return }
        if (created.done) { setStatus('success'); return }
        setSubmissionId(created.submissionId)
        setToken(created.completionToken ?? null)
        setStatus('idle')
        advanceTo(created.nextStepKey)
      } else {
        const r = await postStep(submissionId, token, currentStep.key, data, consent)
        if (!r) { setStatus('error'); return }
        if (r.done) { setStatus('success'); return }
        setToken(r.completionToken ?? null)
        setStatus('idle')
        advanceTo(r.nextStepKey)
      }
    } catch {
      setStatus('error')
    }
  }

  if (status === 'preparing') {
    return <div className="py-8 text-center text-[var(--color-text-secondary)] text-sm">{messages.submitting}</div>
  }

  if (status === 'success') {
    return (
      <div className="py-8 text-center">
        {def.successTitle && <p className="text-[var(--color-text-primary)] text-lg font-medium">{def.successTitle}</p>}
        <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed mt-2">
          {def.successBody ?? messages.successMessage}
        </p>
      </div>
    )
  }

  if (!currentStep) return null

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-0">
      <div className="mb-6">
        {visibleTotal > 1 && (
          <div className="mb-3">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[var(--color-text-secondary)] text-xs font-medium uppercase tracking-wide">
                {messages.stepLabel
                  .replace('{current}', String(visibleCurrent))
                  .replace('{total}', String(visibleTotal))}
              </span>
              <span className="text-[var(--color-text-secondary)] text-xs opacity-70">{progressPct}%</span>
            </div>
            <div
              className="h-[5px] rounded-full overflow-hidden"
              style={{ backgroundColor: 'color-mix(in oklch, var(--color-text-secondary) 22%, transparent)' }}
            >
              <div
                className="h-full rounded-full"
                style={{ width: `${progressPct}%`, background: 'var(--color-primary)', transition: 'width 300ms ease' }}
              />
            </div>
          </div>
        )}
        {currentStep.title && (
          <h3 className="text-[var(--color-text-primary)] text-lg font-medium mt-1">{currentStep.title}</h3>
        )}
      </div>

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

      {status === 'error' && <p className="mt-4 text-sm text-[var(--color-danger)]">{messages.errorMessage}</p>}

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
          {status === 'submitting' ? messages.submitting : finalStep ? messages.submitLabel : messages.continueLabel}
        </button>
      </div>
    </form>
  )
}
