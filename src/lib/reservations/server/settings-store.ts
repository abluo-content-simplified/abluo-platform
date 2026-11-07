// ── Reservations — Booking rules store (ADR-044 D7/D13, migration 066) ────────
//
// Reads and writes `reservation_settings` (one row per project) for the Booking
// rules page. Db-agnostic like store.ts: the production wiring (service role,
// audited wrapper) is settings-store.server.ts. EVERY query carries project_id.
//
// Writes are optimistic: `version` is the number the screen loaded; the update
// matches on it and bumps it, so two people saving at once cannot overwrite each
// other (`conflict`). A project with no row yet is version 0; the first save
// inserts version 1 (a concurrent first save loses on the primary key → conflict).
// A 066-not-applied database answers `unavailable` (errors.ts).
import { fail, ok, parseReservationError, type DbErrorLike, type Result } from './errors'
import type { LocalizedText } from './types'

/** The slice of the supabase client used here (loose, so a fake can stand in). */
export type SettingsDb = {
  from: (table: string) => any // eslint-disable-line @typescript-eslint/no-explicit-any
}

export type StoredSettings = {
  projectId: string
  rules: unknown
  bankDetails: LocalizedText | null
  paymentInstructions: LocalizedText | null
  referencePrefix: string | null
  version: number
}

export type SettingsWrite = {
  rules: Record<string, unknown>
  bankDetails: LocalizedText | null
  paymentInstructions: LocalizedText | null
  referencePrefix: string | null
}

export type PriceCategoryRow = {
  id: string
  key: string
  label: LocalizedText
  requiresMembership: boolean
  sort: number
  version: number
}

export type SettingsStore = {
  /** `null` data = the project has no row yet (defaults apply, version 0). */
  get(projectId: string): Promise<Result<StoredSettings | null>>
  /** `expectedVersion` 0 = first save. Returns the stored row, or a `conflict`. */
  save(projectId: string, expectedVersion: number, write: SettingsWrite): Promise<Result<StoredSettings>>
  /** Active (not archived) price categories, in order. */
  listPriceCategories(projectId: string): Promise<Result<PriceCategoryRow[]>>
}

const COLUMNS = 'project_id, rules, bank_details, payment_instructions, reference_prefix, version'
const CATEGORY_COLUMNS = 'id, key, label, requires_membership, sort, version'

type Row = Record<string, unknown>
const obj = (v: unknown): LocalizedText | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as LocalizedText) : null)
const unavailable = () => fail({ kind: 'unavailable' })

function rowOf(r: Row): StoredSettings {
  return {
    projectId: String(r.project_id ?? ''),
    rules: r.rules && typeof r.rules === 'object' ? r.rules : {},
    bankDetails: obj(r.bank_details),
    paymentInstructions: obj(r.payment_instructions),
    referencePrefix: typeof r.reference_prefix === 'string' && r.reference_prefix ? r.reference_prefix : null,
    version: Number(r.version) || 1,
  }
}

export function createSettingsStore(db: SettingsDb): SettingsStore {
  return {
    async get(projectId) {
      try {
        const { data, error } = await db.from('reservation_settings').select(COLUMNS).eq('project_id', projectId).limit(1)
        if (error) return fail(parseReservationError(error as DbErrorLike))
        return ok(Array.isArray(data) && data[0] ? rowOf(data[0] as Row) : null)
      } catch {
        return unavailable()
      }
    },

    async save(projectId, expectedVersion, write) {
      const columns = {
        rules: write.rules,
        bank_details: write.bankDetails,
        payment_instructions: write.paymentInstructions,
        reference_prefix: write.referencePrefix,
      }
      try {
        if (expectedVersion <= 0) {
          const { data, error } = await db.from('reservation_settings').insert({ project_id: projectId, ...columns, version: 1 }).select(COLUMNS)
          // 23505: another save created the row first — the screen is out of date.
          if (error?.code === '23505') return fail({ kind: 'conflict', code: 'changed' })
          if (error) return fail(parseReservationError(error as DbErrorLike))
          return Array.isArray(data) && data[0] ? ok(rowOf(data[0] as Row)) : unavailable()
        }
        const { data, error } = await db
          .from('reservation_settings')
          .update({ ...columns, version: expectedVersion + 1, updated_at: new Date().toISOString() })
          .eq('project_id', projectId)
          .eq('version', expectedVersion)
          .select(COLUMNS)
        if (error) return fail(parseReservationError(error as DbErrorLike))
        if (!Array.isArray(data) || !data[0]) return fail({ kind: 'conflict', code: 'changed' })
        return ok(rowOf(data[0] as Row))
      } catch {
        return unavailable()
      }
    },

    async listPriceCategories(projectId) {
      try {
        const { data, error } = await db
          .from('price_categories')
          .select(CATEGORY_COLUMNS)
          .eq('project_id', projectId)
          .is('archived_at', null)
          .order('sort', { ascending: true })
        if (error) return fail(parseReservationError(error as DbErrorLike))
        return ok(
          (Array.isArray(data) ? (data as Row[]) : []).map((r) => ({
            id: String(r.id ?? ''),
            key: String(r.key ?? ''),
            label: obj(r.label) ?? {},
            requiresMembership: r.requires_membership === true,
            sort: Number(r.sort) || 0,
            version: Number(r.version) || 1,
          })),
        )
      } catch {
        return unavailable()
      }
    },
  }
}
