// ── Reservations — Bookings list and detail reads (ADR-044 D4, D5, D16.15) ────
//
// Plain project-scoped selects for the tenant dashboard's Bookings area. Db-
// agnostic like store.ts / settings-store.ts (the production wiring, with the
// service role, is bookings-read.server.ts). EVERY query carries project_id:
// the tables are server-only and this file is the isolation boundary.
//
// Results are values, never throws, for expected failures (errors.ts): a
// database without migration 066 answers `unavailable`.
import { normaliseReference } from '../reference'
import type { BookingStatus, PaymentMethod, PaymentStatus } from '../types'
import { fail, ok, parseReservationError, type DbErrorLike, type Result } from './errors'
import { BOOKING_COLUMNS, bookingOf } from './store'
import type { BookingRow, TargetOwnerType } from './types'

/** The slice of the supabase client used here (loose, so a fake can stand in). */
export type BookingsDb = {
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export const BOOKINGS_PAGE_SIZE = 25
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_CHUNK = 50
/** How many recent bookings are scanned to offer the "course / event" filter. */
const TARGET_SCAN = 500

type Row = Record<string, unknown>
const str = (v: unknown): string => String(v ?? '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const obj = <T,>(v: unknown): T | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null)
const iso = (v: unknown): string | null => (typeof v === 'string' && v ? new Date(v).toISOString() : null)
const rows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : [])

// ── Filters ──────────────────────────────────────────────────────────────────
export type BookingFilters = {
  status?: BookingStatus | null
  paymentStatus?: PaymentStatus | null
  /** reservable_targets.id of a course / event. */
  targetId?: string | null
  /** Reference ("CYCE-7K2MQ"), name or email. */
  q?: string | null
  /** 1-based. */
  page?: number
}

/** Characters that would break out of a PostgREST `or(...)` filter or act as wildcards. */
export function safeSearchTerm(input: string): string {
  return input.replace(/[,()%*_\\"'`:;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)
}

/** The `or(...)` expression for a search box: reference prefix, name, email. Null = no search. */
export function searchExpression(q: string | null | undefined): string | null {
  const term = safeSearchTerm(q ?? '')
  if (!term) return null
  const parts = [`purchaser_name.ilike.%${term}%`, `purchaser_email.ilike.%${term}%`]
  const ref = safeSearchTerm(normaliseReference(term)).replace(/ /g, '-').toUpperCase()
  if (ref) parts.unshift(`reference.ilike.${ref}%`)
  return parts.join(',')
}

// ── Snapshot (what the booking showed at booking time) ───────────────────────
// The snapshot is written by whoever creates the booking (website flow); its
// shape is deliberately loose. These readers take what is there and never fail.
export type LocalizedMap = Record<string, string>
export type SnapshotSession = { occurrenceId: string | null; startsAt: string | null; title: string | null }

function pickText(v: unknown, locales: readonly string[]): string | null {
  if (typeof v === 'string') return v.trim() || null
  const m = obj<Record<string, unknown>>(v)
  if (!m) return null
  for (const l of locales) if (typeof m[l] === 'string' && (m[l] as string).trim()) return (m[l] as string).trim()
  const any = Object.values(m).find((x) => typeof x === 'string' && x.trim())
  return typeof any === 'string' ? any.trim() : null
}

/** "What was booked": the course / event title, else the option's label. */
export function snapshotTitle(snapshot: Record<string, unknown> | null | undefined, locales: readonly string[] = ['en']): string | null {
  const s = snapshot ?? {}
  const direct = pickText(s.title, locales) ?? pickText(s.targetTitle, locales) ?? pickText(s.ownerTitle, locales)
  if (direct) return direct
  const target = obj<Row>(s.target)
  return pickText(target?.title, locales) ?? pickText(s.optionLabel, locales) ?? pickText(obj<Row>(s.option)?.label, locales)
}

export function snapshotOptionLabel(snapshot: Record<string, unknown> | null | undefined, locales: readonly string[] = ['en']): string | null {
  const s = snapshot ?? {}
  return pickText(s.optionLabel, locales) ?? pickText(obj<Row>(s.option)?.label, locales)
}

export function snapshotSessions(snapshot: Record<string, unknown> | null | undefined, locales: readonly string[] = ['en']): SnapshotSession[] {
  const list = Array.isArray(snapshot?.sessions) ? (snapshot!.sessions as unknown[]) : []
  return list.flatMap((x) => {
    const r = obj<Row>(x)
    if (!r) return []
    return [{
      occurrenceId: strOrNull(r.occurrenceId) ?? strOrNull(r.occurrence_id) ?? strOrNull(r.id),
      startsAt: iso(r.startsAt ?? r.starts_at),
      title: pickText(r.title, locales),
    }]
  })
}

// ── List ─────────────────────────────────────────────────────────────────────
export type BookingListRow = {
  id: string
  reference: string
  name: string | null
  email: string | null
  /** Snapshot title; null when the snapshot has none. */
  what: string | null
  /** Active sessions held by the booking. */
  sessionCount: number
  /** The booking sold a pass. */
  hasPass: boolean
  totalCents: number
  paymentStatus: PaymentStatus
  status: BookingStatus
  paymentReview: boolean
  eligibilityReview: boolean
  anonymised: boolean
  createdAt: string
}

export type BookingPage = { rows: BookingListRow[]; total: number; page: number; pageSize: number }
export type TargetOption = { targetId: string; label: string; ownerType: TargetOwnerType | null }

export type BookingsReader = {
  listBookings(projectId: string, filters?: BookingFilters, locales?: readonly string[]): Promise<Result<BookingPage>>
  listTargetOptions(projectId: string, locales?: readonly string[]): Promise<Result<TargetOption[]>>
  getBookingDetail(projectId: string, bookingId: string, locales?: readonly string[]): Promise<Result<BookingDetail | null>>
}

export type AttendeeView = {
  id: string
  name: string | null
  email: string | null
  isMinor: boolean
  guardianName: string | null
  eligibilityResult: 'pending' | 'verified' | 'rejected' | null
  declaredEligible: boolean | null
  anonymised: boolean
}
export type LineView = { id: string; kind: 'item' | 'adjustment'; label: string | null; quantity: number; unitCents: number; amountCents: number; attendeeId: string | null }
export type PaymentView = {
  id: string
  method: PaymentMethod
  amountCents: number
  status: 'pending' | 'succeeded' | 'failed' | 'void'
  paidOn: string | null
  reference: string | null
  note: string | null
  createdAt: string
}
export type ActivityView = { id: string; action: string; actorKind: 'user' | 'participant' | 'system' | 'support'; detail: Record<string, unknown>; createdAt: string }
export type AllocationView = {
  id: string
  attendeeId: string
  occurrenceId: string
  kind: 'hold' | 'confirmed' | 'pass_attendance'
  expiresAt: string | null
  releasedAt: string | null
  releaseReason: string | null
}
export type PassView = { id: string; attendeeId: string; validFrom: string; validTo: string; entriesTotal: number | null; status: 'active' | 'cancelled' }

export type BookingDetail = {
  booking: BookingRow
  what: string | null
  optionLabel: string | null
  target: { id: string; ownerType: TargetOwnerType; ownerPublicId: string | null; editionId: string | null } | null
  attendees: AttendeeView[]
  lines: LineView[]
  payments: PaymentView[]
  passes: PassView[]
  allocations: AllocationView[]
  /** Sessions as shown at booking time (title and start), when the snapshot has them. */
  sessions: SnapshotSession[]
  activity: ActivityView[]
  /** Sum of succeeded payments. */
  paidCents: number
}

const LIST_COLUMNS = 'id, reference, status, payment_status, payment_review, eligibility_review, purchaser_name, purchaser_email, total_cents, snapshot, anonymised_at, created_at'
const ATTENDEE_COLUMNS = 'id, name, email, is_minor, guardian, declared_eligible, eligibility_result, anonymised_at, sort'
const LINE_COLUMNS = 'id, attendee_id, kind, label, quantity, unit_cents, amount_cents, created_at'
const PAYMENT_COLUMNS = 'id, method, amount_cents, status, paid_on, reference, note, created_at'
const ALLOCATION_COLUMNS = 'id, attendee_id, occurrence_id, kind, expires_at, released_at, release_reason, created_at'
const PASS_COLUMNS = 'id, attendee_id, valid_from, valid_to, entries_total, status'
const ACTIVITY_COLUMNS = 'id, action, actor_kind, detail, created_at'
const TARGET_COLUMNS = 'id, owner_type, owner_public_id, edition_id'

export function createBookingsReader(db: BookingsDb): BookingsReader {
  /** Runs one select; never throws. `map` gets the rows and the exact count (when asked for). */
  async function read<T>(run: () => PromiseLike<{ data: unknown; error: DbErrorLike | null; count?: number | null }>, map: (data: unknown, count: number | null) => T): Promise<Result<T>> {
    try {
      const { data, error, count } = await run()
      if (error) return fail(parseReservationError(error))
      return ok(map(data, typeof count === 'number' ? count : null))
    } catch {
      return fail({ kind: 'unavailable' })
    }
  }

  return {
    async listBookings(projectId, filters = {}, locales = ['en']) {
      const page = Number.isInteger(filters.page) && (filters.page as number) >= 1 ? (filters.page as number) : 1
      const from = (page - 1) * BOOKINGS_PAGE_SIZE
      if (filters.targetId && !UUID.test(filters.targetId)) return ok({ rows: [], total: 0, page, pageSize: BOOKINGS_PAGE_SIZE })

      let q = db.from('bookings').select(LIST_COLUMNS, { count: 'exact' }).eq('project_id', projectId)
      if (filters.status) q = q.eq('status', filters.status)
      if (filters.paymentStatus) q = q.eq('payment_status', filters.paymentStatus)
      if (filters.targetId) q = q.eq('target_id', filters.targetId)
      const search = searchExpression(filters.q)
      if (search) q = q.or(search)
      q = q.order('created_at', { ascending: false }).range(from, from + BOOKINGS_PAGE_SIZE - 1)

      const main = await read(() => q, (d, count) => ({ list: rows(d), count }))
      if (!main.ok) return main
      const list = main.value.list
      const ids = list.map((r) => str(r.id))

      // Sessions held and passes sold, for the page's bookings only.
      const sessionCounts = new Map<string, number>()
      const withPass = new Set<string>()
      for (let i = 0; i < ids.length; i += ID_CHUNK) {
        const chunk = ids.slice(i, i + ID_CHUNK)
        const allocs = await read(
          () => db.from('booking_allocations').select('booking_id, kind, expires_at').eq('project_id', projectId).in('booking_id', chunk).is('released_at', null),
          (d) => rows(d),
        )
        if (!allocs.ok) return allocs
        const now = Date.now()
        for (const a of allocs.value) {
          // A lapsed hold is not a place any more.
          if (a.kind === 'hold' && !(typeof a.expires_at === 'string' && new Date(a.expires_at).getTime() > now)) continue
          sessionCounts.set(str(a.booking_id), (sessionCounts.get(str(a.booking_id)) ?? 0) + 1)
        }
        const passes = await read(
          () => db.from('booking_passes').select('booking_id').eq('project_id', projectId).in('booking_id', chunk),
          (d) => rows(d),
        )
        if (!passes.ok) return passes
        for (const p of passes.value) withPass.add(str(p.booking_id))
      }

      const out: BookingListRow[] = list.map((r) => ({
        id: str(r.id),
        reference: str(r.reference),
        name: strOrNull(r.purchaser_name),
        email: strOrNull(r.purchaser_email),
        what: snapshotTitle(obj<Record<string, unknown>>(r.snapshot), locales),
        sessionCount: sessionCounts.get(str(r.id)) ?? 0,
        hasPass: withPass.has(str(r.id)),
        totalCents: Number(r.total_cents) || 0,
        paymentStatus: r.payment_status as PaymentStatus,
        status: r.status as BookingStatus,
        paymentReview: r.payment_review === true,
        eligibilityReview: r.eligibility_review === true,
        anonymised: !!r.anonymised_at,
        createdAt: iso(r.created_at) ?? '',
      }))
      return ok({ rows: out, total: main.value.count ?? from + out.length, page, pageSize: BOOKINGS_PAGE_SIZE })
    },

    async listTargetOptions(projectId, locales = ['en']) {
      const recent = await read(
        () => db.from('bookings').select('target_id, snapshot').eq('project_id', projectId).order('created_at', { ascending: false }).limit(TARGET_SCAN),
        (d) => rows(d),
      )
      if (!recent.ok) return recent
      const titles = new Map<string, string | null>()
      for (const r of recent.value) {
        const id = str(r.target_id)
        if (!titles.get(id)) titles.set(id, snapshotTitle(obj<Record<string, unknown>>(r.snapshot), locales))
      }
      const ids = [...titles.keys()]
      const kinds = new Map<string, TargetOwnerType>()
      if (ids.length) {
        const t = await read(
          () => db.from('reservable_targets').select('id, owner_type').eq('project_id', projectId).in('id', ids.slice(0, ID_CHUNK * 4)),
          (d) => rows(d),
        )
        if (!t.ok) return t
        for (const r of t.value) kinds.set(str(r.id), r.owner_type as TargetOwnerType)
      }
      return ok(
        ids
          .filter((id) => kinds.has(id))
          .map((id): TargetOption => ({ targetId: id, label: titles.get(id) ?? '', ownerType: kinds.get(id) ?? null }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      )
    },

    async getBookingDetail(projectId, bookingId, locales = ['en']) {
      if (!UUID.test(bookingId)) return ok(null)
      const b = await read(
        () => db.from('bookings').select(BOOKING_COLUMNS).eq('project_id', projectId).eq('id', bookingId).limit(1),
        (d) => (rows(d)[0] ? bookingOf(rows(d)[0]) : null),
      )
      if (!b.ok || !b.value) return b.ok ? ok(null) : b
      const booking = b.value

      const byBooking = (table: string, columns: string) =>
        read(() => db.from(table).select(columns).eq('project_id', projectId).eq('booking_id', bookingId), (d) => rows(d))
      const [target, attendees, lines, payments, passes, allocations, activity] = await Promise.all([
        read(() => db.from('reservable_targets').select(TARGET_COLUMNS).eq('project_id', projectId).eq('id', booking.targetId).limit(1), (d) => rows(d)[0] ?? null),
        byBooking('booking_attendees', ATTENDEE_COLUMNS),
        byBooking('booking_lines', LINE_COLUMNS),
        byBooking('booking_payments', PAYMENT_COLUMNS),
        byBooking('booking_passes', PASS_COLUMNS),
        byBooking('booking_allocations', ALLOCATION_COLUMNS),
        byBooking('booking_activity', ACTIVITY_COLUMNS),
      ])
      for (const r of [target, attendees, lines, payments, passes, allocations, activity]) if (!r.ok) return r as Result<never>
      const ok_ = <T,>(r: Result<T>): T => (r as { ok: true; value: T }).value

      const t = ok_(target) as Row | null
      const paymentViews = ok_(payments).map((p): PaymentView => ({
        id: str(p.id),
        method: p.method as PaymentMethod,
        amountCents: Number(p.amount_cents) || 0,
        status: p.status as PaymentView['status'],
        paidOn: strOrNull(p.paid_on),
        reference: strOrNull(p.reference),
        note: strOrNull(p.note),
        createdAt: iso(p.created_at) ?? '',
      })).sort((a, b) => (a.paidOn ?? a.createdAt).localeCompare(b.paidOn ?? b.createdAt))

      return ok({
        booking,
        what: snapshotTitle(booking.snapshot, locales),
        optionLabel: snapshotOptionLabel(booking.snapshot, locales),
        target: t ? { id: str(t.id), ownerType: t.owner_type as TargetOwnerType, ownerPublicId: strOrNull(t.owner_public_id), editionId: strOrNull(t.edition_id) } : null,
        attendees: ok_(attendees)
          .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0))
          .map((a): AttendeeView => ({
            id: str(a.id),
            name: strOrNull(a.name),
            email: strOrNull(a.email),
            isMinor: a.is_minor === true,
            guardianName: strOrNull(obj<Row>(a.guardian)?.name),
            eligibilityResult: (strOrNull(a.eligibility_result) as AttendeeView['eligibilityResult']) ?? null,
            declaredEligible: typeof a.declared_eligible === 'boolean' ? a.declared_eligible : null,
            anonymised: !!a.anonymised_at,
          })),
        lines: ok_(lines).sort((a, b) => str(a.created_at).localeCompare(str(b.created_at))).map((l): LineView => ({
          id: str(l.id),
          kind: l.kind === 'adjustment' ? 'adjustment' : 'item',
          label: pickText(l.label, locales),
          quantity: Number(l.quantity) || 1,
          unitCents: Number(l.unit_cents) || 0,
          amountCents: Number(l.amount_cents) || 0,
          attendeeId: strOrNull(l.attendee_id),
        })),
        payments: paymentViews,
        passes: ok_(passes).map((p): PassView => ({
          id: str(p.id), attendeeId: str(p.attendee_id), validFrom: str(p.valid_from), validTo: str(p.valid_to),
          entriesTotal: typeof p.entries_total === 'number' ? p.entries_total : null, status: p.status === 'cancelled' ? 'cancelled' : 'active',
        })),
        allocations: ok_(allocations).map((a): AllocationView => ({
          id: str(a.id), attendeeId: str(a.attendee_id), occurrenceId: str(a.occurrence_id), kind: a.kind as AllocationView['kind'],
          expiresAt: iso(a.expires_at), releasedAt: iso(a.released_at), releaseReason: strOrNull(a.release_reason),
        })),
        sessions: snapshotSessions(booking.snapshot, locales),
        activity: ok_(activity)
          .map((a): ActivityView => ({ id: str(a.id), action: str(a.action), actorKind: a.actor_kind as ActivityView['actorKind'], detail: obj<Record<string, unknown>>(a.detail) ?? {}, createdAt: iso(a.created_at) ?? '' }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || Number(b.id) - Number(a.id)),
        paidCents: paymentViews.filter((p) => p.status === 'succeeded').reduce((n, p) => n + p.amountCents, 0),
      })
    },
  }
}

/** The ReservableTargetRow fields the payment rules need, from the detail's target. */
export function targetRefOf(target: BookingDetail['target']): { ownerType: TargetOwnerType; ownerPublicId: string | null; editionId: string | null } | null {
  return target ? { ownerType: target.ownerType, ownerPublicId: target.ownerPublicId, editionId: target.editionId } : null
}
