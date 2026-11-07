// ── Reservations — the reservations_book payload builder (ADR-044, 066) ───────
//
// Pure: domain-level BookingRequest in, the exact snake_case JSON that
// public.reservations_book(p_project_id, p_payload) reads out (see the comment
// above that function in migration 066). Validates what is cheap to check
// before a round trip — in particular total = sum(lines) — and answers with the
// same `refused` codes the database would raise, so callers handle one shape.
import { assertCents } from '../money'
import { isValidReferenceFormat } from '../reference'
import { ReservationError as DomainError, type BookingSource, type PassScope } from '../types'
import { fail, ok, type Result } from './errors'
import type { Actor, LocalizedText } from './types'

export type BookableStatus = 'pending' | 'held' | 'awaiting_payment' | 'confirmed'

export type BookingAttendeeInput = {
  /** Local key, referenced by sessions / passes / lines. Unique in the request. */
  key: string
  name?: string | null
  email?: string | null
  isMinor?: boolean
  /** Required when isMinor (the database refuses a minor without a guardian). */
  guardian?: Record<string, unknown> | null
  priceCategoryId?: string | null
  declaredEligible?: boolean | null
  eligibilityResult?: 'pending' | 'verified' | 'rejected' | null
  eligibilityRule?: Record<string, unknown> | null
  formSubmissionId?: string | null
}

export type BookingPassInput = {
  attendeeKey: string
  optionId: string
  /** The domain scopes plus 'target' (the pass covers the target it was sold on). */
  scope: PassScope | { kind: 'target' }
  /** 'YYYY-MM-DD', inclusive, project time zone. */
  validFrom: string
  validTo: string
  entriesTotal?: number | null
  tokenHash?: string | null
}

export type BookingLineInput = {
  attendeeKey?: string | null
  kind: 'item' | 'adjustment'
  label: LocalizedText
  quantity?: number
  unitCents: number
  amountCents: number
}

export type OutboxInput = {
  intent: string
  dedupeKey: string
  recipients: unknown[]
  locale: string
  payload?: Record<string, unknown>
  environment: 'production' | 'preview' | 'development'
}

export type BookingRequest = {
  targetId: string
  optionId?: string | null
  attendees: BookingAttendeeInput[]
  /** One allocation per attendee x session. */
  sessions: Array<{ attendeeKey: string; occurrenceId: string }>
  passes?: BookingPassInput[]
  lines: BookingLineInput[]
  totalCents: number
  status: BookableStatus
  /** Required (future) for held / awaiting_payment; ignored otherwise. */
  holdExpiresAt?: Date | string | null
  /** sha256 hex of the management token; the token itself never reaches the database. */
  managementTokenHash?: string | null
  idempotencyKey: string
  reference: string
  locale: string
  source: BookingSource
  purchaser?: { name?: string | null; email?: string | null; phone?: string | null; consent?: Record<string, unknown> | null }
  snapshot?: Record<string, unknown>
  flags?: { paymentReview?: boolean; eligibilityReview?: boolean }
  /** Dashboard only. */
  allowOverCapacity?: boolean
  actor?: Actor
  contactId?: string | null
  formSubmissionId?: string | null
  outbox?: OutboxInput[]
}

const HASH = /^[0-9a-f]{64}$/
const LOCALE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/
const MAX_CENTS = 100_000_000

const refuse = (code: string, detail?: string) => fail({ kind: 'refused', code, ...(detail ? { detail } : {}) })

function holdIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * `now` is injectable for tests. Returns the payload object (JSON-safe) or the
 * refusal the database would have raised.
 */
