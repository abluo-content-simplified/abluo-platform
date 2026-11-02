// C9 §9.8 — Studio posture, R1 layers 1–3 (+ the fail-closed loader).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { catalogueSchemaTypes } from '@/lib/modules/catalogue/schema'
import { MODULE_REGISTRY } from '@/lib/modules'
import { DASHBOARD_TRANSACTION_PREFIX } from '@/lib/lifecycle/audit'
import {
  CATALOGUE_LOCK_PHASE,
  CATALOGUE_LOCKED_TYPES,
  CATALOGUE_STUDIO_EDITED,
  CATALOGUE_STUDIO_SCOPED,
  CATALOGUE_STUDIO_TYPES,
  CATALOGUE_TEMPLATE_IDS,
  CATALOGUE_WRITER_PREFIXES,
  CLOSED_POSTURE,
  catalogueDocumentActions,
  catalogueReadOnly,
  catalogueTransactionId,
  isAuthorisedCatalogueTransaction,
  isCatalogueStudioDoc,
  type PostureState,
} from '../catalogue-posture'
import { applyCataloguePosture, withCataloguePosture } from '../catalogue-posture-schema'
import { POSTURE_ENDPOINT, loadCataloguePosture, postureStore } from '../catalogue-posture-store'

const NOW = new Date('2026-11-02T12:00:00Z')
const grant = (expiresAt: string, projectSlug = 'p') => ({ id: 'g1', projectSlug, expiresAt, enabledBy: 'abluo-admin' as const })
const OPEN: PostureState = { grants: [grant('2099-01-01T00:00:00Z')], loaded: true }
const EXPIRED: PostureState = { grants: [grant('2000-01-01T00:00:00Z')], loaded: true }
const NONE: PostureState = { grants: [], loaded: true }

afterEach(() => postureStore.reset())

const documentTypes = () => {
  const fromModule = (catalogueSchemaTypes as Array<{ name: string; type?: string }>).filter((t) => t.type === 'document').map((t) => t.name)
  const manifest = MODULE_REGISTRY.find((m) => m.id === 'catalogue')!
  const defs = (manifest as { schemaDefinitions?: () => Array<{ name: string; type?: string }> }).schemaDefinitions?.() ?? []
  return [...new Set([...fromModule, ...defs.filter((t) => t.type === 'document').map((t) => t.name)])]
}

describe('T-3 registry-and-posture-agree (classification)', () => {
  it('every Catalogue document type is classified in CATALOGUE_STUDIO_TYPES', () => {
    const docs = documentTypes()
    expect(docs.length).toBeGreaterThanOrEqual(4)
    for (const t of docs) expect(CATALOGUE_STUDIO_TYPES, `${t} is a Catalogue document type without a Studio posture`).toContain(t)
  })

  it('the four document types the dashboard edits today are there, plus the reserved ones of C1/C6/C7', () => {
    expect([...CATALOGUE_STUDIO_TYPES]).toEqual(['catalogueItem', 'catalogueCollection', 'catalogueOptionList', 'cataloguePage', 'catalogueTaxonomy', 'cataloguePackHistory', 'cataloguePublicationStandards', 'cataloguePackRun'])
  })

  it('cataloguePage is classified "Studio-edited until a dashboard editor exists", with a reason; every other type is locked', () => {
    expect(Object.keys(CATALOGUE_STUDIO_EDITED)).toEqual(['cataloguePage'])
    expect(CATALOGUE_STUDIO_EDITED.cataloguePage).toMatch(/Studio/)
    expect([...CATALOGUE_LOCKED_TYPES]).toEqual(CATALOGUE_STUDIO_TYPES.filter((t) => t !== 'cataloguePage'))
    for (const t of CATALOGUE_STUDIO_TYPES) expect(CATALOGUE_LOCKED_TYPES.includes(t) !== Object.hasOwn(CATALOGUE_STUDIO_EDITED, t), t).toBe(true)
  })
})

