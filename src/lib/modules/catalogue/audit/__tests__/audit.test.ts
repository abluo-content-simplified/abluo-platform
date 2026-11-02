// C12 §12.7 fixtures for M0 (writer + payload rules) and the SQL kind CHECK.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ runAsTrustedSystemOperation: vi.fn() }))

import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { AUDIT_DETAIL_KEYS, AUDIT_KIND_PATTERN, AUDIT_VISIBILITY, CATALOGUE_AUDIT_KINDS, auditEntry, auditScopeOf, validateAuditDetail, type CatalogueAuditEntry } from '../events'
import { CATALOGUE_AUDIT_LOG_TAG, auditedCatalogue, isMissingTableError, recordCatalogueActivity, resetCatalogueAuditWarnings, toCatalogueAuditRow } from '../writer'

const MIGRATION = readFileSync(join(process.cwd(), 'supabase', 'migrations', '061_catalogue_audit_log.sql'), 'utf8')

function fakeDb(results: Array<{ error: { message: string; code?: string } | null } | Error>) {
  const inserted: Record<string, unknown>[] = []
  let i = 0
  const db = {
    from: vi.fn(() => ({
      insert: vi.fn(async (row: Record<string, unknown>) => {
        inserted.push(row)
        const r = results[Math.min(i++, results.length - 1)]
        if (r instanceof Error) throw r
        return r
      }),
    })),
  }
  return { db, inserted }
}

const entry = (o: Partial<CatalogueAuditEntry> = {}): CatalogueAuditEntry =>
  auditEntry('readiness.override_recorded', {
    projectId: 'p1',
    targetId: 'item-1',
    actor: { kind: 'user', id: 'u1' },
    transactionId: 'abluo-dash-1',
    detail: { itemId: 'item-1', ruleCode: 'descriptionMissing', contextKey: 'website', standard: 'default', standardVersion: 1 },
    ...o,
  } as never)

let errorSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  resetCatalogueAuditWarnings()
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => errorSpy.mockRestore())
const logged = (): string[] => errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))

