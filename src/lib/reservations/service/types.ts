// ── Reservations — service layer: shared types and helpers (ADR-044) ──────────
//
// Pure orchestration between the domain helpers and the store. Everything is
// dependency-injected (store, clock, random bytes, environment), nothing throws
// for an expected outcome, and results carry MACHINE CODES only (no user text).
import { createHash } from 'crypto'
import { resolveRules, DEFAULT_BOOKING_RULES } from '../rules'
import { ReservationError as DomainError, type BookingRules, type BookingRulesOverride } from '../types'
import type { ReservationError as StoreError, Result } from '../server/errors'
import type { OutboxInput } from '../server/payload'
import type { BookingRow, ReservableTargetRow, ReservationSettingsRow, TargetOwnerType } from '../server/types'
import type { ReservationStore } from '../server/store'

export type Environment = 'production' | 'preview' | 'development'

// ── What the store must offer beyond ReservationStore ────────────────────────
// 066 gives no standalone outbox insert and no "who is on this session" read;
// the adapter needs these four small methods (see the hand-off notes).
export type OutboxRecipient = { email: string; name?: string | null }
export type OutboxItem = { bookingId: string | null; passId?: string | null; intent: OutboxInput }

/** A booking with an active (not released) allocation on a session. */
export type AffectedBooking = {
  bookingId: string
  name: string | null
  email: string | null
  locale: string
  /** Set when the allocation is a pass attendance (the booking holds a pass). */
  passId: string | null
  totalCents: number
  paymentStatus: BookingRow['paymentStatus']
  /** Active sessions the booking has in total (for the proportional refund). */
  sessionCount: number
}

export type NoticeScope = { kind: 'session'; occurrenceIds: string[] } | { kind: 'target'; targetId: string }
export type NoticeRecipient = { bookingId: string; name: string | null; email: string | null; locale: string }

export type ServiceStore = ReservationStore & {
  getBookingById(projectId: string, bookingId: string): Promise<Result<BookingRow | null>>
  enqueueOutbox(projectId: string, items: OutboxItem[]): Promise<Result<{ queued: number }>>
  listAffectedBookings(projectId: string, occurrenceIds: string[]): Promise<Result<AffectedBooking[]>>
  listNoticeRecipients(projectId: string, scope: NoticeScope): Promise<Result<NoticeRecipient[]>>
}

export type ServiceDeps = {
  store: ServiceStore
  now: () => Date
  /** Cryptographically secure bytes (production: crypto.randomBytes). */
  randomBytes: (n: number) => Uint8Array
  environment: Environment
  /** Outside production, mail goes only here (D16.5); absent = intents are skipped. */
  testRecipient?: string
}

// ── Results ──────────────────────────────────────────────────────────────────
export type Failure = { ok: false; code: string; occurrenceIds?: string[]; detail?: string }
export type Success<T> = { ok: true; value: T }
export type ServiceResult<T> = Success<T> | Failure

export const succeed = <T>(value: T): Success<T> => ({ ok: true, value })
export const refuse = (code: string, extra: Omit<Failure, 'ok' | 'code'> = {}): Failure => ({ ok: false, code, ...extra })

/** Maps a store failure to one machine code. */
export function fromStoreError(e: StoreError): Failure {
  switch (e.kind) {
    case 'full': return refuse('full', { occurrenceIds: e.occurrenceIds })
    case 'conflict': return refuse(e.code, e.detail ? { detail: e.detail } : {})
    case 'refused': return refuse(e.code, e.detail ? { detail: e.detail } : {})
    case 'not_found': return refuse(e.code === 'unknown' ? 'not_found' : e.code)
    case 'unavailable': return refuse('unavailable')
  }
}

// ── Session facts the caller supplies (scheduling is not the store's business) ─
export type SessionInfo = {
  occurrenceId: string
  /** UTC ISO instant. */
  startsAt: string
  ownerType: 'event' | 'course'
  ownerPublicId: string
  /** Session-level Booking-rules override (D9 / D16.14), if any. */
  rulesOverride?: BookingRulesOverride | null
}

