// Server-only: service role; never import from a client component.
// ── Reservations — the thin adapter over the 066 functions (ADR-044) ──────────
//
// Writes call the plpgsql functions of migration 066 (places are decided there,
// under row locks); reads are plain selects. EVERY call carries project_id, and
// every read filters on it — the tables are server-only and this adapter is the
// isolation boundary. The only exceptions are the two management-token lookups
// (the caller has just the token) which return project_id so the caller MUST
// compare it with the project it is serving.
//
// Results are values, never throws, for expected failures: see errors.ts. A
// 066-not-applied database answers `unavailable`.
import { fail, ok, parseReservationError, type DbErrorLike, type Result } from './errors'
import { buildBookPayload, type BookingRequest } from './payload'
import type { AffectedBooking, NoticeRecipient, ServiceStore } from '../service/types'
import type {
  Actor, BookResult, BookingOptionRow, BookingRow, ConfirmResult, ExpiredHold, LinkAttemptResult,
  OptionPriceRow, PassAttendResult, PassRow, PassWithdrawResult, RecordPaymentResult, ReleaseResult,
  ReservableTargetRow, ReservationSettingsRow, SessionAvailability, SetPlacesResult, TargetOwnerType,
} from './types'

/** The slice of the supabase client used here (kept loose so a fake can stand in). */
export type ReservationDb = {
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
  rpc: (fn: string, args: Record<string, unknown>) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type ReleaseReason = 'cancelled' | 'absence' | 'organiser_cancelled' | 'session_removed' | 'replaced'
export type PaymentMethodInput = 'bank_transfer' | 'cash' | 'other'

export type ReservationStore = {
  book(projectId: string, request: BookingRequest | Record<string, unknown>): Promise<Result<BookResult>>
  passAttend(projectId: string, passId: string, occurrenceId: string, opts?: { actor?: Actor; allowOverCapacity?: boolean }): Promise<Result<PassAttendResult>>
  passWithdraw(projectId: string, passId: string, occurrenceId: string, opts: { returnEntry: boolean; actor?: Actor }): Promise<Result<PassWithdrawResult>>
  release(projectId: string, bookingId: string, reason: ReleaseReason, opts?: { occurrenceIds?: string[] | null; cancelBooking?: boolean; actor?: Actor; note?: string | null }): Promise<Result<ReleaseResult>>
  confirm(projectId: string, bookingId: string, actor?: Actor): Promise<Result<ConfirmResult>>
  extendHold(projectId: string, bookingId: string, until: Date | string, actor?: Actor): Promise<Result<{ extended: boolean }>>
  recordPayment(projectId: string, bookingId: string, input: { method: PaymentMethodInput; amountCents: number; paidOn: string; reference?: string | null; note?: string | null; actor?: Actor }): Promise<Result<RecordPaymentResult>>
  setPlaces(projectId: string, occurrenceId: string, places: number | null, opts?: { force?: boolean; actor?: Actor }): Promise<Result<SetPlacesResult>>
  /** Sweep over ALL projects (cron); the function has no project argument by design. */
  expireHolds(now?: Date): Promise<Result<ExpiredHold[]>>
  anonymiseBooking(projectId: string, bookingId: string, actor?: Actor): Promise<Result<{ anonymised: boolean }>>
  reserveLinkAttempt(projectId: string | null, ipHash: string, windowSeconds: number, perIp: number): Promise<Result<LinkAttemptResult>>
  finishLinkAttempt(attemptId: number, succeeded: boolean): Promise<Result<true>>

  getSettings(projectId: string): Promise<Result<ReservationSettingsRow | null>>
  getTarget(projectId: string, ownerType: TargetOwnerType, ownerPublicId: string | null, editionId?: string | null): Promise<Result<ReservableTargetRow | null>>
  /** Active options by default (public); `status: 'all'` for the dashboard. Archived never. */
  listOptions(projectId: string, targetId: string, opts?: { status?: 'active' | 'all' }): Promise<Result<BookingOptionRow[]>>
  getBookingByReference(projectId: string, reference: string): Promise<Result<BookingRow | null>>
  /** Not project-scoped (the token is the credential): compare `projectId` of the result. */
  getBookingByTokenHash(tokenHash: string): Promise<Result<BookingRow | null>>
  getPassByTokenHash(tokenHash: string): Promise<Result<PassRow | null>>
  sessionAvailability(projectId: string, occurrenceIds: string[], opts?: { defaultPlaces?: number | null; now?: Date }): Promise<Result<SessionAvailability[]>>
}

// ── helpers ──────────────────────────────────────────────────────────────────
type Row = Record<string, unknown>
const str = (v: unknown): string => String(v ?? '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const obj = <T,>(v: unknown): T | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null)
const strArr = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : null)
const iso = (v: unknown): string | null => (typeof v === 'string' && v ? new Date(v).toISOString() : null)
const actorJson = (a: Actor | undefined, fallback: Actor['kind']) => ({ kind: a?.kind ?? fallback, id: a?.id ?? null })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/
const CHUNK = 25
const ID_CHUNK = 50
const NOTICE_LIMIT = 2000

const refused = (code: string) => fail({ kind: 'refused', code })
const unavailable = () => fail({ kind: 'unavailable' })

function settingsOf(r: Row): ReservationSettingsRow {
  return {
    projectId: str(r.project_id),
    rules: obj(r.rules) ?? {},
    bankDetails: obj(r.bank_details),
    paymentInstructions: obj(r.payment_instructions),
    termsNote: obj(r.terms_note),
    referencePrefix: strOrNull(r.reference_prefix),
    supportAccessUntil: iso(r.support_access_until),
    version: Number(r.version) || 1,
  }
}

function targetOf(r: Row): ReservableTargetRow {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    ownerType: r.owner_type as TargetOwnerType,
    ownerPublicId: strOrNull(r.owner_public_id),
    editionId: strOrNull(r.edition_id),
    registrationStatus: r.registration_status === 'open' ? 'open' : 'closed',
    opensAt: iso(r.opens_at),
    closesAt: iso(r.closes_at),
    minParticipants: numOrNull(r.min_participants),
    minDecisionAt: iso(r.min_decision_at),
    defaultPlaces: numOrNull(r.default_places),
    maxPasses: numOrNull(r.max_passes),
    includeNewSessions: r.include_new_sessions === true,
    rulesOverride: obj(r.rules_override),
    version: Number(r.version) || 1,
  }
}

