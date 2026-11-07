// Test helper: an in-memory ServiceStore that records calls and returns canned data.
import { createHash } from 'crypto'
import { fail, ok, type ReservationError, type Result } from '../../server/errors'
import type { BookingOptionRow, BookingRow, PassRow, ReservableTargetRow, ReservationSettingsRow } from '../../server/types'
import type { AffectedBooking, NoticeRecipient, OutboxItem, ServiceDeps, ServiceStore } from '../types'
import type { BookingRulesOverride } from '../../types'

export const P = 'p0000000-0000-4000-8000-000000000001'
export const TARGET = 't0000000-0000-4000-8000-000000000001'
export const OPT = 'o0000000-0000-4000-8000-000000000001'
export const O1 = '22222222-2222-4222-8222-222222222221'
export const O2 = '22222222-2222-4222-8222-222222222222'
export const NOW = new Date('2026-11-07T10:00:00Z')
export const TZ = 'Europe/Rome'
export const REF = { ownerType: 'course' as const, ownerPublicId: 'c-yoga', editionId: null }

export const settings = (rules: BookingRulesOverride = {}, referencePrefix: string | null = 'CYCE'): ReservationSettingsRow => ({
  projectId: P, rules, bankDetails: null, paymentInstructions: null, termsNote: null, referencePrefix, supportAccessUntil: null, version: 1,
})
export const target = (over: Partial<ReservableTargetRow> = {}): ReservableTargetRow => ({
  id: TARGET, projectId: P, ownerType: 'course', ownerPublicId: 'c-yoga', editionId: null, registrationStatus: 'open',
  opensAt: null, closesAt: null, minParticipants: null, minDecisionAt: null, defaultPlaces: null, maxPasses: null,
  includeNewSessions: false, rulesOverride: null, version: 1, ...over,
})
export const option = (over: Partial<BookingOptionRow> = {}): BookingOptionRow => ({
  id: OPT, projectId: P, targetId: TARGET, kind: 'sessions', label: { en: 'Workshop' }, description: null, status: 'active',
  sessionIds: null, passScope: null, passScopeOwnerIds: null, passValidity: null, passValidTo: null, passDurationMonths: null,
  passEntries: null, requiresMembership: false, minAge: null, maxAge: null, sort: 0,
  prices: [{ id: 'pr1', optionId: OPT, priceCategoryId: null, amountCents: 2000, currency: 'EUR', validFrom: null }], ...over,
})
export const bookingRow = (over: Partial<BookingRow> = {}): BookingRow => ({
  id: 'b1', projectId: P, targetId: TARGET, optionId: OPT, reference: 'CYCE-AAAAA', status: 'confirmed', paymentStatus: 'paid',
  paymentReview: false, eligibilityReview: false, locale: 'it', source: 'website', purchaserName: 'Anna Rossi',
  purchaserEmail: 'anna@example.test', purchaserPhone: null, totalCents: 2000, snapshot: {}, holdExpiresAt: null, confirmedAt: null,
  cancelledAt: null, anonymisedAt: null, version: 1, createdAt: NOW.toISOString(), ...over,
})
export const passRow = (over: Partial<PassRow> = {}): PassRow => ({
  id: 'pass1', projectId: P, bookingId: 'b1', attendeeId: 'a1', optionId: OPT, targetId: TARGET, scope: 'all_courses', scopeOwnerIds: null,
  validFrom: '2026-11-01', validTo: '2027-06-30', entriesTotal: 10, status: 'active', anonymisedAt: null, version: 1, ...over,
})

