/** The data-step runner with an in-memory Sanity client and a fake Supabase — no network. */
import { describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 60_000 })
import { runDataStep, type RunOptions } from '../lib/runner'
import { ConflictError } from '../lib/mutations'
import { DatasetMismatchError } from '../lib/guards'
import { catalogueInstallation } from '../lib/docs'
import { taxonomyStep } from '../lib/step-taxonomy'
import { commerceStep } from '../lib/step-commerce'
import { packHistoryStep } from '../lib/step-pack-history'
import { publicNameStep } from '../lib/step-public-name'
import { DATA_STEPS } from '../lib/preflight'
import { isAuthorisedCatalogueTransaction } from '@/lib/sanity/studio/catalogue-posture'
import { validateAuditDetail } from '@/lib/modules/catalogue/audit/events'
import { MemoryClient, fakeAudit } from './fixtures/memory'
import { tmzProduction, TMZ_COUNTS } from './fixtures/tmz-production'

const NOW = () => new Date('2026-11-05T10:00:00.000Z')
const opts = (over: Partial<RunOptions> & Pick<RunOptions, 'step' | 'client'>): RunOptions => ({
  audit: fakeAudit().audit,
  dataset: 'staging',
  apply: true,
  readReport: () => null,
  migrationId: `${over.step.step.toLowerCase()}-staging-202611051000`,
  now: NOW,
  ...over,
})
const tmzConfig = (c: MemoryClient) => catalogueInstallation(c.get('project-tmz'))!.config

describe('runner — the complete rehearsal D1 → D4 on staging', () => {
  it('migrates tmz, verifies each step, writes markers and one audit row per step', async () => {
    const client = new MemoryClient('staging', tmzProduction())
    const { audit, state } = fakeAudit()
    const before = tmzProduction()
    for (const step of DATA_STEPS) {
      const r = await runDataStep(opts({ step, client, audit, before, migrationId: `${step.step.toLowerCase()}-staging-202611051000` }))
      expect(r.refusals).toEqual([])
      expect(r.verification?.pass).toBe(true)
      expect(r.green).toBe(true)
      expect(r.mode).toBe('apply')
      expect(r.itemCounts).toEqual(TMZ_COUNTS)
      expect(r.projects[0].marker).toBe('2026-11-05T10:00:00.000Z')
      expect(r.projects[0].audit).toBe('recorded')
    }
    expect(Object.keys(tmzConfig(client).catalogueMigrations as object)).toEqual(['taxonomy', 'commerce', 'packHistory', 'publicName'])
    expect(state.rows.map((r) => r.kind)).toEqual(['migration.taxonomy', 'migration.commerce', 'migration.pack_history', 'public_name.migrated'])
    for (const row of state.rows) {
      expect(row).toMatchObject({ project_id: '00000000-0000-4000-8000-00000000a001', actor_kind: 'system', actor_id: null, outcome: 'ok', scope: 'project' })
      expect(String(row.transaction_id)).toMatch(/^abluo-migr-[a-z0-9-]+-\d+$/)
      expect(validateAuditDetail(row.kind as never, row.detail)).toBe(true)
    }
    expect(state.rows[0].detail).toEqual({ migrationId: 'taxonomy-staging-202611051000', categories: 3, tags: 7, itemsAssigned: 15, itemsUnassigned: 1 })
    expect(state.rows[1].detail).toMatchObject({ items: 4, formats: 4, prices: 4, legacyOffersKept: 4, equivalence: 'verified' })
    expect(state.rows[2].detail).toMatchObject({ converted: [{ packId: 'bookshop', packVersion: 1 }] })
    // every transaction is an authorised Catalogue writer (never studio.write_outside_gate)
    for (const t of client.transactions) expect(isAuthorisedCatalogueTransaction(t.transactionId)).toBe(true)
    expect(tmzConfig(client).publicName).toEqual({ _type: 'localizedString', en: 'Books', it: 'Libri', de: 'Bücher' })
  })

  it('second run of every step is a no-op: no transactions, no audit rows, still green', async () => {
    const client = new MemoryClient('staging', tmzProduction())
    const { audit, state } = fakeAudit()
    for (const step of DATA_STEPS) await runDataStep(opts({ step, client, audit }))
    const txns = client.transactions.length
    const rows = state.rows.length
    for (const step of DATA_STEPS) {
      const r = await runDataStep(opts({ step, client, audit, migrationId: `${step.step.toLowerCase()}-staging-202611051100` }))
      expect(r.transactions).toEqual([])
      expect(r.green).toBe(true)
    }
    expect(client.transactions.length).toBe(txns)
    expect(state.rows.length).toBe(rows)
  })
})