function priceOf(r: Row): OptionPriceRow {
  return {
    id: str(r.id),
    optionId: str(r.option_id),
    priceCategoryId: strOrNull(r.price_category_id),
    amountCents: Number(r.amount_cents) || 0,
    currency: 'EUR',
    validFrom: strOrNull(r.valid_from),
  }
}

function optionOf(r: Row, prices: OptionPriceRow[]): BookingOptionRow {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    targetId: str(r.target_id),
    kind: r.kind as BookingOptionRow['kind'],
    label: obj(r.label) ?? {},
    description: obj(r.description),
    status: r.status as BookingOptionRow['status'],
    sessionIds: strArr(r.session_ids),
    passScope: (strOrNull(r.pass_scope) as BookingOptionRow['passScope']) ?? null,
    passScopeOwnerIds: strArr(r.pass_scope_owner_ids),
    passValidity: (strOrNull(r.pass_validity) as BookingOptionRow['passValidity']) ?? null,
    passValidTo: strOrNull(r.pass_valid_to),
    passDurationMonths: numOrNull(r.pass_duration_months),
    passEntries: numOrNull(r.pass_entries),
    requiresMembership: r.requires_membership === true,
    minAge: numOrNull(r.min_age),
    maxAge: numOrNull(r.max_age),
    sort: Number(r.sort) || 0,
    prices,
  }
}