type Overrides = {
  settings?: ReservationSettingsRow | null
  target?: ReservableTargetRow | null
  options?: BookingOptionRow[]
  /** Called for each book(); return an error to simulate. Default: ok. */
  book?: (n: number, payload: Record<string, any>) => Result<{ bookingId: string; reference: string; replayed: boolean }> // eslint-disable-line @typescript-eslint/no-explicit-any
  bookingByToken?: BookingRow | null
  passByToken?: PassRow | null
  affected?: AffectedBooking[]
  recipients?: NoticeRecipient[]
  bookingById?: BookingRow | null
  expired?: Array<{ bookingId: string; projectId: string }>
  release?: Result<{ released: number; cancelled: boolean }>
  recordPayment?: Result<any> // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type Call = { fn: string; args: unknown[] }

export function makeStore(o: Overrides = {}) {
  const calls: Call[] = []
  const outbox: OutboxItem[] = []
  const rec = <T,>(fn: string, args: unknown[], value: T): Promise<T> => { calls.push({ fn, args }); return Promise.resolve(value) }
  let bookN = 0
  const impl: Partial<ServiceStore> = {
    getSettings: (...a) => rec('getSettings', a, ok(o.settings === undefined ? settings() : o.settings)),
    getTarget: (...a) => rec('getTarget', a, ok(o.target === undefined ? target() : o.target)),
    listOptions: (...a) => rec('listOptions', a, ok(o.options ?? [option()])),
    book: (...a) => {
      bookN++
      const payload = a[1] as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
      const res = o.book ? o.book(bookN, payload) : ok({ bookingId: 'bk1', reference: String(payload.reference), replayed: false })
      return rec('book', a, res)
    },
    getBookingByTokenHash: (...a) => rec('getBookingByTokenHash', a, ok(o.bookingByToken === undefined ? bookingRow() : o.bookingByToken)),
    getPassByTokenHash: (...a) => rec('getPassByTokenHash', a, ok(o.passByToken === undefined ? passRow() : o.passByToken)),
    passAttend: (...a) => rec('passAttend', a, ok({ allocationId: 'al1', replayed: false })),
    passWithdraw: (...a) => {
      const opts = a[3] as { returnEntry: boolean }
      return rec('passWithdraw', a, ok({ released: true, entryReturned: opts.returnEntry }))
    },
    release: (...a) => rec('release', a, o.release ?? ok({ released: 1, cancelled: (a[3] as { cancelBooking?: boolean } | undefined)?.cancelBooking === true })),
    recordPayment: (...a) => rec('recordPayment', a, o.recordPayment ?? ok({ paymentId: 'pay1', paymentStatus: 'paid', confirm: { confirmed: true, replayed: false, full: [] } })),
    expireHolds: (...a) => rec('expireHolds', a, ok(o.expired ?? [])),
    getBookingById: (...a) => rec('getBookingById', a, ok(o.bookingById === undefined ? bookingRow() : o.bookingById)),
    enqueueOutbox: (...a) => { outbox.push(...(a[1] as OutboxItem[])); return rec('enqueueOutbox', a, ok({ queued: (a[1] as OutboxItem[]).length })) },
    listAffectedBookings: (...a) => rec('listAffectedBookings', a, ok(o.affected ?? [])),
    listNoticeRecipients: (...a) => rec('listNoticeRecipients', a, ok(o.recipients ?? [])),
  }
  const store = new Proxy(impl, {
    get: (t, p: string) => t[p as keyof ServiceStore] ?? (() => { throw new Error(`unexpected store call: ${p}`) }),
  }) as unknown as ServiceStore
  return { store, calls, outbox, called: (fn: string) => calls.filter((c) => c.fn === fn) }
}

/** Deterministic "random": a counter-fed byte stream. */
export function counterBytes(seed = 1) {
  let n = seed
  return (len: number) => { const b = new Uint8Array(len); for (let i = 0; i < len; i++) b[i] = (n = (n * 73 + 41) % 256); return b }
}

export function makeDeps(store: ServiceStore, over: Partial<ServiceDeps> = {}): ServiceDeps {
  return { store, now: () => NOW, randomBytes: counterBytes(), environment: 'production', ...over }
}

export const hash = (v: string) => createHash('sha256').update(v).digest('hex')
export const refused = (code: string): Result<never> => fail({ kind: 'refused', code } as ReservationError)
export const conflict = (code: string): Result<never> => fail({ kind: 'conflict', code } as ReservationError)