describe('T-1 every-catalogue-document-type-readonly (layer 1)', () => {
  const wrapped = applyCataloguePosture(catalogueSchemaTypes as never[]) as Array<{ name: string; type?: string; readOnly?: unknown; fields?: Array<{ name: string; readOnly?: unknown }> }>

  it.each(documentTypes().filter((t) => !Object.hasOwn(CATALOGUE_STUDIO_EDITED, t)))('%s has a function readOnly that is true with no grant, not loaded, and an expired grant', (name) => {
    const t = wrapped.find((x) => x.name === name)!
    expect(typeof t.readOnly).toBe('function')
    const doc = { projectSlug: 'p', module: 'catalogue' }
    for (const state of [NONE, CLOSED_POSTURE, EXPIRED]) {
      postureStore.set(state)
      expect((t.readOnly as (c: unknown) => boolean)({ document: doc })).toBe(true)
    }
    postureStore.set(OPEN)
    expect((t.readOnly as (c: unknown) => boolean)({ document: doc })).toBe(false)
    expect((t.readOnly as (c: unknown) => boolean)({ document: { projectSlug: 'other' } })).toBe(true)
  })

  it('cataloguePage (Studio-edited) is not wrapped: no posture readOnly, its own fields as defined', () => {
    const page = wrapped.find((x) => x.name === 'cataloguePage')!
    expect(page).toBe((catalogueSchemaTypes as unknown[]).find((x) => (x as { name: string }).name === 'cataloguePage'))
    for (const state of [NONE, CLOSED_POSTURE]) expect(catalogueReadOnly({ type: 'cataloguePage', doc: { projectSlug: 'p' }, state, now: NOW })).toBe(false)
    expect(isCatalogueStudioDoc('cataloguePage')).toBe(false)
  })

  it('object types are untouched; identity fields stay read-only unconditionally', () => {
    const offer = wrapped.find((x) => x.name === 'catalogueOffer')!
    expect(offer).toBe((catalogueSchemaTypes as unknown[]).find((x) => (x as { name: string }).name === 'catalogueOffer'))
    const item = wrapped.find((x) => x.name === 'catalogueItem')!
    for (const f of ['projectSlug', 'publicId', 'readinessOverrides', 'complianceTasks']) expect(item.fields!.find((x) => x.name === f)?.readOnly, f).toBe(true)
  })

  it('a shared type keeps its own readOnly (OR-ed), and is not locked in R1', () => {
    const term = withCataloguePosture({ name: 'taxonomyTerm', type: 'document', readOnly: ({ document }: { document?: { locked?: boolean } }) => document?.locked === true, fields: [] }, () => NONE, () => NOW)
    const ro = term.readOnly as (c: unknown) => boolean
    expect(ro({ document: { module: 'catalogue', projectSlug: 'p' } })).toBe(false)
    expect(ro({ document: { module: 'catalogue', projectSlug: 'p', locked: true } })).toBe(true)
  })
})

describe('T-10 fails-closed / T-15 lock-phases', () => {
  it('loaded=false ⇒ read-only for every type, even with a live grant in the list', () => {
    for (const type of CATALOGUE_LOCKED_TYPES) expect(catalogueReadOnly({ type, doc: { projectSlug: 'p' }, state: { grants: OPEN.grants, loaded: false }, now: NOW })).toBe(true)
  })

  it('a document without a projectSlug is read-only', () => {
    expect(catalogueReadOnly({ type: 'catalogueItem', doc: {}, state: OPEN, now: NOW })).toBe(true)
  })

  it('R1: catalogueItem read-only, Catalogue taxonomyTerm writable; R2: both read-only', () => {
    expect(CATALOGUE_LOCK_PHASE).toBe('R1')
    expect(catalogueReadOnly({ type: 'catalogueItem', doc: { projectSlug: 'p' }, state: NONE, now: NOW })).toBe(true)
    expect(catalogueReadOnly({ type: 'taxonomyTerm', doc: { module: 'catalogue', projectSlug: 'p' }, state: NONE, now: NOW })).toBe(false)
    expect(catalogueReadOnly({ type: 'taxonomyTerm', doc: { module: 'catalogue', projectSlug: 'p' }, state: NONE, now: NOW, phase: 'R2' })).toBe(true)
    expect(catalogueReadOnly({ type: 'taxonomyTerm', doc: { module: 'blog', projectSlug: 'p' }, state: NONE, now: NOW, phase: 'R2' })).toBe(false)
    expect(CATALOGUE_STUDIO_SCOPED.map((s) => [s.type, s.lockFrom])).toEqual([['taxonomyTerm', 'R2']])
  })

  it('unrelated types are never read-only through the posture', () => {
    expect(isCatalogueStudioDoc('post')).toBe(false)
    expect(catalogueReadOnly({ type: 'post', doc: { projectSlug: 'p' }, state: CLOSED_POSTURE, now: NOW })).toBe(false)
  })
})

