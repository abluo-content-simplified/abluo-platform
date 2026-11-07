// ── Reservations website — what the two pages read (ADR-044 D7, D9, D11) ─────
//
// Reads only. Every query carries project_id (the tables are server-only and
// this is the isolation boundary), takes ids the CALLER already proved belong
// to the project (via the link guard), and never selects contact details.
// The database handle is injected (`ReservationDb`), so tests use a fake.
//
// Session titles and places come from the website's content (Sanity) through
// the injected `SiteLookup` and fail soft: a session without a title is still
// listed with its date and time.
import type { ReservationDb } from '../server/store'
import type { BookingRow, PassRow } from '../server/types'
import { fromStoreError, loadRuleContext, refuse, succeed, type ServiceDeps, type ServiceResult, type TargetRef } from '../service/types'
import type { BookingRulesOverride } from '../types'
import type { SchedulePlace } from '@/lib/scheduling/types'
import { buildBookingView, buildPassView, type AllocationFact, type SessionFact } from './view-model'
import type { BookingView, PassView } from './types'

type Row = Record<string, unknown>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (v: unknown): string => String(v ?? '')
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : [])
const DAY = 24 * 3_600_000

/** Longest look-ahead and most sessions listed on My pass (one screen, not a calendar). */
export const PASS_LOOKAHEAD_DAYS = 90
export const PASS_MAX_SESSIONS = 40

/** Decorates sessions with a title and a place name and tells the site's time zone. Must fail soft. */
export type SiteLookup = {
  decorate(facts: SessionFact[]): Promise<SessionFact[]>
  timeZone(): Promise<string | null>
  defaultLocale(): Promise<string | null>
}

export type SiteCtx = {
  projectId: string
  locale: string
  db: ReservationDb
  service: ServiceDeps
  site: SiteLookup
}

async function select(q: PromiseLike<{ data: unknown; error: { message?: string } | null }>): Promise<Row[]> {
  const { data, error } = await q
  if (error) throw new Error(error.message ?? 'read failed')
  return rows(data)
}

function placeOf(v: unknown): SchedulePlace | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Row
  if (p.kind === 'location' && typeof p.key === 'string') return { kind: 'location', key: p.key }
  if (p.kind === 'venue' && typeof p.venuePublicId === 'string') return { kind: 'venue', venuePublicId: p.venuePublicId }
  return null
}

const OCCURRENCE_COLUMNS = 'id, series_id, starts_at, ends_at, time_zone, status, owner_type, owner_public_id, place_override'

/** Turns occurrence rows (+ their series place + the session's rules override) into facts. */
async function factsFrom(db: ReservationDb, projectId: string, occ: Row[]): Promise<SessionFact[]> {
  if (!occ.length) return []
  const ids = occ.map((o) => str(o.id))
  const seriesIds = [...new Set(occ.map((o) => str(o.series_id)).filter((s) => UUID.test(s)))]
  const [caps, series] = await Promise.all([
    select(db.from('session_capacity').select('occurrence_id, rules_override').eq('project_id', projectId).in('occurrence_id', ids)),
    seriesIds.length
      ? select(db.from('event_series').select('id, place').eq('project_id', projectId).in('id', seriesIds))
      : Promise.resolve([] as Row[]),
  ])
  const override = new Map(caps.map((c) => [str(c.occurrence_id), (c.rules_override && typeof c.rules_override === 'object' ? c.rules_override : null) as BookingRulesOverride | null]))
  const seriesPlace = new Map(series.map((s) => [str(s.id), placeOf(s.place)]))
  return occ.map((o): SessionFact => ({
    occurrenceId: str(o.id),
    startsAt: new Date(str(o.starts_at)).toISOString(),
    endsAt: strOrNull(o.ends_at) ? new Date(str(o.ends_at)).toISOString() : null,
    timeZone: strOrNull(o.time_zone) ?? 'Europe/Rome',
    status: o.status === 'cancelled' ? 'cancelled' : 'scheduled',
    ownerType: o.owner_type === 'event' ? 'event' : 'course',
    ownerPublicId: str(o.owner_public_id),
    title: null,
    placeRef: placeOf(o.place_override) ?? seriesPlace.get(str(o.series_id)) ?? null,
    place: null,
    rulesOverride: override.get(str(o.id)) ?? null,
  }))
}

