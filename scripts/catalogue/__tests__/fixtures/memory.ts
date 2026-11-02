// Test doubles for the rollout scripts: an in-memory Sanity client bound to one
// dataset (same applyMutations as the dry run) and a fake Supabase for the C12
// audit. No network.

import { applyMutations, docsToMap, type Mutation } from '../../lib/mutations'
import { createMigrationAudit, type MigrationAuditDb } from '../../lib/audit'
import type { Doc } from '../../lib/docs'
import type { MigrationClient } from '../../lib/runner'

export class MemoryClient implements MigrationClient {
  map: Map<string, Doc>
  transactions: { transactionId: string; mutations: Mutation[] }[] = []
  reads = 0
  /** Return an error to throw instead of committing (e.g. a ConflictError once). */
  failWith: ((t: { transactionId: string; mutations: Mutation[] }, index: number) => Error | null) | null = null
  constructor(
    public dataset: string,
    docs: readonly Doc[],
  ) {
    this.map = docsToMap(JSON.parse(JSON.stringify(docs)))
  }
  async readAll() {
    this.reads++
    return JSON.parse(JSON.stringify([...this.map.values()])) as Doc[]
  }
  async mutate(mutations: Mutation[], opts: { transactionId: string }) {
    const err = this.failWith?.({ transactionId: opts.transactionId, mutations }, this.transactions.length)
    if (err) throw err
    this.map = applyMutations(this.map, mutations)
    this.transactions.push({ transactionId: opts.transactionId, mutations })
  }
  docs() {
    return [...this.map.values()]
  }
  get(id: string) {
    return this.map.get(id)
  }
}

export type FakeAuditState = { rows: Record<string, unknown>[]; tableMissing: boolean; failInserts: boolean; projects: { id: string; slug: string }[] }

export function fakeAuditDb(state: Partial<FakeAuditState> = {}): { db: MigrationAuditDb; state: FakeAuditState } {
  const s: FakeAuditState = { rows: [], tableMissing: false, failInserts: false, projects: [{ id: '00000000-0000-4000-8000-00000000a001', slug: 'tmz' }], ...state }
  const missing = { message: 'relation "public.catalogue_audit_log" does not exist', code: '42P01' }
  const db: MigrationAuditDb = {
    from(table: string) {
      return {
        insert(row: Record<string, unknown>) {
          if (table === 'catalogue_audit_log' && s.tableMissing) return Promise.resolve({ error: missing })
          if (s.failInserts) return Promise.resolve({ error: { message: 'boom', code: '500' } })
          s.rows.push(row)
          return Promise.resolve({ error: null })
        },
        select() {
          return {
            limit: () => Promise.resolve({ error: table === 'catalogue_audit_log' && s.tableMissing ? missing : null, data: [] }),
            eq: (_col: string, value: string) => Promise.resolve({ error: null, data: s.projects.filter((p) => p.slug === value).map((p) => ({ id: p.id })) }),
          }
        },
      }
    },
  }
  return { db, state: s }
}

export const fakeAudit = (state: Partial<FakeAuditState> = {}) => {
  const { db, state: s } = fakeAuditDb(state)
  return { audit: createMigrationAudit(db, { target: 'sandbox:test' }), state: s }
}
