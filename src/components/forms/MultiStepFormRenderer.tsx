'use client'

/**
 * MultiStepFormRenderer — ADR-018 slice 5 (+ slice 7e: back navigation + recap).
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
 * with the fields still pre-filled.
 *
 * Slice 7e — navigation & review:
 *   - Back: the visitor can step backwards to edit earlier answers. The partial
 *     submission is ONE row (created on step 1); going back and re-submitting a
 *     step updates that same row in place — never a new record (the server
 *     merges by step key). Back is pure client navigation; nothing is posted.
 *   - Review (`definition.reviewStep`): a final recap screen lists every answer
 *     with per-step "Edit" links before the visitor commits. Consent moves to
 *     the recap (the true submit point), and the LAST step is only posted when
 *     the visitor confirms on the recap — so "review before send" is real.
 *
 * Appearance derives entirely from the website Design System CSS variables the
 * Field Library consumes — no styling of its own beyond DS tokens.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import { FormField, validateForm } from '@/components/fields'
import type { RenderableFormDefinition, RenderableFormField } from '@/lib/sanity/types'
import type { FormSectionMessages } from '@/lib/i18n/form-section-messages'
import { buildFieldConfigs, buildSubmissionPayload, submissionEndpoint, applySuccessTemplate, CONSENT_FIELD_ID } from '@/lib/forms/render-mapping'
import { collectClientSource } from '@/lib/forms/source'
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
  /** Lead-source seed (entry point + CTA) merged with auto page/referrer/UTM. */
  source?: Record<string, unknown> | null
}

/** Renders a submitted value for the recap: maps option values → localized labels. */
function formatFieldValue(field: RenderableFormField, value: unknown): string {
  const isEmpty =
    value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
  if (isEmpty) return '—'
  const labelFor = (v: unknown) => field.options?.find((o) => o.value === v)?.label ?? String(v)
  if (Array.isArray(value)) return value.map(labelFor).join(', ')
  if (field.options && field.options.length > 0) return labelFor(value)
  if (typeof value === 'boolean') return value ? '✓' : '—'
  return String(value)
}

