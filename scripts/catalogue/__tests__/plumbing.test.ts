/** Mutations, batching, guards, export/import and pre-flight of the rollout scripts — pure, no network. */
import { describe, expect, it, vi } from 'vitest'
import { applyMutations, batchGroups, BatchError, ConflictError, docsToMap, parsePath } from '../lib/mutations'
import { DatasetMismatchError, assertClientDataset, auditTargetGuard, defaultMigrationId, writeGuard } from '../lib/guards'
import { assertSandboxSupabase, isProductionSupabase } from '@/lib/environments/supabase-target'
import { buildManifest, checkExport, planImport, toNdjson, weakenReferences } from '../lib/export'
import { runImport } from '../lib/import'
import { preflightAll } from '../lib/preflight'
import { compareSnapshots, snapshotOf } from '../lib/public-output'
import { baseIdOf, unchangedExcept } from '../lib/docs'
import { SANITY_MUTATION_MAX_BYTES } from '@/lib/sanity/limits'
import { MemoryClient } from './fixtures/memory'
import { tmzProduction } from './fixtures/tmz-production'

vi.setConfig({ testTimeout: 60_000 })

describe('mutations', () => {
  it('applies set into a module installation config by _key, all or nothing, with revision checks', () => {
    const docs = docsToMap([{ _id: 'p', _type: 'project', _rev: 'r1', moduleInstallations: [{ _key: 'k', moduleId: 'catalogue', config: { a: 1 } }] }])
    const next = applyMutations(docs, [{ patch: { id: 'p', ifRevisionID: 'r1', set: { 'moduleInstallations[_key=="k"].config': { a: 2 } } } }])
    expect((next.get('p')!.moduleInstallations as { config: unknown }[])[0].config).toEqual({ a: 2 })
    expect(docs.get('p')!._rev).toBe('r1')
    expect(() => applyMutations(docs, [{ patch: { id: 'p', ifRevisionID: 'other', set: { x: 1 } } }])).toThrow(ConflictError)
    expect(() => applyMutations(docs, [{ create: { _id: 'p', _type: 'project' } }])).toThrow(ConflictError)
    expect(applyMutations(docs, [{ createIfNotExists: { _id: 'p', _type: 'x' } }]).get('p')!._type).toBe('project')
    expect(parsePath('a.b[_key=="c"].d')).toEqual([{ field: 'a' }, { field: 'b', key: 'c' }, { field: 'd' }])
  })

  it('batches against SANITY_MUTATION_MAX_BYTES with the 20 % margin; a group is never split; an oversize group is refused', () => {
    const g = (key: string, n: number) => ({ key, mutations: Array.from({ length: n }, (_, i) => ({ patch: { id: `${key}-${i}`, set: { x: 'y'.repeat(100) } } })) })
    const txns = batchGroups([g('a', 2), g('b', 2), g('c', 2)], { migrationId: 'm', limit: 1000 })
    expect(txns.map((t) => t.groups)).toEqual([['a', 'b'], ['c']])
    expect(txns.map((t) => t.transactionId)).toEqual(['abluo-migr-m-1', 'abluo-migr-m-2'])
    expect(() => batchGroups([g('big', 20)], { migrationId: 'm', limit: 1000 })).toThrow(BatchError)
    expect(batchGroups([g('a', 2)], { migrationId: 'm' })).toHaveLength(1)
    expect(SANITY_MUTATION_MAX_BYTES).toBe(4_000_000)
  })
})