export type TargetRef = { ownerType: TargetOwnerType; ownerPublicId: string | null; editionId?: string | null }

export const HOUR = 3_600_000

// ── Rules ────────────────────────────────────────────────────────────────────
export function projectRulesOf(settings: ReservationSettingsRow): BookingRules {
  return resolveRules(DEFAULT_BOOKING_RULES as BookingRules, settings.rules)
}

export async function loadRuleContext(
  deps: ServiceDeps, projectId: string, ref: TargetRef,
): Promise<ServiceResult<{ settings: ReservationSettingsRow; target: ReservableTargetRow; rules: BookingRules }>> {
  const s = await deps.store.getSettings(projectId)
  if (!s.ok) return fromStoreError(s.error)
  if (!s.value) return refuse('settings_missing')
  const t = await deps.store.getTarget(projectId, ref.ownerType, ref.ownerPublicId, ref.editionId ?? null)
  if (!t.ok) return fromStoreError(t.error)
  if (!t.value) return refuse('target_not_found')
  const rules = resolveRules(projectRulesOf(s.value), t.value.rulesOverride)
  return succeed({ settings: s.value, target: t.value, rules })
}

export const sessionRules = (base: BookingRules, session: Pick<SessionInfo, 'rulesOverride'>): BookingRules =>
  resolveRules(base, session.rulesOverride ?? null)

// ── Tokens and randomness ────────────────────────────────────────────────────
/** 32 random bytes → 43-char base64url (same shape as generateSessionToken). */
export function mintToken(deps: Pick<ServiceDeps, 'randomBytes'>): { token: string; hash: string } {
  const bytes = deps.randomBytes(32)
  const token = Buffer.from(bytes).toString('base64url')
  return { token, hash: sha256(token) }
}

export const sha256 = (v: string): string => createHash('sha256').update(v, 'utf8').digest('hex')

/** Unbiased integer in [0, max) from the injected byte source (rejection sampling). */
export function randomIntFrom(deps: Pick<ServiceDeps, 'randomBytes'>, max: number): number {
  const limit = Math.floor(256 / max) * max
  for (;;) {
    for (const b of deps.randomBytes(16)) if (b < limit) return b % max
  }
}

export function noticeIdFrom(deps: Pick<ServiceDeps, 'randomBytes'>): string {
  return Buffer.from(deps.randomBytes(8)).toString('hex')
}

// ── Outbox shaping (D10, D16.5) ──────────────────────────────────────────────
export function makeIntent(
  deps: Pick<ServiceDeps, 'environment' | 'testRecipient'>,
  input: { intent: string; dedupeKey: string; recipients: OutboxRecipient[]; locale: string; payload?: Record<string, unknown> },
): OutboxInput {
  const base = { intent: input.intent, dedupeKey: input.dedupeKey, locale: input.locale, environment: deps.environment }
  if (deps.environment === 'production') {
    return { ...base, recipients: input.recipients, payload: input.payload ?? {} }
  }
  if (deps.testRecipient) {
    return {
      ...base,
      recipients: [{ email: deps.testRecipient, name: null }],
      payload: { ...(input.payload ?? {}), testRedirect: true, originalRecipientCount: input.recipients.length },
    }
  }
  // Non-production without a test recipient: nobody may be mailed; the consumer skips it.
  return { ...base, recipients: [], payload: { ...(input.payload ?? {}), skip: 'non_production_no_test_recipient' } }
}

export const recipientsOf = (b: { email: string | null; name: string | null }): OutboxRecipient[] =>
  b.email ? [{ email: b.email, name: b.name }] : []

/** Never throws for the date helpers of the domain; turns their error into a code. */
export function domainCode(e: unknown): string | null {
  return e instanceof DomainError ? e.code : null
}