export function buildBookPayload(req: BookingRequest, now: Date = new Date()): Result<Record<string, unknown>> {
  if (typeof req.idempotencyKey !== 'string' || req.idempotencyKey.length < 8 || req.idempotencyKey.length > 200) {
    return refuse('idempotency_key_required')
  }
  // The database accepts a wider reference shape; we only ever mint the domain one.
  if (!isValidReferenceFormat(req.reference)) return refuse('invalid_reference')
  if (!LOCALE.test(req.locale)) return refuse('invalid_locale')
  if (req.source !== 'website' && req.source !== 'dashboard') return refuse('invalid_source')
  if (!['pending', 'held', 'awaiting_payment', 'confirmed'].includes(req.status)) return refuse('invalid_status')
  if (req.allowOverCapacity && req.source !== 'dashboard') return refuse('over_capacity_dashboard_only')
  if (req.managementTokenHash && !HASH.test(req.managementTokenHash)) return refuse('invalid_token_hash')

  const holding = req.status === 'held' || req.status === 'awaiting_payment'
  const hold = holdIso(req.holdExpiresAt)
  if (holding && (!hold || new Date(hold).getTime() <= now.getTime())) return refuse('hold_expiry_required')

  if (!req.attendees?.length) return refuse('attendees_required')
  const keys = new Set<string>()
  for (const a of req.attendees) {
    if (!a.key || keys.has(a.key)) return refuse('attendee_key_invalid')
    keys.add(a.key)
    if (a.isMinor && !a.guardian) return refuse('guardian_required')
  }
  const passes = req.passes ?? []
  if (!req.sessions?.length && !passes.length) return refuse('nothing_to_book')

  const seen = new Set<string>()
  for (const s of req.sessions ?? []) {
    if (!keys.has(s.attendeeKey)) return refuse('attendee_key_invalid')
    const k = `${s.attendeeKey}|${s.occurrenceId}`
    if (seen.has(k)) return refuse('duplicate_allocation')
    seen.add(k)
  }
  for (const p of passes) {
    if (!keys.has(p.attendeeKey)) return refuse('attendee_key_invalid')
    if (p.validTo < p.validFrom) return refuse('invalid_pass_window')
    if (p.scope.kind === 'courses' && !p.scope.ownerPublicIds.length) return refuse('invalid_pass_scope')
    if (p.entriesTotal != null && (!Number.isInteger(p.entriesTotal) || p.entriesTotal < 1)) return refuse('invalid_pass_entries')
    if (p.tokenHash && !HASH.test(p.tokenHash)) return refuse('invalid_token_hash')
  }

  // Money: integer cents, lines add up to the total (the database checks again).
  let sum = 0
  try {
    assertCents(req.totalCents)
    if (req.totalCents < 0 || req.totalCents > MAX_CENTS) return refuse('invalid_cents')
    for (const l of req.lines) {
      assertCents(l.unitCents)
      assertCents(l.amountCents)
      const qty = l.quantity ?? 1
      if (!Number.isInteger(qty) || qty < 1 || qty > 10000) return refuse('invalid_quantity')
      if (l.amountCents !== l.unitCents * qty) return refuse('line_mismatch')
      if (l.kind === 'item' && l.amountCents < 0) return refuse('invalid_cents')
      if (l.attendeeKey != null && !keys.has(l.attendeeKey)) return refuse('attendee_key_invalid')
      sum += l.amountCents
    }
  } catch (e) {
    if (e instanceof DomainError) return refuse(e.code)
    throw e
  }
  if (sum !== req.totalCents) return refuse('total_mismatch', `${sum} != ${req.totalCents}`)

  const payload: Record<string, unknown> = {
    target_id: req.targetId,
    option_id: req.optionId ?? null,
    idempotency_key: req.idempotencyKey,
    reference: req.reference,
    status: req.status,
    locale: req.locale,
    source: req.source,
    purchaser: {
      name: req.purchaser?.name ?? null,
      email: req.purchaser?.email ?? null,
      phone: req.purchaser?.phone ?? null,
      consent: req.purchaser?.consent ?? null,
    },
    total_cents: req.totalCents,
    snapshot: req.snapshot ?? {},
    hold_expires_at: holding ? hold : null,
    management_token_hash: req.managementTokenHash ?? null,
    flags: {
      payment_review: req.flags?.paymentReview ?? false,
      eligibility_review: req.flags?.eligibilityReview ?? false,
    },
    allow_over_capacity: req.allowOverCapacity ?? false,
    actor: { kind: req.actor?.kind ?? 'participant', id: req.actor?.id ?? null },
    contact_id: req.contactId ?? null,
    form_submission_id: req.formSubmissionId ?? null,
    attendees: req.attendees.map((a) => ({
      key: a.key,
      name: a.name ?? null,
      email: a.email ?? null,
      is_minor: a.isMinor ?? false,
      guardian: a.guardian ?? null,
      price_category_id: a.priceCategoryId ?? null,
      declared_eligible: a.declaredEligible ?? null,
      eligibility_result: a.eligibilityResult ?? null,
      eligibility_rule: a.eligibilityRule ?? null,
      form_submission_id: a.formSubmissionId ?? null,
    })),
    allocations: (req.sessions ?? []).map((s) => ({ attendee_key: s.attendeeKey, occurrence_id: s.occurrenceId })),
    passes: passes.map((p) => ({
      attendee_key: p.attendeeKey,
      option_id: p.optionId,
      scope: p.scope.kind === 'courses' ? 'courses' : p.scope.kind === 'all_courses' ? 'all_courses' : 'target',
      scope_owner_ids: p.scope.kind === 'courses' ? p.scope.ownerPublicIds : null,
      valid_from: p.validFrom,
      valid_to: p.validTo,
      entries_total: p.entriesTotal ?? null,
      management_token_hash: p.tokenHash ?? null,
    })),
    lines: req.lines.map((l) => ({
      attendee_key: l.attendeeKey ?? null,
      kind: l.kind,
      label: l.label,
      quantity: l.quantity ?? 1,
      unit_cents: l.unitCents,
      amount_cents: l.amountCents,
    })),
    outbox: (req.outbox ?? []).map((o) => ({
      intent: o.intent,
      dedupe_key: o.dedupeKey,
      recipients: o.recipients,
      locale: o.locale,
      payload: o.payload ?? {},
      environment: o.environment,
    })),
  }
  return ok(payload)
}