describe('guards (D-11: staging never writes to production)', () => {
  const green = () => ({ dataset: 'staging', mode: 'apply', step: 'taxonomy', green: true })
  it('requires --dataset, allows dry runs, writes only staging/production', () => {
    expect(writeGuard({ dataset: null, apply: false, readReport: green })).toMatchObject({ ok: false, code: 'dataset.required' })
    expect(writeGuard({ dataset: 'production', apply: false, readReport: green })).toEqual({ ok: true })
    expect(writeGuard({ dataset: 'staging', apply: true, readReport: green })).toEqual({ ok: true })
    expect(writeGuard({ dataset: 'dev', apply: true, readReport: green })).toMatchObject({ code: 'dataset.notWritable' })
    expect(writeGuard({ dataset: 'production', apply: true, mode: 'import', readReport: green })).toMatchObject({ code: 'import.stagingOnly' })
  })
  it('production needs an approval naming a green staging apply report of the same step', () => {
    const base = { dataset: 'production', apply: true, step: 'taxonomy' as const }
    expect(writeGuard({ ...base, readReport: green })).toMatchObject({ code: 'approval.required' })
    expect(writeGuard({ ...base, approval: '../x', readReport: green })).toMatchObject({ code: 'approval.invalid' })
    expect(writeGuard({ ...base, approval: 'r', readReport: () => null })).toMatchObject({ code: 'approval.reportMissing' })
    expect(writeGuard({ ...base, approval: 'r', readReport: () => ({ ...green(), dataset: 'production' }) })).toMatchObject({ code: 'approval.notStaging' })
    expect(writeGuard({ ...base, approval: 'r', readReport: () => ({ ...green(), mode: 'dry-run' }) })).toMatchObject({ code: 'approval.notApplied' })
    expect(writeGuard({ ...base, approval: 'r', readReport: () => ({ ...green(), step: 'commerce' }) })).toMatchObject({ code: 'approval.wrongStep' })
    expect(writeGuard({ ...base, approval: 'r', readReport: () => ({ ...green(), green: false }) })).toMatchObject({ code: 'approval.notGreen' })
    expect(writeGuard({ ...base, approval: 'r', readReport: green })).toEqual({ ok: true })
  })
  it('audit rows follow the dataset: staging → Abluo Sandbox only, production → the production project only (ADR-038 D8)', () => {
    const refs = { isProduction: isProductionSupabase, assertSandbox: assertSandboxSupabase }
    const prod = 'https://xsdamzirepfqlutvqfbe.supabase.co'
    const sandbox = 'https://abcdefghijklmnopqrst.supabase.co'
    expect(auditTargetGuard('staging', sandbox, refs)).toEqual({ ok: true })
    expect(auditTargetGuard('staging', prod, refs)).toMatchObject({ code: 'audit.notSandbox' })
    expect(auditTargetGuard('production', prod, refs)).toEqual({ ok: true })
    expect(auditTargetGuard('production', sandbox, refs)).toMatchObject({ code: 'audit.notProduction' })
    expect(auditTargetGuard('staging', '', refs)).toMatchObject({ code: 'audit.unconfigured' })
  })
  it('asserts the client dataset; migration ids are valid transaction parts', () => {
    expect(() => assertClientDataset({ dataset: 'production' }, 'staging')).toThrow(DatasetMismatchError)
    expect(defaultMigrationId('d3-pack-history', 'production', new Date('2026-11-05T10:07:00Z'))).toBe('d3-pack-history-production-202611051007')
  })
})

describe('export artefact', () => {
  it('manifest counts and sha256; a changed file is refused', () => {
    const docs = tmzProduction()
    const nd = toNdjson(docs)
    const m = buildManifest(docs, nd, { label: 'p', dataset: 'production', sanityProjectId: 'abc', exportedAt: '2026-11-05T00:00:00Z' })
    expect(m.byType.catalogueItem).toEqual({ published: 10, drafts: 6, versions: 0, total: 16 })
    expect(m.byType.taxonomyTerm.total).toBe(10)
    expect(m.projects).toEqual([{ slug: 'tmz', items: 16 }])
    expect(checkExport(nd, JSON.stringify(m))).toMatchObject({ ok: true })
    expect(checkExport(nd.replace('Book 1', 'Book X'), JSON.stringify(m))).toMatchObject({ ok: false, code: 'checksumMismatch' })
  })
})

