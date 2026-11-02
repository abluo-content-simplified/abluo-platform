/**
 * Validation of what a billing admin enters — ADR-041 D7, D9, D14. PURE.
 * Server actions call these after `requireBillingAdmin()` and before writing;
 * the database enforces the same rules again (migration 057 checks + the
 * activation-window trigger).
 */
import { ACTIVATION_MAX_DAYS, type BillingArrangement } from '@/lib/billing/lifecycle'
import { isIsoDate } from '@/lib/billing/dates'

export { romeDayStart, romeDayEnd } from '@/lib/billing/dates'

/** v1 bills in euro only (Tom, 2026-11-02); the column keeps other currencies possible. */
export const BILLING_CURRENCY = 'eur'
/** Upper bound for one agreed price, in cents (€ 1,000,000), against typos. */
export const MAX_AMOUNT_CENTS = 100_000_000

export type BillingTermsInput = {
  arrangement: BillingArrangement
  /** Net amount in cents (ADR-041 D14: agreed prices exclude VAT). */
  amountCents: number | null
  interval: 'month' | 'year' | null
  startsOn: string | null
  activationDueAt: Date | null
  activationExtensionReason: string | null
  manualPaidThrough: string | null
}

export type BillingTermsError =
  | 'arrangement'
  | 'amount'
  | 'interval'
  | 'startsOn'
  | 'activationDueRequired'
  | 'activationReasonRequired'
  | 'manualPaidThrough'

const DAY_MS = 86_400_000
const blank = (s: string | null | undefined) => !s || s.trim() === ''

/** Parse a euro amount typed by a person ("240", "240,00", "1.200,50", "1200.5") into cents; null if invalid. */
export function parseEuroToCents(input: string): number | null {
  const s = input.trim().replace(/\s|€/g, '')
  if (!/^\d{1,3}([.,]?\d{3})*([.,]\d{1,2})?$|^\d+([.,]\d{1,2})?$/.test(s)) return null
  // One separator followed by exactly three digits ("12,345", "1.200") is
  // ambiguous between Italian/English conventions — refuse rather than guess.
  if (/^\d+[.,]\d{3}$/.test(s)) return null
  const lastSep = Math.max(s.lastIndexOf(','), s.lastIndexOf('.'))
  const hasDecimals = lastSep >= 0 && s.length - lastSep - 1 <= 2
  const intPart = (hasDecimals ? s.slice(0, lastSep) : s).replace(/[.,]/g, '')
  const decPart = hasDecimals ? s.slice(lastSep + 1).padEnd(2, '0') : '00'
  const cents = Number(intPart) * 100 + Number(decPart)
  return Number.isSafeInteger(cents) && cents > 0 && cents <= MAX_AMOUNT_CENTS ? cents : null
}

/** All problems with the terms, in a stable order; [] means valid. */
export function validateBillingTerms(input: BillingTermsInput, now: Date): BillingTermsError[] {
  const errors: BillingTermsError[] = []
  if (!['stripe', 'manual', 'complimentary'].includes(input.arrangement)) return ['arrangement']
  const paid = input.arrangement !== 'complimentary'
  if (paid && (input.amountCents === null || !Number.isSafeInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > MAX_AMOUNT_CENTS)) errors.push('amount')
  if (paid && input.interval !== 'month' && input.interval !== 'year') errors.push('interval')
  if (input.startsOn !== null && !isIsoDate(input.startsOn)) errors.push('startsOn')
  if (input.arrangement === 'stripe' && !input.activationDueAt) errors.push('activationDueRequired')
  if (
    input.activationDueAt &&
    input.activationDueAt.getTime() > now.getTime() + ACTIVATION_MAX_DAYS * DAY_MS &&
    blank(input.activationExtensionReason)
  ) errors.push('activationReasonRequired')
  if (input.manualPaidThrough !== null && (input.arrangement !== 'manual' || !isIsoDate(input.manualPaidThrough))) errors.push('manualPaidThrough')
  return errors
}

export type OverrideInput = { override: 'none' | 'allow' | 'restrict'; until: Date | null; reason: string | null }
export type OverrideError = 'override' | 'reasonRequired' | 'untilInPast'

export function validateOverride(input: OverrideInput, now: Date): OverrideError[] {
  if (!['none', 'allow', 'restrict'].includes(input.override)) return ['override']
  if (input.override === 'none') return []
  const errors: OverrideError[] = []
  if (blank(input.reason)) errors.push('reasonRequired')
  if (input.until && input.until.getTime() <= now.getTime()) errors.push('untilInPast')
  return errors
}

// ── Billing profile (ADR-041 D9, D14) ───────────────────────────────────────

export type BillingProfileValue = {
  billingEmail: string | null
  customerType: 'business' | 'individual' | null
  legalName: string | null
  addressLine1: string | null
  addressLine2: string | null
  postalCode: string | null
  city: string | null
  region: string | null
  country: string | null
  vatId: string | null
}

export type BillingProfileField = keyof BillingProfileValue

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const COUNTRY_RE = /^[A-Z]{2}$/
const VAT_RE = /^[A-Z]{2}[A-Za-z0-9+*.]{2,14}$/
const PROFILE_MAX: Record<'legalName' | 'addressLine1' | 'addressLine2' | 'postalCode' | 'city' | 'region', number> = {
  legalName: 200, addressLine1: 200, addressLine2: 200, postalCode: 20, city: 100, region: 100,
}

const clean = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/**
 * Normalise and validate a client's billing details (mirrors the table checks in
 * migration 058). Blank → null; email lower-cased; country and VAT id upper-cased
 * with spaces removed. Returns the normalised value, or the offending field names.
 */
export function validateBillingProfile(
  input: Partial<Record<BillingProfileField, unknown>>,
): { ok: true; value: BillingProfileValue } | { ok: false; fields: BillingProfileField[] } {
  const fields: BillingProfileField[] = []
  // Anything that is not text (or empty) is a field error, never a crash.
  for (const key of ['billingEmail', 'legalName', 'addressLine1', 'addressLine2', 'postalCode', 'city', 'region', 'country', 'vatId'] as const) {
    const v = input[key]
    if (v !== null && v !== undefined && typeof v !== 'string') fields.push(key)
  }
  if (fields.length) return { ok: false, fields }
  const email = clean(input.billingEmail)?.toLowerCase() ?? null
  if (email !== null && (email.length > 320 || !EMAIL_RE.test(email))) fields.push('billingEmail')

  const rawType = input.customerType
  const customerType = rawType === 'business' || rawType === 'individual' ? rawType : null
  if (rawType !== null && rawType !== undefined && rawType !== '' && customerType === null) fields.push('customerType')

  const text = {} as Record<keyof typeof PROFILE_MAX, string | null>
  for (const key of Object.keys(PROFILE_MAX) as (keyof typeof PROFILE_MAX)[]) {
    text[key] = clean(input[key])
    if (text[key] !== null && text[key]!.length > PROFILE_MAX[key]) fields.push(key)
  }
  if (customerType === 'business' && text.legalName === null && !fields.includes('legalName')) fields.push('legalName')

  const country = clean(input.country)?.replace(/\s/g, '').toUpperCase() ?? null
  if (country !== null && !COUNTRY_RE.test(country)) fields.push('country')

  const vatId = clean(input.vatId)?.replace(/\s/g, '').toUpperCase() ?? null
  if (vatId !== null && !VAT_RE.test(vatId)) fields.push('vatId')

  if (fields.length) return { ok: false, fields }
  return { ok: true, value: { billingEmail: email, customerType, ...text, country, vatId } }
}