function bookingOf(r: Row): BookingRow {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    targetId: str(r.target_id),
    optionId: strOrNull(r.option_id),
    reference: str(r.reference),
    status: r.status as BookingRow['status'],
    paymentStatus: r.payment_status as BookingRow['paymentStatus'],
    paymentReview: r.payment_review === true,
    eligibilityReview: r.eligibility_review === true,
    locale: str(r.locale),
    source: r.source === 'dashboard' ? 'dashboard' : 'website',
    purchaserName: strOrNull(r.purchaser_name),
    purchaserEmail: strOrNull(r.purchaser_email),
    purchaserPhone: strOrNull(r.purchaser_phone),
    totalCents: Number(r.total_cents) || 0,
    snapshot: obj<Record<string, unknown>>(r.snapshot) ?? {},
    holdExpiresAt: iso(r.hold_expires_at),
    confirmedAt: iso(r.confirmed_at),
    cancelledAt: iso(r.cancelled_at),
    anonymisedAt: iso(r.anonymised_at),
    version: Number(r.version) || 1,
    createdAt: iso(r.created_at) ?? '',
  }
}

function passOf(r: Row): PassRow {
  return {
    id: str(r.id),
    projectId: str(r.project_id),
    bookingId: str(r.booking_id),
    attendeeId: str(r.attendee_id),
    optionId: str(r.option_id),
    targetId: str(r.target_id),
    scope: r.scope as PassRow['scope'],
    scopeOwnerIds: strArr(r.scope_owner_ids),
    validFrom: str(r.valid_from),
    validTo: str(r.valid_to),
    entriesTotal: numOrNull(r.entries_total),
    status: r.status === 'cancelled' ? 'cancelled' : 'active',
    anonymisedAt: iso(r.anonymised_at),
    version: Number(r.version) || 1,
  }
}

function confirmOf(r: Row | null | undefined): ConfirmResult {
  return { confirmed: r?.confirmed === true, replayed: r?.replayed === true, full: strArr(r?.full) ?? [] }
}

const SETTINGS_COLUMNS = 'project_id, rules, bank_details, payment_instructions, terms_note, reference_prefix, support_access_until, version'
const TARGET_COLUMNS = 'id, project_id, owner_type, owner_public_id, edition_id, registration_status, opens_at, closes_at, min_participants, min_decision_at, default_places, max_passes, include_new_sessions, rules_override, version'
const OPTION_COLUMNS = 'id, project_id, target_id, kind, label, description, status, session_ids, pass_scope, pass_scope_owner_ids, pass_validity, pass_valid_to, pass_duration_months, pass_entries, requires_membership, min_age, max_age, sort'
const PRICE_COLUMNS = 'id, option_id, price_category_id, amount_cents, currency, valid_from'
// Contact details of the purchaser are included: this adapter is server-only.
const BOOKING_COLUMNS = 'id, project_id, target_id, option_id, reference, status, payment_status, payment_review, eligibility_review, locale, source, purchaser_name, purchaser_email, purchaser_phone, total_cents, snapshot, hold_expires_at, confirmed_at, cancelled_at, anonymised_at, version, created_at'
const PASS_COLUMNS = 'id, project_id, booking_id, attendee_id, option_id, target_id, scope, scope_owner_ids, valid_from, valid_to, entries_total, status, anonymised_at, version'

