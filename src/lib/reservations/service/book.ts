// ── Reservations — createBooking (ADR-044 D3, D5, D8, D9, D10, D11, D16) ──────
import { localOf } from '@/lib/scheduling/time'
import { holdExpiresAt } from '../holds'
import { passValidity } from '../passes'
import { cleanProjectCode, generateReference } from '../reference'
import type { PassOption } from '../types'
import type { BookingAttendeeInput, BookingLineInput, BookingPassInput, BookableStatus, OutboxInput } from '../server/payload'
import type { Actor, BookingOptionRow, LocalizedText } from '../server/types'
import { resolvePrice, type PriceCategory, type SessionPrice } from './prices'
import {
  fromStoreError, loadRuleContext, makeIntent, mintToken, randomIntFrom, recipientsOf, refuse, succeed,
  type ServiceDeps, type ServiceResult, type SessionInfo, type TargetRef,
} from './types'

export type CreateBookingAttendee = BookingAttendeeInput & {
  /** Age in whole years when known (the form asks; date of birth is never stored). */
  age?: number | null
}

export type CreateBookingInput = {
  projectId: string
  /** Fallback reference prefix when settings.referencePrefix is empty. */
  projectSlug?: string
  /** IANA project time zone. */
  timeZone: string
  target: TargetRef
  optionId: string
  locale: string
  source: 'website' | 'dashboard'
  idempotencyKey: string
  purchaser: { name?: string | null; email?: string | null; phone?: string | null; consent?: Record<string, unknown> | null }
  attendees: CreateBookingAttendee[]
  /** Sessions (kind sessions / full_edition / drop_in). Empty for a pass. */
  sessions?: SessionInfo[]
  sessionPrices?: SessionPrice[]
  priceCategories?: PriceCategory[]
  /** 'bank_transfer' asks for a held booking; omitted = pay later by transfer if the total is > 0. */
  paymentMethod?: 'bank_transfer'
  /** Pass start 'YYYY-MM-DD' (default: today in the project zone). */
  passStartDate?: string | null
  snapshot?: Record<string, unknown>
  formSubmissionId?: string | null
  actor?: Actor
  /** Dashboard only. */
  allowOverCapacity?: boolean
}

export type CreateBookingResult = {
  bookingId: string
  reference: string
  status: BookableStatus
  totalCents: number
  holdExpiresAt: string | null
  /** In clear exactly once; null when the call was an idempotent replay (the first call had it). */
  managementToken: string | null
  passTokens: Array<{ attendeeKey: string; token: string }>
  replayed: boolean
}

const MAX_REFERENCE_TRIES = 5

function passOptionOf(o: BookingOptionRow): PassOption | null {
  if (o.passValidity === 'fixed_end' && o.passValidTo) return { validity: { kind: 'fixed_end', endDate: o.passValidTo.slice(0, 10) }, scope: { kind: 'all_courses' } }
  if (o.passValidity === 'duration' && o.passDurationMonths) return { validity: { kind: 'duration', months: o.passDurationMonths }, scope: { kind: 'all_courses' } }
  return null
}