describe('runner — dry run (default)', () => {
  it('writes nothing, reports the planned transactions and the in-memory verification', async () => {
    const client = new MemoryClient('staging', tmzProduction())
    const { audit, state } = fakeAudit()
    const r = await runDataStep(opts({ step: taxonomyStep, client, audit, apply: false }))
    expect(client.transactions).toEqual([])
    expect(state.rows).toEqual([])
    expect(r.mode).toBe('dry-run')
    expect(r.reportId).toMatch(/-dry-run$/)
    expect(r.transactions.length).toBeGreaterThan(0)
    expect(r.verification?.pass).toBe(true)
    expect(r.green).toBe(true)
  })
})

describe('runner — refusals', () => {
  it('a client bound to another dataset is refused before any read or write', async () => {
    const client = new MemoryClient('production', tmzProduction())
    await expect(runDataStep(opts({ step: taxonomyStep, client, dataset: 'staging' }))).rejects.toBeInstanceOf(DatasetMismatchError)
    expect(client.reads).toBe(0)
    expect(client.transactions).toEqual([])
  })

  it('production without --approval is refused', async () => {
    const client = new MemoryClient('production', tmzProduction())
    const r = await runDataStep(opts({ step: taxonomyStep, client, dataset: 'production' }))
    expect(r.stoppedAt).toBe('guard')
    expect(r.refusals[0].code).toBe('approval.required')
    expect(client.transactions).toEqual([])
  })

  it('production with a missing or non-green staging report is refused; a green one passes', async () => {
    const missing = await runDataStep(opts({ step: taxonomyStep, client: new MemoryClient('production', tmzProduction()), dataset: 'production', approval: 'd1-taxonomy-staging-202611051000' }))
    expect(missing.refusals[0].code).toBe('approval.reportMissing')
    const red = await runDataStep(
      opts({ step: taxonomyStep, client: new MemoryClient('production', tmzProduction()), dataset: 'production', approval: 'x', readReport: () => ({ dataset: 'staging', mode: 'apply', step: 'taxonomy', green: false }) }),
    )
    expect(red.refusals[0].code).toBe('approval.notGreen')
    const client = new MemoryClient('production', tmzProduction())
    const ok = await runDataStep(opts({ step: taxonomyStep, client, dataset: 'production', approval: 'x', readReport: () => ({ dataset: 'staging', mode: 'apply', step: 'taxonomy', green: true }) }))
    expect(ok.green).toBe(true)
    expect(client.transactions.length).toBeGreaterThan(0)
  })

  it('other datasets are never writable', async () => {
    const r = await runDataStep(opts({ step: taxonomyStep, client: new MemoryClient('development', tmzProduction()), dataset: 'development' }))
    expect(r.refusals[0].code).toBe('dataset.notWritable')
  })

  it('a missing audit table FAILS the run before any mutation (audit is required)', async () => {
    const client = new MemoryClient('staging', tmzProduction())
    const r = await runDataStep(opts({ step: taxonomyStep, client, audit: fakeAudit({ tableMissing: true }).audit }))
    expect(r.stoppedAt).toBe('audit')
    expect(r.green).toBe(false)
    expect(client.transactions).toEqual([])
  })

  it('no audit configured FAILS an apply before any mutation', async () => {
    const client = new MemoryClient('staging', tmzProduction())
    const r = await runDataStep(opts({ step: taxonomyStep, client, audit: null }))
    expect(r.stoppedAt).toBe('audit')
    expect(client.transactions).toEqual([])
  })

  it('an unknown Supabase project FAILS before any mutation', async () => {
    const client = new MemoryClient('staging', tmzProduction())
    const r = await runDataStep(opts({ step: taxonomyStep, client, audit: fakeAudit({ projects: [] }).audit }))
    expect(r.refusals[0].code).toBe('audit.project.notFound')
    expect(client.transactions).toEqual([])
  })

  it('D2 before D1 is refused for the project (precondition marker)', async () => {
    const client = new MemoryClient('staging', tmzProduction())
    const r = await runDataStep(opts({ step: commerceStep, client }))
    expect(r.refusals).toMatchObject([{ code: 'precondition.markerMissing', project: 'tmz', detail: { requires: 'taxonomy' } }])
    expect(client.transactions).toEqual([])
  })

  it('D4 needs the D1–D3 markers', async () => {
    const r = await runDataStep(opts({ step: publicNameStep, client: new MemoryClient('staging', tmzProduction()) }))
    expect(r.refusals.map((x) => (x.detail as { requires: string }).requires)).toEqual(['taxonomy', 'commerce', 'packHistory'])
  })

  it('an audit row that cannot be written after the commit makes the run not green and lists it', async () => {
    const client = new MemoryClient('staging', tmzProduction())
    const r = await runDataStep(opts({ step: packHistoryStep, client, audit: fakeAudit({ failInserts: true }).audit }))
    expect(client.transactions.length).toBeGreaterThan(0)
    expect(r.green).toBe(false)
    expect(r.audit.pending).toHaveLength(1)
  })
})