/** Sessions by id, project-scoped, not removed. Unknown ids are simply absent. */
export async function readSessionFacts(db: ReservationDb, projectId: string, occurrenceIds: string[]): Promise<SessionFact[]> {
  const ids = [...new Set(occurrenceIds)].filter((i) => UUID.test(i)).slice(0, 200)
  if (!ids.length) return []
  const occ = await select(db.from('event_occurrences').select(OCCURRENCE_COLUMNS).eq('project_id', projectId).in('id', ids).is('removed_at', null))
  return factsFrom(db, projectId, occ)
}

export async function readTargetRef(db: ReservationDb, projectId: string, targetId: string): Promise<TargetRef | null> {
  if (!UUID.test(targetId)) return null
  const [t] = await select(db.from('reservable_targets').select('owner_type, owner_public_id, edition_id').eq('project_id', projectId).eq('id', targetId).limit(1))
  if (!t) return null
  const ownerType = t.owner_type === 'event' ? 'event' : t.owner_type === 'course' ? 'course' : 'project'
  return { ownerType, ownerPublicId: strOrNull(t.owner_public_id), editionId: strOrNull(t.edition_id) }
}

const ALLOCATION_COLUMNS = 'occurrence_id, kind, pass_id, expires_at, released_at, release_reason, uses_entry, entry_returned'

function allocationOf(r: Row): AllocationFact {
  return {
    occurrenceId: str(r.occurrence_id),
    kind: r.kind === 'hold' ? 'hold' : r.kind === 'pass_attendance' ? 'pass_attendance' : 'confirmed',
    passId: strOrNull(r.pass_id),
    expiresAt: strOrNull(r.expires_at),
    releasedAt: strOrNull(r.released_at),
    releaseReason: strOrNull(r.release_reason),
    usesEntry: r.uses_entry === true,
    entryReturned: r.entry_returned === true,
  }
}

export async function readBookingAllocations(db: ReservationDb, projectId: string, bookingId: string): Promise<AllocationFact[]> {
  if (!UUID.test(bookingId)) return []
  return (await select(db.from('booking_allocations').select(ALLOCATION_COLUMNS).eq('project_id', projectId).eq('booking_id', bookingId))).map(allocationOf)
}

export async function readPassAllocations(db: ReservationDb, projectId: string, passId: string): Promise<AllocationFact[]> {
  if (!UUID.test(passId)) return []
  return (await select(db.from('booking_allocations').select(ALLOCATION_COLUMNS).eq('project_id', projectId).eq('pass_id', passId))).map(allocationOf)
}

export async function readBookingHasPass(db: ReservationDb, projectId: string, bookingId: string): Promise<boolean> {
  if (!UUID.test(bookingId)) return false
  return (await select(db.from('booking_passes').select('id').eq('project_id', projectId).eq('booking_id', bookingId).limit(1))).length > 0
}

