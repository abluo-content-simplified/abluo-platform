// ── Reservations emails — reading what an email shows (ADR-044 D10) ──────────
//
// The outbox payload carries only the intent's own facts (reference, amount,
// tokens …). Everything else an email shows is read at SEND time, always
// filtered by the row's project_id: the booking's sessions, the tenant's
// payment texts, the occurrence of a cancelled session.
import type { ReservationDb } from '../server/store'
import type { ServiceStore } from '../service/types'
import type { OutboxRow } from './outbox'
import type { SessionLine } from './templates/render'

export type BookingFacts = {
  reference: string
  totalCents: number
  purchaserName: string | null
  locale: string
  anonymised: boolean
  holdExpiresAt: string | null
}

export type Content = {
  /** null = the row has a booking id but the booking is gone. */
  booking: BookingFacts | null
  sessions: SessionLine[]
  paymentInstructions: unknown
  bankDetails: unknown
}

type Row = Record<string, unknown>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function occurrences(db: ReservationDb, projectId: string, ids: string[]): Promise<SessionLine[]> {
  const clean = [...new Set(ids)].filter((i) => UUID.test(i)).slice(0, 50)
  if (!clean.length) return []
  const { data, error } = await db.from('event_occurrences').select('id, starts_at, time_zone')
    .eq('project_id', projectId).in('id', clean).order('starts_at', { ascending: true })
  if (error) throw new Error(error.message ?? 'occurrences read failed')
  return (Array.isArray(data) ? (data as Row[]) : []).map((o) => ({ startsAt: String(o.starts_at), timeZone: typeof o.time_zone === 'string' ? o.time_zone : null }))
}

export function createContentLoader(db: ReservationDb, store: Pick<ServiceStore, 'getBookingById' | 'getSettings'>) {
  return async function loadContent(row: Pick<OutboxRow, 'project_id' | 'booking_id' | 'intent' | 'payload'>): Promise<Content> {
    const projectId = row.project_id
    let booking: BookingFacts | null = null
    if (row.booking_id) {
      const b = await store.getBookingById(projectId, row.booking_id)
      if (!b.ok) throw new Error(`booking read failed: ${b.error.kind}`)
      if (b.value) {
        booking = {
          reference: b.value.reference, totalCents: b.value.totalCents, purchaserName: b.value.purchaserName,
          locale: b.value.locale, anonymised: !!b.value.anonymisedAt, holdExpiresAt: b.value.holdExpiresAt,
        }
      }
    }

    let sessions: SessionLine[] = []
    if (row.intent === 'session.cancelled') {
      const id = row.payload.occurrenceId
      sessions = typeof id === 'string' ? await occurrences(db, projectId, [id]) : []
    } else if (row.booking_id && (row.intent === 'booking.confirmed' || row.intent === 'booking.awaiting_payment')) {
      const { data, error } = await db.from('booking_allocations').select('occurrence_id')
        .eq('project_id', projectId).eq('booking_id', row.booking_id).is('released_at', null)
      if (error) throw new Error(error.message ?? 'allocations read failed')
      const ids = (Array.isArray(data) ? (data as Row[]) : []).map((a) => String(a.occurrence_id))
      sessions = await occurrences(db, projectId, ids)
    }

    let paymentInstructions: unknown = null
    let bankDetails: unknown = null
    if (row.intent === 'booking.awaiting_payment') {
      const s = await store.getSettings(projectId)
      if (!s.ok) throw new Error(`settings read failed: ${s.error.kind}`)
      paymentInstructions = s.value?.paymentInstructions ?? null
      bankDetails = s.value?.bankDetails ?? null
    }
    return { booking, sessions, paymentInstructions, bankDetails }
  }
}