describe('migration 061 ↔ TS kinds', () => {
  it('A-18/A-19 every CatalogueAuditKind (incl. public_name.migrated) passes the SQL CHECK, which is the TS pattern verbatim', () => {
    const check = MIGRATION.match(/kind\s+text not null check \(kind ~ '([^']+)'\)/)?.[1]
    expect(check).toBe(AUDIT_KIND_PATTERN.source)
    for (const k of CATALOGUE_AUDIT_KINDS) expect(new RegExp(check!).test(k), k).toBe(true)
    expect(AUDIT_KIND_PATTERN.test('Public_Name.migrated')).toBe(false)
    expect(AUDIT_KIND_PATTERN.test('nodot')).toBe(false)
  })

  it('the scope CHECK lists exactly the TS scopes, and every kind maps to one of them', () => {
    const scopes = MIGRATION.match(/scope in \(([^)]+)\)/)?.[1].split(',').map((s) => s.trim().replace(/'/g, ''))
    expect(scopes).toEqual(['project', 'item', 'collection', 'category', 'channel', 'standard', 'import', 'export'])
    for (const k of CATALOGUE_AUDIT_KINDS) expect(scopes).toContain(auditScopeOf(k, { documentType: 'catalogueItem' } as never))
  })

  it('is additive and guarded: refuses to run twice, RLS on, no grants to anon/authenticated, the idempotency index', () => {
    expect(MIGRATION).toMatch(/already applied — stop/)
    expect(MIGRATION).toMatch(/enable row level security/)
    expect(MIGRATION).toMatch(/revoke all on public\.catalogue_audit_log from anon, authenticated/)
    expect(MIGRATION).toMatch(/create unique index catalogue_audit_txn on public\.catalogue_audit_log \(transaction_id, kind, coalesce\(target_id, ''\)\) where transaction_id is not null/)
    expect(MIGRATION).not.toMatch(/\b(drop|alter)\s+table\s+(?!public\.catalogue_audit_log)/i)
  })
})

describe('C12 payloads', () => {
  it('A-02 every kind has an allowlist and a visibility entry', () => {
    expect(Object.keys(AUDIT_DETAIL_KEYS).sort()).toEqual([...CATALOGUE_AUDIT_KINDS].sort())
    expect(Object.keys(AUDIT_VISIBILITY).sort()).toEqual([...CATALOGUE_AUDIT_KINDS].sort())
    expect(AUDIT_VISIBILITY['studio.write_outside_gate']).toBe('internal')
  })

  it('A-01 payload-allowlist: unknown field, free text, long strings and > 8 KB are refused', () => {
    const ok = { itemId: 'i', status: 'containsListedAllergens', contains: ['milk'], mayContain: [], basis: 'recipe', riskAssessmentConfirmed: false, declarationVersion: 1, previousStatus: 'notReviewed', scope: 'item' }
    expect(validateAuditDetail('allergen.reviewed', ok)).toBe(true)
    expect(validateAuditDetail('allergen.reviewed', { ...ok, note: 'free text' })).toBe(false)
    expect(validateAuditDetail('allergen.reviewed', { ...ok, itemId: 'x'.repeat(65) })).toBe(false)
    expect(validateAuditDetail('pack.updated', { packId: 'p', fromVersion: 1, toVersion: 2, added: Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`k${i}`, i])) })).toBe(false)
    expect(validateAuditDetail('allergen.reviewed', 'string')).toBe(false)
    expect(validateAuditDetail('allergen.reviewed', [ok])).toBe(false)
  })

  it('A-01 public_name.migrated label maps may hold ≤ 200 characters (K-2), not more', () => {
    const d = { migrationId: 'catalogue-public-name', action: 'copy', old: { it: 'Menù', en: 'Menu' }, new: { it: 'Menù', en: 'Menu' }, discarded: null }
    expect(validateAuditDetail('public_name.migrated', d)).toBe(true)
    expect(validateAuditDetail('public_name.migrated', { ...d, old: { it: 'x'.repeat(200) } })).toBe(true)
    expect(validateAuditDetail('public_name.migrated', { ...d, old: { it: 'x'.repeat(201) } })).toBe(false)
    expect(validateAuditDetail('public_name.migrated', { ...d, migrationId: 'x'.repeat(65) })).toBe(false)
  })

  it('A-18/A-19 the new kinds validate and carry only ids, keys, counts, enums and hashes', () => {
    const s = { baseline: 'unavailable', overrides: 1, daysCovered: 7, fingerprint: 'h1' }
    const samples: Array<[Parameters<typeof validateAuditDetail>[0], object]> = [
      ['channel.removed', { channelKey: 'delivery', cleanup: { categoryRules: 1, itemRules: 2, formatRules: 0, prices: 3 } }],
      ['channel.default_changed', { channelKey: 'delivery', before: s, after: s, impact: { items: 1, formats: 1, toAvailable: 0, toUnavailable: 1, shieldedByOverride: 0 } }],
      ['migration.commerce', { migrationId: 'm1', items: 16, formats: 16, prices: 12, legacyOffersKept: 0, equivalence: 'verified' }],
      ['migration.taxonomy', { migrationId: 'm2', categories: 4, tags: 2, itemsAssigned: 16, itemsUnassigned: 0 }],
      ['migration.pack_history', { migrationId: 'm3', converted: [{ packId: 'bookshop', packVersion: 1 }] }],
      ['pack.interrupted', { packId: 'bookshop', packVersion: 2, stage: 'categories', resumable: true }],
      ['availability.schedule_changed', { level: 'item', targetKey: 'i1', channel: null, before: s, after: s, affected: { items: 1, formats: 1 } }],
      ['compliance.task_created', { taskId: 't1', itemId: 'i1', reason: 'linkedItemChanged', createdDraft: true, linkedItemId: 'i2' }],
      ['allergen.linked_invalidated', { parentItemId: 'i1', linkedItemId: 'i2', trigger: 'linkedItemPublished', previousStatus: 'noneDeclared', taskId: 't1' }],
      ['allergen.dependency_removed', { itemId: 'i1', what: 'optionListDetached', listId: 'L', previousStatus: 'noneDeclared' }],
      ['readiness.override_recorded', { itemId: 'i1', ruleCode: 'descriptionMissing', contextKey: 'website', standard: 'default', standardVersion: 1 }],
      ['readiness.override_expired', { itemId: 'i1', ruleCode: 'descriptionMissing', contextKey: 'website', cause: 'resolved' }],
      ['studio.write_outside_gate', { documentType: 'catalogueItem', documentId: 'i1', transactionId: 'abc', detectedBy: 'webhook' }],
    ]
    for (const [kind, detail] of samples) {
      expect(AUDIT_KIND_PATTERN.test(kind), kind).toBe(true)
      expect(validateAuditDetail(kind, detail), kind).toBe(true)
    }
  })

  it('auditEntry derives the scope and marks support mode', () => {
    const e = auditEntry('studio.break_glass_publish', { projectId: 'p', actor: { kind: 'studio', id: 'a1' }, detail: { grantId: 'g', documentType: 'catalogueCollection', documentId: 'c', documents: 1 } })
    expect(e).toMatchObject({ scope: 'collection', actorKind: 'studio', actorId: 'a1', outcome: 'ok' })
    const s = auditEntry('bulk.executed', { projectId: 'p', actor: { kind: 'user', id: 'u', support: true }, detail: { bulkId: 'b', op: 'publish', requested: 1, done: 1, blocked: 0, skipped: 0, blockedByCode: {} } })
    expect(s.detail).toMatchObject({ support: true })
    expect(validateAuditDetail('bulk.executed', s.detail)).toBe(true)
  })
})