/** Upcoming sessions a pass could cover (scope narrowed in SQL; coverage is re-checked by the view model). */
export async function readUpcomingForPass(
  db: ReservationDb, projectId: string, pass: Pick<PassRow, 'scope' | 'scopeOwnerIds' | 'validTo'>, target: TargetRef, now: Date,
): Promise<SessionFact[]> {
  let ownerType: 'event' | 'course'
  let ownerIds: string[] | null = null
  if (pass.scope === 'target') {
    if (target.ownerType === 'project' || !target.ownerPublicId) return []
    ownerType = target.ownerType
    ownerIds = [target.ownerPublicId]
  } else {
    ownerType = 'course'
    if (pass.scope === 'courses') {
      ownerIds = pass.scopeOwnerIds ?? []
      if (!ownerIds.length) return []
    }
  }
  const from = now.toISOString()
  // validTo is a project-local date: take the whole following day so a late class on it is not cut off.
  const validEnd = new Date(`${pass.validTo}T00:00:00Z`).getTime() + 2 * DAY
  const to = new Date(Math.min(validEnd, now.getTime() + PASS_LOOKAHEAD_DAYS * DAY)).toISOString()
  if (to <= from) return []
  let q = db.from('event_occurrences').select(OCCURRENCE_COLUMNS).eq('project_id', projectId).eq('owner_type', ownerType)
    .gte('starts_at', from).lte('starts_at', to).is('removed_at', null)
  if (ownerIds) q = q.in('owner_public_id', ownerIds)
  const occ = await select(q.order('starts_at', { ascending: true }).limit(PASS_MAX_SESSIONS))
  return factsFrom(db, projectId, occ)
}

// ── The two views ────────────────────────────────────────────────────────────
export async function loadBookingView(ctx: SiteCtx, booking: BookingRow): Promise<ServiceResult<{ view: BookingView; target: TargetRef; sessions: SessionFact[] }>> {
  try {
    const target = await readTargetRef(ctx.db, ctx.projectId, booking.targetId)
    if (!target) return refuse('not_found')
    const rc = await loadRuleContext(ctx.service, ctx.projectId, target)
    if (!rc.ok) return rc
    const [allocations, isPass] = await Promise.all([
      readBookingAllocations(ctx.db, ctx.projectId, booking.id),
      readBookingHasPass(ctx.db, ctx.projectId, booking.id),
    ])
    const sessions = await ctx.site.decorate(await readSessionFacts(ctx.db, ctx.projectId, allocations.filter((a) => a.kind !== 'pass_attendance').map((a) => a.occurrenceId)))
    const [siteTimeZone, siteDefaultLocale] = await Promise.all([ctx.site.timeZone(), ctx.site.defaultLocale()])
    const view = buildBookingView({
      booking, rules: rc.value.rules, allocations, sessions, isPass, now: ctx.service.now(), locale: ctx.locale,
      siteDefaultLocale, siteTimeZone, paymentInstructions: rc.value.settings.paymentInstructions, bankDetails: rc.value.settings.bankDetails,
    })
    return succeed({ view, target, sessions })
  } catch {
    return refuse('unavailable')
  }
}

export async function loadPassView(ctx: SiteCtx, pass: PassRow): Promise<ServiceResult<{ view: PassView; target: TargetRef }>> {
  try {
    const target = await readTargetRef(ctx.db, ctx.projectId, pass.targetId)
    if (!target) return refuse('not_found')
    const rc = await loadRuleContext(ctx.service, ctx.projectId, target)
    if (!rc.ok) return rc
    const now = ctx.service.now()
    const [allocations, candidates] = await Promise.all([
      readPassAllocations(ctx.db, ctx.projectId, pass.id),
      readUpcomingForPass(ctx.db, ctx.projectId, pass, target, now),
    ])
    const sessions = await ctx.site.decorate(candidates)
    const av = sessions.length
      ? await ctx.service.store.sessionAvailability(ctx.projectId, sessions.map((s) => s.occurrenceId), { defaultPlaces: rc.value.target.defaultPlaces, now })
      : { ok: true as const, value: [] }
    if (!av.ok) return fromStoreError(av.error)
    const [siteTimeZone, siteDefaultLocale] = await Promise.all([ctx.site.timeZone(), ctx.site.defaultLocale()])
    const view = buildPassView({
      pass,
      targetOwner: target.ownerType === 'project' || !target.ownerPublicId ? null : { ownerType: target.ownerType, ownerPublicId: target.ownerPublicId },
      rules: rc.value.rules, allocations, sessions, availability: new Map(av.value.map((a) => [a.occurrenceId, a])),
      now, locale: ctx.locale, siteDefaultLocale, siteTimeZone,
    })
    return succeed({ view, target })
  } catch {
    return refuse('unavailable')
  }
}