describe('import into staging (step S)', () => {
  it('weakens references whose target is not exported, restores the others exactly', () => {
    const docs = [
      { _id: 'a', _type: 'catalogueItem', image: { asset: { _type: 'reference', _ref: 'image-1-jpg' } } },
      { _id: 'c', _type: 'catalogueCollection', items: [{ _key: 'k', _type: 'reference', _ref: 'a' }] },
    ]
    expect(weakenReferences(docs[0]).weakened).toEqual([{ id: 'a', path: 'image.asset', ref: 'image-1-jpg' }])
    const plan = planImport(docs, { existingIds: new Set(), replace: false })
    expect(plan.leftWeak.map((w) => w.ref)).toEqual(['image-1-jpg'])
    expect(plan.strengthen).toEqual([{ createOrReplace: docs[1] }])
    expect(planImport(docs, { existingIds: new Set(['a']), replace: false }).refusals.map((r) => r.code)).toEqual(['import.targetNotEmpty'])
  })

  it('refuses any dataset but staging and a client bound elsewhere; imports and compares', async () => {
    const source = { sha256: 'x', exportedAt: 'y', dataset: 'production', documents: 1 }
    const docs = tmzProduction()
    const prod = new MemoryClient('production', [])
    const r = await runImport({ client: prod, dataset: 'production', apply: true, replace: false, docs, source, migrationId: 'import-staging-1' })
    expect(r.refusals[0].code).toBe('import.stagingOnly')
    expect(prod.transactions).toEqual([])
    await expect(runImport({ client: prod, dataset: 'staging', apply: true, replace: false, docs, source, migrationId: 'import-staging-1' })).rejects.toBeInstanceOf(DatasetMismatchError)
    const staging = new MemoryClient('staging', [])
    const ok = await runImport({ client: staging, dataset: 'staging', apply: true, replace: false, docs, source, migrationId: 'import-staging-1' })
    expect(ok.green).toBe(true)
    expect(staging.docs()).toHaveLength(docs.length)
    expect(unchangedExcept(docs, staging.docs(), {})).toEqual([])
  })
})

describe('pre-flight (P / P′) on tmz', () => {
  it('is clean and lists the decided findings; dry runs of all four steps verify', () => {
    const r = preflightAll(tmzProduction(), { now: '2026-11-05T10:00:00.000Z' })
    expect(r.refusals).toEqual([])
    expect(r.green).toBe(true)
    expect(r.itemCounts).toEqual({ published: 10, drafts: 6, versions: 0, total: 16 })
    expect(r.steps.map((s) => [s.label, s.verification.pass])).toEqual([
      ['d1-taxonomy', true],
      ['d2-commerce', true],
      ['d3-pack-history', true],
      ['d4-public-name', true],
    ])
    expect(r.findings.map((f) => f.code)).toEqual(['taxonomy.configListIgnored', 'item.multiCategory', 'publicName.copy'])
  })

  it('refuses versions.*, unknown-channel and reserved-field offers', () => {
    const docs = [
      ...tmzProduction(),
      { _id: 'versions.r1.b1a7e0c2-0002', _type: 'catalogueItem', projectSlug: 'tmz', categories: ['design'] },
      { _id: 'bad-1', _type: 'catalogueItem', projectSlug: 'tmz', offers: [{ _key: 'x', price: 1, channel: 'delivery' }] },
      { _id: 'bad-2', _type: 'catalogueItem', projectSlug: 'tmz', offers: [{ _key: 'y', price: 1, locationKey: 'milano' }] },
    ]
    const codes = preflightAll(docs, { now: '2026-11-05T10:00:00.000Z' }).refusals.map((r) => r.code)
    expect(codes).toEqual(expect.arrayContaining(['export.versionsPresent', 'item.versionsPresent', 'offer.unknownChannel', 'offer.reservedField']))
  })
})

describe('public output snapshot (C11 website-output.unchanged)', () => {
  it('extracts title, OG, description and JSON-LD; ignores everything else; compares', () => {
    const html = (build: string) =>
      `<html><head><title>Between the Lines — tmz.it</title><meta property="og:title" content="Between the Lines"/><meta name="description" content="Books &amp; more"/><script src="/_next/${build}.js"></script><script type="application/ld+json">{"@type":"ItemList"}</script></head></html>`
    const a = snapshotOf('/en/books', 200, 'text/html', html('abc'))
    const b = snapshotOf('/en/books', 200, 'text/html', html('def'))
    expect(a).toMatchObject({ title: 'Between the Lines — tmz.it', ogTitle: 'Between the Lines', description: 'Books & more', jsonLd: ['{"@type":"ItemList"}'] })
    expect(compareSnapshots([a], [b])).toEqual([])
    const llms = snapshotOf('/llms.txt', 200, 'text/plain', '## Catalogue\n')
    expect(compareSnapshots([llms], [{ ...llms, body: '## Books\n' }])).toHaveLength(1)
  })

  it('baseIdOf pairs drafts and versions with the published id', () => {
    expect(['x', 'drafts.x', 'versions.r1.x'].map(baseIdOf)).toEqual(['x', 'x', 'x'])
  })
})