describe('runner — transactions', () => {
  it('ids are abluo-migr-<migrationId>-<n>; draft/published pairs are never split even with a tiny payload limit', async () => {
    const client = new MemoryClient('staging', tmzProduction())
    await runDataStep(opts({ step: taxonomyStep, client, limit: 3_000 }))
    expect(client.transactions.length).toBeGreaterThan(1)
    client.transactions.forEach((t, i) => expect(t.transactionId).toBe(`abluo-migr-taxonomy-staging-202611051000-${i + 1}`))
    for (const t of client.transactions) {
      const ids = t.mutations.flatMap((m) => ('patch' in m ? [m.patch.id] : []))
      for (const id of ids) {
        const pair = id.startsWith('drafts.') ? id.slice(7) : `drafts.${id}`
        if (client.get(pair)) expect(client.transactions.find((x) => x.mutations.some((m) => 'patch' in m && m.patch.id === pair))).toBe(t)
      }
    }
  })

  it('a revision conflict re-reads and re-plans (idempotent), then completes', async () => {
    const client = new MemoryClient('staging', tmzProduction())
    let failed = false
    client.failWith = (t) => {
      if (failed || !t.mutations.some((m) => 'patch' in m)) return null
      failed = true
      return new ConflictError('b1a7e0c2-0001', 'revision')
    }
    const r = await runDataStep(opts({ step: taxonomyStep, client }))
    expect(r.green).toBe(true)
    expect(new Set(r.transactions.map((t) => t.transactionId)).size).toBe(r.transactions.length)
    expect(client.get('drafts.c2c4fa97-0011')!.primaryCategory).toBe('technology')
  })

  it('revert (D4) with the P′ export restores navLabel; no audit needed', async () => {
    const p = tmzProduction()
    const client = new MemoryClient('staging', p)
    for (const step of DATA_STEPS) await runDataStep(opts({ step, client }))
    const r = await runDataStep(opts({ step: publicNameStep, client, revert: true, rollback: p, audit: null }))
    expect(r.green).toBe(true)
    expect(tmzConfig(client).navLabel).toEqual({ _type: 'localizedString', en: 'Books', it: 'Libri', de: 'Bücher' })
    expect(tmzConfig(client).catalogueMigrations).not.toHaveProperty('publicName')
  })
})