export function MultiStepFormRenderer({ definition: def, messages, locale = 'en', tenantSlug, context, layout = 'inline', source }: Props) {
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
  // True while the visitor is editing a step reached from the recap — Continue
  // then returns to the recap instead of walking forward step by step.
  const [editReturn, setEditReturn] = useState(false)
  const [submissionId, setSubmissionId] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<'preparing' | 'idle' | 'submitting' | 'success' | 'error'>(
    landingIndex > 0 ? 'preparing' : 'idle',
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  // ── Review-screen geometry ───────────────────────────────────────────────────
  const showRecap = !!def.reviewStep && def.steps.length > 1
  const lastRealIndex = def.steps.length - 1
  const recapIndex = def.steps.length
  const isRecap = showRecap && stepIndex >= recapIndex

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
        source: collectClientSource(source ?? {}),
      })
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, context: context ?? undefined }),
      })
      if (!res.ok) return null
      return res.json()
    },
    [endpoint, locale, context, source],
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

  const currentStep = isRecap ? undefined : def.steps[stepIndex]
  const finalStep = isFinalStepIndex(def, stepIndex)
  // Consent lives on the final SUBMIT surface: the recap when review is on,
  // otherwise the last step itself.
  const consentRequired = !!def.requireConsent
  const includeConsent = !showRecap && finalStep && consentRequired
  const fieldConfigs = currentStep ? buildFieldConfigs(def, currentStep.fields, includeConsent) : []
  // Consent config for the recap screen (built independently of any step's fields).
  const recapConsentConfigs = isRecap && consentRequired ? buildFieldConfigs(def, [], true) : []
  // Presentation (ADR-018 slice 7): full-width button + Option A progress bar.
  const fullWidth = def.fullWidthButton !== false
  // Progress counts the recap as one extra screen when enabled.
  const visibleTotal = def.steps.length - baseStep + (showRecap ? 1 : 0)
  const visibleCurrent = isRecap ? visibleTotal : stepIndex - baseStep + 1
  const progressPct = visibleTotal > 0 ? Math.round((visibleCurrent / visibleTotal) * 100) : 0

  const showBack = isRecap || editReturn || stepIndex > baseStep

  const advanceTo = (nextStepKey: string | null | undefined) => {
    const i = nextStepKey ? def.steps.findIndex((s) => s.key === nextStepKey) : -1
    if (i >= 0) setStepIndex(i)
  }

  const goBack = () => {
    if (status === 'submitting') return
    setErrors({})
    if (isRecap) { setStepIndex(lastRealIndex); return }
    if (editReturn) { setEditReturn(false); setStepIndex(recapIndex); return }
    setStepIndex((i) => Math.max(baseStep, i - 1))
  }

  const editStep = (i: number) => {
    setErrors({})
    setEditReturn(true)
    setStepIndex(i)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (status === 'submitting') return

    // ── Final submit from the recap screen ──────────────────────────────────
    if (isRecap) {
      if (consentRequired) {
        const consentErrors = validateForm(recapConsentConfigs, values, locale)
        if (Object.keys(consentErrors).length > 0) { setErrors(consentErrors); return }
      }
      setStatus('submitting')
      setErrors({})
      const lastKey = def.steps[lastRealIndex].key
      const data = stepValues(def.steps[lastRealIndex], values)
      const consent = consentRequired && values[CONSENT_FIELD_ID] === true
      try {
        const r = submissionId
          ? await postStep(submissionId, token, lastKey, data, consent)
          : await postCreate(data)
        if (!r) { setStatus('error'); return }
        if (r.done || r.ok) { setStatus('success'); return }
        // A non-final response here is unexpected for the last step; treat as sent.
        setStatus('success')
      } catch {
        setStatus('error')
      }
      return
    }

    if (!currentStep) return

    const validationErrors = validateForm(fieldConfigs, values, locale)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    setErrors({})

    // ── Editing a step reached from the recap ───────────────────────────────
    if (editReturn) {
      // The last step is only committed on the recap submit — just return to it.
      if (stepIndex === lastRealIndex) {
        setEditReturn(false)
        setStepIndex(recapIndex)
        return
      }
      // Earlier step: persist the change to the same row, then back to the recap.
      setStatus('submitting')
      const data = stepValues(currentStep, values)
      try {
        const r = submissionId
          ? await postStep(submissionId, token, currentStep.key, data, false)
          : await postCreate(data)
        if (!r) { setStatus('error'); return }
        if (r.submissionId && !submissionId) setSubmissionId(r.submissionId)
        if (r.completionToken) setToken(r.completionToken)
        setStatus('idle')
        setEditReturn(false)
        setStepIndex(recapIndex)
      } catch {
        setStatus('error')
      }
      return
    }

    // ── Normal forward flow ─────────────────────────────────────────────────
    // With a review screen, the last step defers its post to the recap submit.
    if (showRecap && stepIndex === lastRealIndex) {
      setStepIndex(recapIndex)
      return
    }

    setStatus('submitting')
    const data = stepValues(currentStep, values)
    const consent = includeConsent ? values[CONSENT_FIELD_ID] === true : false
    try {
      if (!submissionId) {
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
    const successTitle = applySuccessTemplate(def.successTitle, values)
    const successBody = applySuccessTemplate(def.successBody, values) ?? messages.successMessage
    return (
      <div className="py-8 text-center">
        {successTitle && <p className="text-[var(--color-text-primary)] text-lg font-medium">{successTitle}</p>}
        <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed mt-2">
          {successBody}
        </p>
      </div>
    )
  }

  if (!isRecap && !currentStep) return null

  const primaryLabel =
    status === 'submitting'
      ? messages.submitting
      : isRecap
        ? messages.submitLabel
        : editReturn
          ? messages.continueLabel
          : showRecap
            ? messages.continueLabel // last step advances to the recap; earlier steps continue
            : finalStep
              ? messages.submitLabel
              : messages.continueLabel

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-0">
      <div className="mb-6">
        {visibleTotal > 1 && (
          <div className="mb-3">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[var(--color-text-secondary)] text-xs font-medium uppercase tracking-wide">
                {isRecap
                  ? messages.reviewTitle
                  : messages.stepLabel
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
        {!isRecap && currentStep?.title && (
          <h3 className="text-[var(--color-text-primary)] text-lg font-medium mt-1">{currentStep.title}</h3>
        )}
        {/* Authored step description — renders only when the step has one, so
            every existing form is unchanged. `whitespace-pre-line` honours the
            hard line breaks authors type in the Studio text field. */}
        {!isRecap && currentStep?.description && (
          <p className="text-[var(--color-text-secondary)] text-sm leading-relaxed mt-1.5 whitespace-pre-line">
            {currentStep.description}
          </p>
        )}
      </div>

      {isRecap ? (
        /* ── Review / recap screen ──────────────────────────────────────────── */
        <div className="space-y-5">
          {def.steps.map((step, i) => {
            const rows = step.fields.filter((f) => f.type !== 'hidden')
            if (rows.length === 0) return null
            return (
              <div
                key={step.key}
                className="rounded-[var(--radius-btn)] p-4"
                style={{ border: '1px solid color-mix(in oklch, var(--color-border, var(--border)) 55%, transparent)' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[var(--color-text-secondary)] text-xs font-semibold uppercase tracking-wide">
                    {step.title ?? ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => editStep(i)}
                    className="text-xs font-semibold underline underline-offset-2"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    {messages.editLabel}
                  </button>
                </div>
                <dl className="space-y-1.5">
                  {rows.map((f) => (
                    <div key={f.id} className="flex gap-3 text-sm">
                      <dt className="w-2/5 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>{f.label}</dt>
                      <dd className="flex-1 text-[var(--color-text-primary)] break-words">{formatFieldValue(f, values[f.id])}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )
          })}

          {/* Consent — the recap is the true submit point, so consent lives here. */}
          {recapConsentConfigs.map((config) => (
            <div key={config.id} className="mt-1">
              <FormField
                config={config}
                value={values[config.id]}
                onChange={(val) => handleChange(config.id, val)}
                error={errors[config.id]}
              />
            </div>
          ))}
        </div>
      ) : (
        /* ── Step screen ────────────────────────────────────────────────────── */
        <>
          <div className="grid grid-cols-12 gap-5">
            {fieldConfigs.filter((c) => c.id !== CONSENT_FIELD_ID).map((config) => {
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

          {/* Required-fields hint — shown before the consent checkbox / submit. */}
          {fieldConfigs.some((c) => c.id !== CONSENT_FIELD_ID && c.required) && (
            <p className="mt-4 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {messages.requiredHint}
            </p>
          )}

          {/* Consent — inline on the last step only when there is no recap. */}
          {fieldConfigs
            .filter((c) => c.id === CONSENT_FIELD_ID)
            .map((config) => (
              <div key={config.id} className="mt-5">
                <FormField
                  config={config}
                  value={values[config.id]}
                  onChange={(val) => handleChange(config.id, val)}
                  error={errors[config.id]}
                />
              </div>
            ))}
        </>
      )}

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
        <div className={showBack ? 'flex items-center gap-3' : undefined}>
          {showBack && (
            <button
              type="button"
              onClick={goBack}
              disabled={status === 'submitting'}
              className="inline-flex items-center justify-center rounded-[var(--radius-btn)] px-5 py-3.5 text-sm font-semibold transition-all disabled:opacity-60"
              style={{
                border: '1px solid color-mix(in oklch, var(--color-border, var(--border)) 70%, transparent)',
                color: 'var(--color-text-primary)',
                backgroundColor: 'transparent',
              }}
            >
              {messages.backLabel}
            </button>
          )}
          <button
            type="submit"
            disabled={status === 'submitting'}
            className={`${fullWidth || showBack ? 'flex-1 ' : ''}inline-flex items-center justify-center rounded-[var(--radius-btn)] px-6 py-3.5 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] text-sm font-semibold transition-all disabled:opacity-60 hover:bg-[var(--btn-primary-hover-bg)]`}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </form>
  )
}