describe('C12 writer — M0: works with and without the table', () => {
  it('with the table: inserts the snake_case row once', async () => {
    const { db, inserted } = fakeDb([{ error: null }])
    await recordCatalogueActivity(entry(), { db })
    expect(inserted).toEqual([toCatalogueAuditRow(entry())])
    expect(inserted[0]).toMatchObject({ project_id: 'p1', kind: 'readiness.override_recorded', scope: 'item', target_id: 'item-1', actor_kind: 'user', actor_id: 'u1', outcome: 'ok', transaction_id: 'abluo-dash-1', correlation_id: null })
    expect(db.from).toHaveBeenCalledWith('catalogue_audit_log')
    expect(logged()).toEqual([])
  })

  it.each([
    ['Postgres 42P01', { message: 'relation "public.catalogue_audit_log" does not exist', code: '42P01' }],
    ['PostgREST PGRST205', { message: "Could not find the table 'public.catalogue_audit_log' in the schema cache", code: 'PGRST205' }],
  ])('without the table (%s): log once and continue — no retry, no throw', async (_l, error) => {
    const { db, inserted } = fakeDb([{ error }])
    await expect(recordCatalogueActivity(entry(), { db })).resolves.toBeUndefined()
    await expect(recordCatalogueActivity(entry(), { db })).resolves.toBeUndefined()
    expect(inserted).toHaveLength(2) // one attempt per call, no retry
    expect(logged().filter((l) => l.includes('migration 061 not applied'))).toHaveLength(1)
    expect(logged()[0]).toContain(CATALOGUE_AUDIT_LOG_TAG)
  })

  it('A-16 idempotent-txn: 23505 is success', async () => {
    const { db, inserted } = fakeDb([{ error: { message: 'dup', code: '23505' } }])
    await recordCatalogueActivity(entry(), { db })
    expect(inserted).toHaveLength(1)
    expect(logged()).toEqual([])
  })

  it('A-15 writer-never-throws: db throws twice → resolves, logs once', async () => {
    const { db, inserted } = fakeDb([new Error('down'), new Error('still down')])
    await expect(recordCatalogueActivity(entry(), { db })).resolves.toBeUndefined()
    expect(inserted).toHaveLength(2)
    expect(logged().filter((l) => l.startsWith(CATALOGUE_AUDIT_LOG_TAG))).toHaveLength(1)
  })

  it('a transient error is retried once', async () => {
    const { db, inserted } = fakeDb([{ error: { message: 'blip' } }, { error: null }])
    await recordCatalogueActivity(entry(), { db })
    expect(inserted).toHaveLength(2)
    expect(logged()).toEqual([])
  })

  it('a payload outside the allowlist is never inserted (and its content never logged)', async () => {
    const { db, inserted } = fakeDb([{ error: null }])
    await recordCatalogueActivity({ ...entry(), detail: { itemId: 'i', reason: 'secret override reason' } }, { db })
    expect(inserted).toEqual([])
    expect(logged().join('\n')).not.toContain('secret')
  })

  it('without Supabase configured: says so once, never throws', async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    await recordCatalogueActivity(entry())
    await recordCatalogueActivity(entry())
    expect(logged().filter((l) => l.includes('not configured'))).toHaveLength(1)
    expect(runAsTrustedSystemOperation).not.toHaveBeenCalled()
    if (url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = url
  })

  it('isMissingTableError recognises only the missing-table shapes', () => {
    expect(isMissingTableError({ code: '42P01', message: '' })).toBe(true)
    expect(isMissingTableError({ code: '23505', message: 'dup' })).toBe(false)
    expect(isMissingTableError(null)).toBe(false)
  })
})

describe('auditedCatalogue', () => {
  const ctx = { userId: 'u1', support: undefined }

  it('records ok with the dashboard-prefixed transaction id it handed to run', async () => {
    const rows: CatalogueAuditEntry[] = []
    let seen = ''
    const v = await auditedCatalogue({ ctx, projectId: 'p', kind: 'standard.changed', scope: 'standard', targetId: 'default', writer: async (e) => void rows.push(e), uuid: () => 'u-1' }, async (txn) => {
      seen = txn
      return { value: 42, detail: { standardKey: 'default', fromVersion: 1, toVersion: 2, rules: { added: [], removed: [], levelChanged: [] }, overridesExpired: 0 } }
    })
    expect(v).toBe(42)
    expect(seen).toBe('abluo-dash-u-1')
    expect(rows).toMatchObject([{ kind: 'standard.changed', outcome: 'ok', transactionId: 'abluo-dash-u-1', scope: 'standard', targetId: 'default', actorId: 'u1' }])
  })

  it('records refused (no transaction id) and re-throws unchanged', async () => {
    const rows: CatalogueAuditEntry[] = []
    const err = new TenantAuthorizationError('forbidden')
    await expect(auditedCatalogue({ ctx: { userId: 'u1', support: {} as never }, projectId: 'p', kind: 'pack.applied', writer: async (e) => void rows.push(e) }, async () => { throw err })).rejects.toBe(err)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ outcome: 'refused', detail: { support: true } })
    expect(rows[0].transactionId).toBeUndefined()
  })

  it('a failing writer never changes what the caller sees', async () => {
    await expect(auditedCatalogue({ ctx, projectId: 'p', kind: 'pack.interrupted', writer: async () => { throw new Error('db') } }, async () => ({ value: 'ok', detail: {} }))).resolves.toBe('ok')
  })
})