export function createSupabaseReservationStore(db: ReservationDb): ServiceStore {
  /** Runs one rpc; never throws. `map` turns the jsonb / rows into the typed value. */
  async function rpc<T>(fn: string, args: Record<string, unknown>, map: (data: any) => T): Promise<Result<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const { data, error } = await db.rpc(fn, args)
      if (error) return fail(parseReservationError(error as DbErrorLike))
      return ok(map(data))
    } catch {
      return unavailable()
    }
  }

  /** Runs one read; the callback returns the supabase `{data, error}`. */
  async function read<T>(run: () => PromiseLike<{ data: unknown; error: DbErrorLike | null }>, map: (data: any) => T): Promise<Result<T>> { // eslint-disable-line @typescript-eslint/no-explicit-any
    try {
      const { data, error } = await run()
      if (error) return fail(parseReservationError(error))
      return ok(map(data))
    } catch {
      return unavailable()
    }
  }

  const store: ServiceStore = {
    async book(projectId, request) {
      // A pre-built payload (already snake_case) is passed through untouched.
      const isRequest = (r: BookingRequest | Record<string, unknown>): r is BookingRequest => 'targetId' in r
      let payload: Record<string, unknown>
      if (isRequest(request)) {
        const built = buildBookPayload(request)
        if (!built.ok) return built
        payload = built.value
      } else payload = request
      return rpc('reservations_book', { p_project_id: projectId, p_payload: payload }, (d): BookResult => ({
        bookingId: str(d?.booking_id), reference: str(d?.reference), replayed: d?.replayed === true,
      }))
    },

    passAttend: (projectId, passId, occurrenceId, opts) =>
      rpc('reservations_pass_attend', {
        p_project_id: projectId, p_pass_id: passId, p_occurrence_id: occurrenceId,
        p_actor: actorJson(opts?.actor, 'participant'), p_allow_over_capacity: opts?.allowOverCapacity ?? false,
      }, (d): PassAttendResult => ({ allocationId: str(d?.allocation_id), replayed: d?.replayed === true })),

    passWithdraw: (projectId, passId, occurrenceId, opts) =>
      rpc('reservations_pass_withdraw', {
        p_project_id: projectId, p_pass_id: passId, p_occurrence_id: occurrenceId,
        p_return_entry: opts.returnEntry, p_actor: actorJson(opts.actor, 'participant'),
      }, (d): PassWithdrawResult => ({ released: d?.released === true, entryReturned: d?.entry_returned === true })),

    release: (projectId, bookingId, reason, opts) =>
      rpc('reservations_release', {
        p_project_id: projectId, p_booking_id: bookingId, p_reason: reason,
        p_occurrence_ids: opts?.occurrenceIds ?? null, p_cancel_booking: opts?.cancelBooking ?? false,
        p_actor: actorJson(opts?.actor, 'user'), p_note: opts?.note ?? null,
      }, (d): ReleaseResult => ({ released: Number(d?.released) || 0, cancelled: d?.cancelled === true })),

    confirm: (projectId, bookingId, actor) =>
      rpc('reservations_confirm', { p_project_id: projectId, p_booking_id: bookingId, p_actor: actorJson(actor, 'user') }, confirmOf),

    extendHold: (projectId, bookingId, until, actor) =>
      rpc('reservations_extend_hold', {
        p_project_id: projectId, p_booking_id: bookingId,
        p_until: (until instanceof Date ? until : new Date(until)).toISOString(), p_actor: actorJson(actor, 'user'),
      }, (d) => ({ extended: d?.extended === true })),

    recordPayment: (projectId, bookingId, input) =>
      rpc('reservations_record_payment', {
        p_project_id: projectId, p_booking_id: bookingId, p_method: input.method, p_amount_cents: input.amountCents,
        p_paid_on: input.paidOn, p_reference: input.reference ?? null, p_note: input.note ?? null,
        p_actor: actorJson(input.actor, 'user'),
      }, (d): RecordPaymentResult => ({
        paymentId: str(d?.payment_id),
        paymentStatus: d?.payment_status,
        confirm: d?.confirm ? confirmOf(d.confirm) : null,
      })),

    setPlaces: (projectId, occurrenceId, places, opts) =>
      rpc('reservations_set_places', {
        p_project_id: projectId, p_occurrence_id: occurrenceId, p_places: places,
        p_force: opts?.force ?? false, p_actor: actorJson(opts?.actor, 'user'),
      }, (d): SetPlacesResult => ({ capacityId: str(d?.capacity_id), places: numOrNull(d?.places), active: Number(d?.active) || 0 })),

    expireHolds: (now) =>
      rpc('reservations_expire_holds', now ? { p_now: now.toISOString() } : {}, (d): ExpiredHold[] =>
        (Array.isArray(d) ? d : []).map((r: Row) => ({ bookingId: str(r.booking_id), projectId: str(r.project_id) }))),

    anonymiseBooking: (projectId, bookingId, actor) =>
      rpc('reservations_anonymise_booking', { p_project_id: projectId, p_booking_id: bookingId, p_actor: actorJson(actor, 'system') },
        (d) => ({ anonymised: d?.anonymised === true })),

    reserveLinkAttempt: (projectId, ipHash, windowSeconds, perIp) =>
      rpc('reservations_reserve_link_attempt', {
        p_project_id: projectId, p_ip_hash: ipHash, p_window_seconds: windowSeconds, p_per_ip: perIp,
      }, (d): LinkAttemptResult => {
        const r: Row | undefined = Array.isArray(d) ? d[0] : d
        return {
          allowed: r?.allowed === true,
          attemptId: r?.attempt_id == null ? null : Number(r.attempt_id),
          retryAfterSeconds: Number(r?.retry_after_seconds) || 0,
        }
      }),

    finishLinkAttempt: (attemptId, succeeded) =>
      rpc('reservations_finish_link_attempt', { p_attempt_id: attemptId, p_succeeded: succeeded }, () => true as const),

    // ── notification side (service layer needs these four) ──────────────────
    getBookingById: (projectId, bookingId) =>
      UUID.test(bookingId)
        ? read(() => db.from('bookings').select(BOOKING_COLUMNS).eq('project_id', projectId).eq('id', bookingId).limit(1),
          (d) => (Array.isArray(d) && d[0] ? bookingOf(d[0]) : null))
        : Promise.resolve(ok(null)),

    async enqueueOutbox(projectId, items) {
      if (!items.length) return ok({ queued: 0 })
      const rows = items.map((it) => {
        const empty = !Array.isArray(it.intent.recipients) || it.intent.recipients.length === 0
        return {
          project_id: projectId,
          booking_id: it.bookingId,
          pass_id: it.passId ?? null,
          intent: it.intent.intent,
          dedupe_key: it.intent.dedupeKey,
          recipients: it.intent.recipients ?? [],
          locale: it.intent.locale,
          payload: it.intent.payload ?? {},
          environment: it.intent.environment,
          // Nobody to mail (no address, or non-production without a test recipient): never "pending".
          ...(empty ? { status: 'skipped', last_error: String(it.intent.payload?.skip ?? 'no_recipients').slice(0, 200) } : {}),
        }
      })
      let queued = 0
      for (let i = 0; i < rows.length; i += ID_CHUNK) {
        // The dedupe key is unique: a repeated intent is silently ignored (idempotent enqueue).
        const r = await read(
          () => db.from('reservation_outbox').upsert(rows.slice(i, i + ID_CHUNK), { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id'),
          (d) => (Array.isArray(d) ? d.length : 0),
        )
        if (!r.ok) return r
        queued += r.value
      }
      return ok({ queued })
    },

    async listAffectedBookings(projectId, occurrenceIds) {
      const ids = [...new Set(occurrenceIds)]
      if (ids.some((id) => !UUID.test(id))) return refused('invalid')
      if (!ids.length) return ok([])
      const now = new Date().toISOString()
      const hit = new Map<string, { passId: string | null; attendeeId: string }>()
      for (let i = 0; i < ids.length; i += CHUNK) {
        const r = await read(
          () => db.from('booking_allocations').select('booking_id, attendee_id, pass_id, kind, expires_at')
            .eq('project_id', projectId).in('occurrence_id', ids.slice(i, i + CHUNK)).is('released_at', null),
          (d) => (Array.isArray(d) ? (d as Row[]) : []),
        )
        if (!r.ok) return r
        for (const a of r.value) {
          if (a.kind === 'hold' && !(typeof a.expires_at === 'string' && new Date(a.expires_at).getTime() > new Date(now).getTime())) continue
          const key = str(a.booking_id)
          const prev = hit.get(key)
          // A booking that holds a pass attendance keeps its pass id.
          if (!prev || (!prev.passId && strOrNull(a.pass_id))) hit.set(key, { passId: strOrNull(a.pass_id), attendeeId: str(a.attendee_id) })
        }
      }
      const bookingIds = [...hit.keys()]
      const out: AffectedBooking[] = []
      for (let i = 0; i < bookingIds.length; i += ID_CHUNK) {
        const chunk = bookingIds.slice(i, i + ID_CHUNK)
        const bookings = await read(
          () => db.from('bookings').select('id, purchaser_name, purchaser_email, locale, total_cents, payment_status')
            .eq('project_id', projectId).in('id', chunk).is('anonymised_at', null),
          (d) => (Array.isArray(d) ? (d as Row[]) : []),
        )
        if (!bookings.ok) return bookings
        const totals = await read(
          () => db.from('booking_allocations').select('booking_id, kind, expires_at')
            .eq('project_id', projectId).in('booking_id', chunk).is('released_at', null),
          (d) => (Array.isArray(d) ? (d as Row[]) : []),
        )
        if (!totals.ok) return totals
        const counts = new Map<string, number>()
        for (const a of totals.value) {
          if (a.kind === 'hold' && !(typeof a.expires_at === 'string' && new Date(a.expires_at).getTime() > new Date(now).getTime())) continue
          counts.set(str(a.booking_id), (counts.get(str(a.booking_id)) ?? 0) + 1)
        }
        // A pass holder may be mailed at their own address (the attendee), else the purchaser.
        const attendeeIds = [...new Set(chunk.map((b) => hit.get(b)).filter((h) => h?.passId).map((h) => h!.attendeeId))]
        const attendeeContact = new Map<string, { name: string | null; email: string | null }>()
        if (attendeeIds.length) {
          const at = await read(
            () => db.from('booking_attendees').select('id, name, email').eq('project_id', projectId).in('id', attendeeIds).is('anonymised_at', null),
            (d) => (Array.isArray(d) ? (d as Row[]) : []),
          )
          if (!at.ok) return at
          for (const a of at.value) attendeeContact.set(str(a.id), { name: strOrNull(a.name), email: strOrNull(a.email) })
        }
        for (const b of bookings.value) {
          const h = hit.get(str(b.id))
          if (!h) continue
          const own = h.passId ? attendeeContact.get(h.attendeeId) : undefined
          out.push({
            bookingId: str(b.id),
            name: own?.email ? own.name : strOrNull(b.purchaser_name),
            email: own?.email ?? strOrNull(b.purchaser_email),
            locale: str(b.locale),
            passId: h.passId,
            totalCents: Number(b.total_cents) || 0,
            paymentStatus: b.payment_status as AffectedBooking['paymentStatus'],
            sessionCount: counts.get(str(b.id)) ?? 0,
          })
        }
      }
      return ok(out)
    },

    async listNoticeRecipients(projectId, scope) {
      const rowsOf = (r: Row[]): NoticeRecipient[] => r.map((b) => ({
        bookingId: str(b.id), name: strOrNull(b.purchaser_name), email: strOrNull(b.purchaser_email), locale: str(b.locale),
      }))
      if (scope.kind === 'target') {
        if (!UUID.test(scope.targetId)) return refused('invalid')
        return read(
          () => db.from('bookings').select('id, purchaser_name, purchaser_email, locale').eq('project_id', projectId)
            .eq('target_id', scope.targetId).in('status', ['held', 'awaiting_payment', 'confirmed']).is('anonymised_at', null)
            .order('created_at', { ascending: true }).limit(NOTICE_LIMIT),
          (d) => rowsOf(Array.isArray(d) ? (d as Row[]) : []),
        )
      }
      const affected = await store.listAffectedBookings(projectId, scope.occurrenceIds)
      if (!affected.ok) return affected
      return ok(affected.value.map((a): NoticeRecipient => ({ bookingId: a.bookingId, name: a.name, email: a.email, locale: a.locale })))
    },

    // ── reads ────────────────────────────────────────────────────────────────
    getSettings: (projectId) =>
      read(() => db.from('reservation_settings').select(SETTINGS_COLUMNS).eq('project_id', projectId).limit(1),
        (d) => (Array.isArray(d) && d[0] ? settingsOf(d[0]) : null)),

    getTarget: (projectId, ownerType, ownerPublicId, editionId) => {
      let q = db.from('reservable_targets').select(TARGET_COLUMNS).eq('project_id', projectId).eq('owner_type', ownerType).is('removed_at', null)
      q = ownerPublicId ? q.eq('owner_public_id', ownerPublicId) : q.is('owner_public_id', null)
      q = editionId ? q.eq('edition_id', editionId) : q.is('edition_id', null)
      return read(() => q.limit(1), (d) => (Array.isArray(d) && d[0] ? targetOf(d[0]) : null))
    },

    async listOptions(projectId, targetId, opts) {
      let q = db.from('booking_options').select(OPTION_COLUMNS).eq('project_id', projectId).eq('target_id', targetId)
      q = opts?.status === 'all' ? q.neq('status', 'archived') : q.eq('status', 'active')
      const options = await read(() => q.order('sort', { ascending: true }), (d) => (Array.isArray(d) ? (d as Row[]) : []))
      if (!options.ok || !options.value.length) return options.ok ? ok([]) : options
      const ids = options.value.map((o) => str(o.id))
      const prices = await read(
        () => db.from('booking_option_prices').select(PRICE_COLUMNS).eq('project_id', projectId).in('option_id', ids),
        (d) => (Array.isArray(d) ? (d as Row[]).map(priceOf) : []),
      )
      if (!prices.ok) return prices
      return ok(options.value.map((o) => optionOf(o, prices.value.filter((p) => p.optionId === str(o.id)))))
    },

    getBookingByReference: (projectId, reference) =>
      read(() => db.from('bookings').select(BOOKING_COLUMNS).eq('project_id', projectId).eq('reference', reference).limit(1),
        (d) => (Array.isArray(d) && d[0] ? bookingOf(d[0]) : null)),

    async getBookingByTokenHash(tokenHash) {
      if (!HASH.test(tokenHash)) return ok(null)
      return read(() => db.from('bookings').select(BOOKING_COLUMNS).eq('management_token_hash', tokenHash).limit(1),
        (d) => (Array.isArray(d) && d[0] ? bookingOf(d[0]) : null))
    },

    async getPassByTokenHash(tokenHash) {
      if (!HASH.test(tokenHash)) return ok(null)
      return read(() => db.from('booking_passes').select(PASS_COLUMNS).eq('management_token_hash', tokenHash).limit(1),
        (d) => (Array.isArray(d) && d[0] ? passOf(d[0]) : null))
    },

    async sessionAvailability(projectId, occurrenceIds, opts) {
      const ids = [...new Set(occurrenceIds)]
      if (ids.some((id) => !UUID.test(id))) return refused('invalid')
      if (!ids.length) return ok([])
      const now = (opts?.now ?? new Date()).toISOString()
      const places = new Map<string, number | null>()
      const active = new Map<string, number>()
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK)
        const caps = await read(
          () => db.from('session_capacity').select('occurrence_id, places').eq('project_id', projectId).in('occurrence_id', chunk),
          (d) => (Array.isArray(d) ? (d as Row[]) : []),
        )
        if (!caps.ok) return caps
        for (const c of caps.value) places.set(str(c.occurrence_id), numOrNull(c.places))
        // Same rule as reservations_active_count(): not released, and not a lapsed hold.
        const allocs = await read(
          () => db.from('booking_allocations').select('occurrence_id, kind, expires_at').eq('project_id', projectId)
            .in('occurrence_id', chunk).is('released_at', null).or(`kind.neq.hold,expires_at.gt.${now}`),
          (d) => (Array.isArray(d) ? (d as Row[]) : []),
        )
        if (!allocs.ok) return allocs
        for (const a of allocs.value) {
          // Belt and braces: re-apply the rule in case the filter is loosened upstream.
          if (a.kind === 'hold' && !(typeof a.expires_at === 'string' && new Date(a.expires_at).getTime() > new Date(now).getTime())) continue
          active.set(str(a.occurrence_id), (active.get(str(a.occurrence_id)) ?? 0) + 1)
        }
      }
      return ok(ids.map((occurrenceId): SessionAvailability => ({
        occurrenceId,
        // No place row yet = the session has never been booked: the target default applies.
        places: places.has(occurrenceId) ? (places.get(occurrenceId) ?? null) : (opts?.defaultPlaces ?? null),
        active: active.get(occurrenceId) ?? 0,
      })))
    },
  }
  return store
}