describe('T-2 / T-4 document actions (layer 2)', () => {
  const prev = ['publish', 'unpublish', 'delete', 'duplicate', 'restore', 'schedule', 'discardChanges'].map((action) => ({ action }))
  const gate = { action: 'catalogueGatePublish' }

  it('T-2 posture off (no grant, expired, not loaded) → []', () => {
    for (const state of [NONE, EXPIRED, CLOSED_POSTURE]) expect(catalogueDocumentActions(prev, { state, now: NOW, gate })).toEqual([])
  })

  it('cataloguePage keeps its normal document actions (the sanity.config branch is skipped for Studio-edited types)', () => {
    expect(isCatalogueStudioDoc('cataloguePage')).toBe(false)
    for (const t of CATALOGUE_LOCKED_TYPES) expect(isCatalogueStudioDoc(t), t).toBe(true)
  })

  it('T-4 posture on → exactly [gate, discard]; without a gate (R1) only discard', () => {
    expect(catalogueDocumentActions(prev, { state: OPEN, now: NOW, gate })).toEqual([gate, { action: 'discardChanges' }])
    const r1 = catalogueDocumentActions(prev, { state: OPEN, now: NOW })
    expect(r1.map((a) => a.action)).toEqual(['discardChanges'])
  })
})

describe('T-5 sanity-config-delegates (layers 2 and 3)', () => {
  const src = readFileSync(join(process.cwd(), 'sanity.config.ts'), 'utf8')
  it('the Catalogue branch comes before the first schemaType branch; templates are filtered; the schema is wrapped', () => {
    const actions = src.indexOf('catalogueDocumentActions(')
    expect(actions).toBeGreaterThan(0)
    expect(actions).toBeLessThan(src.indexOf("context.schemaType ==="))
    expect(src).toMatch(/newDocumentOptions: \(prev\) =>\s*prev\.filter\(\(opt\) => !CATALOGUE_TEMPLATE_IDS\.includes\(opt\.templateId\)\)/)
    expect(src).toMatch(/types: applyCataloguePosture\(schemaTypes\)/)
  })

  it('CATALOGUE_TEMPLATE_IDS covers the default and project-owned template of every LOCKED Catalogue document type; cataloguePage keeps its pre-R1 template', () => {
    expect(CATALOGUE_TEMPLATE_IDS).not.toContain('cataloguePage')
    for (const t of CATALOGUE_LOCKED_TYPES) {
      expect(CATALOGUE_TEMPLATE_IDS).toContain(t)
      expect(CATALOGUE_TEMPLATE_IDS).toContain(`${t}ProjectOwned`)
    }
    expect(CATALOGUE_TEMPLATE_IDS).toContain('catalogueItemProjectOwned')
  })
})

describe('posture loader (layer 4 store) fails closed', () => {
  const res = (status: number, body: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })

  it('starts closed', () => {
    expect(postureStore.get()).toEqual(CLOSED_POSTURE)
  })

  it.each([
    ['404 (R1: endpoint not built)', res(404, {})],
    ['500', res(500, {})],
    ['malformed body', res(200, { grants: [{ id: 1 }] })],
    ['no grants array', res(200, {})],
    ['network error', async () => { throw new Error('offline') }],
  ])('%s → loaded:false', async (_l, fetchFn) => {
    const s = await loadCataloguePosture(fetchFn as never)
    expect(s.loaded).toBe(false)
    expect(postureStore.get().loaded).toBe(false)
  })

  it('a well-formed 200 opens it, same-origin', async () => {
    let url = ''
    const s = await loadCataloguePosture(async (u) => ((url = u), { ok: true, status: 200, json: async () => ({ grants: OPEN.grants }) }))
    expect(url).toBe(POSTURE_ENDPOINT)
    expect(s).toEqual(OPEN)
  })
})

describe('C9 §9.5 CATALOGUE_WRITER_PREFIXES (T-11 list, C-4)', () => {
  it('is the one list of five prefixes and includes the dashboard prefix the lifecycle service already uses', () => {
    expect([...CATALOGUE_WRITER_PREFIXES]).toEqual(['abluo-dash-', 'abluo-gate-', 'abluo-pack-', 'abluo-setup-', 'abluo-migr-'])
    expect(CATALOGUE_WRITER_PREFIXES).toContain(DASHBOARD_TRANSACTION_PREFIX)
  })

  it.each(['dash', 'gate', 'pack', 'setup'] as const)('catalogueTransactionId(%s) is authorised', (w) => {
    const id = catalogueTransactionId(w, 'abc-123')
    expect(id.startsWith(`abluo-${w}-`)).toBe(true)
    expect(isAuthorisedCatalogueTransaction(id)).toBe(true)
  })

  it('migration ids carry the migration: abluo-migr-<migrationId>-<unique>', () => {
    expect(catalogueTransactionId('migr', 'u1', { migrationId: 'catalogue-public-name' })).toBe('abluo-migr-catalogue-public-name-u1')
    expect(() => catalogueTransactionId('migr', 'u1')).toThrow()
    expect(() => catalogueTransactionId('dash', '')).toThrow()
  })

  it('anything else is out of gate', () => {
    for (const id of ['abc', '', 'abluo-dash-', 'abluo-other-x', null, 42]) expect(isAuthorisedCatalogueTransaction(id)).toBe(false)
  })
})
