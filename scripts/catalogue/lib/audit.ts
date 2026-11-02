// ── Catalogue rollout scripts — audit, REQUIRED (C12, K-2 / D-12) ─────────────
//
// Migration rows are written through the C12 writer (recordCatalogueActivity →
// toCatalogueAuditRow, validateAuditDetail, 23505 = already recorded). The app
// writer "logs and continues" when migration 061 is missing (M0); a migration
// may NOT: audit is required, so the runner probes the table BEFORE the first
// mutation and fails the run when it is missing or unreachable, and a row that
// still cannot be written after the commit fails the run (listed in the report,
// re-recordable with the same transaction id — the unique index makes it safe).

import { auditEntry, type CatalogueAuditEntry } from '../../../src/lib/modules/catalogue/audit/events'
import { CATALOGUE_AUDIT_TABLE, isMissingTableError, recordCatalogueActivity, type AuditDb } from '../../../src/lib/modules/catalogue/audit/writer'
import type { MigrationAuditKind } from './step'

type PgError = { message: string; code?: string } | null

/** The subset of a Supabase client the migration audit uses (service role). */
export type MigrationAuditDb = {
  from(table: string): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: PgError }>
    select(cols: string, opts?: { count?: 'exact'; head?: boolean }): {
      limit(n: number): PromiseLike<{ error: PgError; data?: unknown }>
      eq(col: string, value: string): PromiseLike<{ error: PgError; data?: unknown }>
    }
  }
}

export type ProbeResult = { ok: true } | { ok: false; code: 'auditTableMissing' | 'auditUnreachable' | 'auditUnconfigured'; message: string }

export type MigrationAudit = {
  /** Read-only check that `catalogue_audit_log` exists and is reachable. */
  probe(): Promise<ProbeResult>
  /** Supabase `projects.id` for a projectSlug; null when absent or ambiguous (slugs are unique per tenant since migration 023). */
  projectIdFor(slug: string): Promise<{ id: string } | { error: 'notFound' | 'ambiguous' | 'failed'; message?: string }>
  /** true when the row is stored (or was already). */
  record(entry: CatalogueAuditEntry): Promise<boolean>
  /** Where the rows go (host only, for the report). */
  target: string
}

export function createMigrationAudit(db: MigrationAuditDb | null, opts: { target: string; overrides?: Record<string, string> }): MigrationAudit {
  return {
    target: opts.target,
    async probe() {
      if (!db) return { ok: false, code: 'auditUnconfigured', message: 'no Supabase credentials for the audit target — migrations must be audited (C12)' }
      try {
        const { error } = await db.from(CATALOGUE_AUDIT_TABLE).select('id', { count: 'exact', head: true }).limit(1)
        if (!error) return { ok: true }
        if (isMissingTableError(error)) return { ok: false, code: 'auditTableMissing', message: `table ${CATALOGUE_AUDIT_TABLE} is missing — apply migration 061 (step M0) before any data step` }
        return { ok: false, code: 'auditUnreachable', message: error.message }
      } catch (e) {
        return { ok: false, code: 'auditUnreachable', message: e instanceof Error ? e.message : String(e) }
      }
    },
    async projectIdFor(slug) {
      if (opts.overrides?.[slug]) return { id: opts.overrides[slug] }
      if (!db) return { error: 'failed', message: 'audit not configured' }
      try {
        const { error, data } = await db.from('projects').select('id').eq('slug', slug)
        if (error) return { error: 'failed', message: error.message }
        const rows = Array.isArray(data) ? (data as { id?: unknown }[]) : []
        if (rows.length === 0) return { error: 'notFound' }
        if (rows.length > 1) return { error: 'ambiguous', message: `${rows.length} Supabase projects have slug "${slug}" — pass --supabase-project ${slug}=<uuid>` }
        return typeof rows[0].id === 'string' ? { id: rows[0].id } : { error: 'failed' }
      } catch (e) {
        return { error: 'failed', message: e instanceof Error ? e.message : String(e) }
      }
    },
    async record(entry) {
      if (!db) return false
      // Observe the C12 writer's outcome: it never throws and only logs a failure.
      let stored = false
      const observed: AuditDb = {
        from: (table) => ({
          insert: (row) =>
            Promise.resolve(db.from(table).insert(row)).then((res) => {
              if (!res.error || res.error.code === '23505') stored = true
              return res
            }),
        }),
      }
      await recordCatalogueActivity(entry, { db: observed })
      return stored
    },
  }
}

/** The C12 entry of a migration step for one project (actor: system, correlation: migrationId). */
export function migrationEntry(kind: MigrationAuditKind, args: { projectId: string; transactionId: string; migrationId: string; detail: object; occurredAt: string }): CatalogueAuditEntry {
  return auditEntry(kind, {
    projectId: args.projectId,
    actor: { kind: 'system', id: null },
    transactionId: args.transactionId,
    correlationId: args.migrationId,
    detail: args.detail as never,
    occurredAt: args.occurredAt,
  })
}