export async function createBooking(input: CreateBookingInput, deps: ServiceDeps): Promise<ServiceResult<CreateBookingResult>> {
  const now = deps.now()
  const today = localOf(now.toISOString(), input.timeZone).slice(0, 10)
  const sessions = input.sessions ?? []
  const dashboard = input.source === 'dashboard'

  const ctx = await loadRuleContext(deps, input.projectId, input.target)
  if (!ctx.ok) return ctx
  const { settings, target, rules } = ctx.value

  // Registration window (the database also checks the status flag).
  if (!dashboard) {
    if (target.registrationStatus !== 'open') return refuse('registration_closed')
    if (target.opensAt && new Date(target.opensAt).getTime() > now.getTime()) return refuse('registration_not_open')
    if (target.closesAt && new Date(target.closesAt).getTime() <= now.getTime()) return refuse('registration_closed')
  }

  const opts = await deps.store.listOptions(input.projectId, target.id)
  if (!opts.ok) return fromStoreError(opts.error)
  const option = opts.value.find((o) => o.id === input.optionId)
  if (!option || option.status !== 'active') return refuse('option_not_available')

  if (!input.attendees.length) return refuse('attendees_required')

  // Option kind vs sessions.
  const isPass = option.kind === 'pass'
  if (isPass) {
    if (sessions.length) return refuse('option_kind_mismatch')
  } else {
    if (!sessions.length) return refuse('sessions_required')
    if (option.kind === 'drop_in' && sessions.length !== 1) return refuse('option_kind_mismatch')
    const ids = new Set<string>()
    for (const s of sessions) {
      if (ids.has(s.occurrenceId)) return refuse('duplicate_session')
      ids.add(s.occurrenceId)
      if (option.sessionIds && !option.sessionIds.includes(s.occurrenceId)) return refuse('session_not_in_option')
      if (!dashboard && new Date(s.startsAt).getTime() <= now.getTime()) return refuse('session_started')
    }
  }

  // Attendees: age limits, guardian for minors, membership declaration.
  const seen = new Set<string>()
  let eligibilityReview = false
  for (const a of input.attendees) {
    if (!a.key || seen.has(a.key)) return refuse('attendee_key_invalid')
    seen.add(a.key)
    if (a.isMinor && !a.guardian) return refuse('guardian_required')
    if (option.minAge != null || option.maxAge != null) {
      if (a.age == null) {
        if (!(a.isMinor && option.minAge == null)) return refuse('age_required')
      } else {
        if (option.minAge != null && a.age < option.minAge) return refuse('age_out_of_range')
        if (option.maxAge != null && a.age > option.maxAge) return refuse('age_out_of_range')
      }
    }
    if (a.age != null && a.isMinor === false && a.age < 18) return refuse('minor_flag_required')
    if (a.age != null && a.age >= 18 && a.isMinor) return refuse('minor_flag_inconsistent')
  }

  // Lines / total.
  const lines: BookingLineInput[] = []
  const attendees: BookingAttendeeInput[] = []
  for (const a of input.attendees) {
    const { age: _age, ...rest } = a
    void _age
    let attendeeReview = false
    const cat = a.priceCategoryId ? input.priceCategories?.find((c) => c.id === a.priceCategoryId) : undefined
    if (a.priceCategoryId && !cat && input.priceCategories) return refuse('price_category_unknown')

    if (isPass) {
      const p = resolvePrice({ option, priceCategoryId: a.priceCategoryId ?? null, bookingDate: today, categories: input.priceCategories })
      if (!p.ok) return refuse(p.code)
      attendeeReview = p.eligibilityReview
      lines.push({ attendeeKey: a.key, kind: 'item', label: option.label, quantity: 1, unitCents: p.amountCents, amountCents: p.amountCents })
    } else if (option.kind === 'full_edition') {
      const p = resolvePrice({ option, priceCategoryId: a.priceCategoryId ?? null, bookingDate: today, categories: input.priceCategories })
      if (!p.ok) return refuse(p.code)
      attendeeReview = p.eligibilityReview
      lines.push({ attendeeKey: a.key, kind: 'item', label: option.label, quantity: 1, unitCents: p.amountCents, amountCents: p.amountCents })
    } else {
      // sessions / drop_in: the price is per session; equal prices fold into one line.
      const byAmount = new Map<number, number>()
      for (const s of sessions) {
        const p = resolvePrice({
          option, priceCategoryId: a.priceCategoryId ?? null, bookingDate: today, occurrenceId: s.occurrenceId,
          sessionPrices: input.sessionPrices, categories: input.priceCategories,
        })
        if (!p.ok) return refuse(p.code)
        attendeeReview = p.eligibilityReview
        byAmount.set(p.amountCents, (byAmount.get(p.amountCents) ?? 0) + 1)
      }
      for (const [unit, qty] of byAmount) {
        lines.push({ attendeeKey: a.key, kind: 'item', label: option.label, quantity: qty, unitCents: unit, amountCents: unit * qty })
      }
    }
    if (attendeeReview) {
      if (a.declaredEligible !== true) return refuse('membership_declaration_required')
      eligibilityReview = true
    }
    attendees.push({
      ...rest,
      declaredEligible: attendeeReview ? true : (a.declaredEligible ?? null),
      eligibilityResult: attendeeReview ? 'pending' : (a.eligibilityResult ?? null),
    })
  }
  const totalCents = lines.reduce((n, l) => n + l.amountCents, 0)

  // Passes: validity computed here, the database re-checks against the option.
  const passes: BookingPassInput[] = []
  const passTokens: Array<{ attendeeKey: string; token: string }> = []
  if (isPass) {
    const po = passOptionOf(option)
    if (!po) return refuse('option_misconfigured')
    const start = input.passStartDate ?? today
    if (start < today && !dashboard) return refuse('pass_start_in_past')
    for (const a of input.attendees) {
      let w
      try { w = passValidity(po, today, start) } catch { return refuse('pass_dates_invalid') }
      const t = mintToken(deps)
      passTokens.push({ attendeeKey: a.key, token: t.token })
      passes.push({ attendeeKey: a.key, optionId: option.id, validFrom: w.validFrom, validTo: w.validTo, tokenHash: t.hash })
    }
  }

  // Status and hold.
  let status: BookableStatus
  let hold: Date | null = null
  if (totalCents === 0) {
    status = 'confirmed'
  } else if (rules.acceptBankTransfer) {
    status = 'awaiting_payment'
    const first = sessions.length ? new Date(Math.min(...sessions.map((s) => new Date(s.startsAt).getTime()))) : null
    try {
      hold = holdExpiresAt({
        bookedAt: now, holdDays: rules.holdDays, registrationClosesAt: target.closesAt ? new Date(target.closesAt) : null,
        firstSessionStartsAt: first, cutoffHours: rules.cutoffHoursBeforeFirstSession,
      })
    } catch { return refuse('hold_invalid') }
    if (hold.getTime() <= now.getTime()) return refuse('hold_window_closed')
  } else {
    return refuse('payment_method_not_available')
  }
  if (input.paymentMethod === 'bank_transfer' && totalCents > 0 && !rules.acceptBankTransfer) return refuse('payment_method_not_available')

  // Reference prefix.
  let prefix: string
  try { prefix = cleanProjectCode(settings.referencePrefix || input.projectSlug || '') } catch { return refuse('invalid_project_code') }

  const mgmt = mintToken(deps)
  const intentName = status === 'confirmed' ? 'booking.confirmed' : 'booking.awaiting_payment'
  const random = (max: number) => randomIntFrom(deps, max)

  for (let attempt = 0; attempt < MAX_REFERENCE_TRIES; attempt++) {
    const reference = generateReference(prefix, random)
    const outbox: OutboxInput[] = []
    if (input.purchaser.email) {
      outbox.push(makeIntent(deps, {
        intent: intentName,
        dedupeKey: `${intentName}:${input.idempotencyKey}`,
        recipients: recipientsOf({ email: input.purchaser.email, name: input.purchaser.name ?? null }),
        locale: input.locale,
        payload: {
          reference, totalCents, status, holdExpiresAt: hold ? hold.toISOString() : null,
          managementToken: mgmt.token, passTokens,
        },
      }))
    }
    const res = await deps.store.book(input.projectId, {
      targetId: target.id,
      optionId: option.id,
      attendees,
      sessions: sessions.flatMap((s) => input.attendees.map((a) => ({ attendeeKey: a.key, occurrenceId: s.occurrenceId }))),
      passes,
      lines,
      totalCents,
      status,
      holdExpiresAt: hold,
      managementTokenHash: mgmt.hash,
      idempotencyKey: input.idempotencyKey,
      reference,
      locale: input.locale,
      source: input.source,
      purchaser: input.purchaser,
      snapshot: input.snapshot ?? { optionLabel: option.label as LocalizedText },
      flags: { eligibilityReview },
      allowOverCapacity: dashboard ? input.allowOverCapacity ?? false : false,
      actor: input.actor ?? { kind: dashboard ? 'user' : 'participant' },
      formSubmissionId: input.formSubmissionId ?? null,
      outbox,
    })
    if (res.ok) {
      const replayed = res.value.replayed
      return succeed({
        bookingId: res.value.bookingId,
        reference: res.value.reference,
        status,
        totalCents,
        holdExpiresAt: hold ? hold.toISOString() : null,
        managementToken: replayed ? null : mgmt.token,
        passTokens: replayed ? [] : passTokens,
        replayed,
      })
    }
    const e = res.error
    if (e.kind === 'conflict' && e.code === 'reference_taken') continue
    return fromStoreError(e)
  }
  return refuse('reference_unavailable')
}
