/**
 * C8 — Catalogue permissions: the manifest ids (§8.2), the capability map (§8.4), refusals (§8.6),
 * default roles (§8.7) and support mode (D-16, D-21). Fixture ids P-01 … P-23.
 */
import { describe, expect, it } from 'vitest'
import { assertModuleAction } from '@/lib/api/module-action-guard'
import { assertCatalogueOperation, catalogueRefusal, CatalogueForbidden } from '@/lib/api/catalogue-capability-guard'
import { grantPermissions, type ProjectGrant, type TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { CATALOGUE_SETUP_PERMISSION, CATALOGUE_SETUP_PERMISSION_DEFINED, catalogueSetupPermissions } from '@/lib/client/surfaces'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { SUPPORT_NEVER_WRITES } from '@/lib/support/state'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { CATALOGUE_CAPABILITIES, CATALOGUE_OPERATION_IDS, capabilitiesFor, capabilitiesForPlan, type CatalogueOperation } from '../capabilities'

const manifest = MODULE_REGISTRY.find((m) => m.id === 'catalogue')!
const ids = manifest.platformContract.permissions.map((p) => p.id)

const ctxFor = (permissions: string[], support?: { purpose: 'mutation' | 'render'; writesAllowed: boolean }): TenantAuthorizationContext => {
  const grant: ProjectGrant = { projectId: 'p1', projectSlug: asSupabaseProjectSlug('tmz'), membershipId: 'm', role: 'owner', permissions, enabledModuleIds: ['catalogue'] }
  return { userId: 'u1', platformRole: 'tenant_user', projects: [grant], ...(support && { support: support as never }) }
}

describe('C8 §8.2 — the manifest', () => {
  it('declares exactly the V2 set; CATALOGUE_CAPABILITIES mirrors it', () => {
    expect([...ids].sort()).toEqual([...CATALOGUE_CAPABILITIES].sort())
    expect(ids).toHaveLength(13)
  })

  it('P-01 ids follow the ADR-028 vocabulary; P-02 no publish id', () => {
    for (const id of ids) expect(id).toMatch(/^catalogue\.[a-z]+\.(read|write|update|delete|deletePublished|manage|use)$/)
    expect(ids.filter((id) => id.includes('publish') && !id.endsWith('deletePublished'))).toEqual([])
  })

  it('taxonomy.write is narrowed: label and description no longer mention channels or dietary tags (§8.3)', () => {
    const t = manifest.platformContract.permissions.find((p) => p.id === 'catalogue.taxonomy.write')!
    expect(t.label).toBe('Manage Categories And Tags')
    expect(`${t.label} ${t.description}`).not.toMatch(/channel|dietary/i)
  })

  it('the nav gates Setup on the real setup id, or taxonomy.write (N2a, D-3)', () => {
    expect(CATALOGUE_SETUP_PERMISSION_DEFINED).toBe(true)
    expect(catalogueSetupPermissions()).toEqual([CATALOGUE_SETUP_PERMISSION, 'catalogue.taxonomy.write'])
  })
})

describe('C8 §8.7 — P-03 role resolution / P-13 viewer', () => {
  const catalogue = (perms: string[]) => perms.filter((p) => p.startsWith('catalogue.')).sort()
  it('Owner and Site admin get everything; Editor no setup/import/readiness/deletePublished; Viewer item.read only', () => {
    const all = [...CATALOGUE_CAPABILITIES].sort()
    expect(catalogue(grantPermissions('owner', ['catalogue']))).toEqual(all)
    expect(catalogue(grantPermissions('admin', ['catalogue']))).toEqual(all)
    expect(catalogue(grantPermissions('editor', ['catalogue']))).toEqual(
      ['catalogue.allergen.update', 'catalogue.collection.delete', 'catalogue.collection.write', 'catalogue.export.use', 'catalogue.item.delete', 'catalogue.item.read', 'catalogue.item.write', 'catalogue.taxonomy.write'].sort(),
    )
    expect(catalogue(grantPermissions('viewer', ['catalogue']))).toEqual(['catalogue.item.read'])
  })
})

describe('C8 §8.4 — capabilitiesFor (P-10, P-11, P-12, P-14, P-22)', () => {
  const opOf = (op: CatalogueOperation['op']): CatalogueOperation =>
    op === 'item.delete' || op === 'collection.delete'
      ? ({ op, published: false } as CatalogueOperation)
      : op === 'item.assignCategories'
        ? { op, createsCategory: false }
        : op === 'term.archive' || op === 'term.unarchive'
          ? { op, kind: 'category' }
          : op.startsWith('import.')
            ? ({ op, createsTerms: false } as CatalogueOperation)
            : ({ op } as CatalogueOperation)

  it('P-11 every operation maps to ≥1 known capability', () => {
    for (const op of CATALOGUE_OPERATION_IDS) {
      const caps = capabilitiesFor(opOf(op))
      expect(caps.length, op).toBeGreaterThan(0)
      for (const c of caps) expect(CATALOGUE_CAPABILITIES).toContain(c)
    }
  })

  it('P-12 the D-3 split', () => {
    for (const op of ['term.create', 'term.rename', 'term.translate', 'term.reorder', 'term.deleteUnusedLeaf'] as const) expect(capabilitiesFor({ op })).toEqual(['catalogue.taxonomy.write'])
    for (const op of ['term.reparent', 'term.reassign', 'term.deleteInUse', 'term.setAvailabilityRule'] as const) expect(capabilitiesFor({ op })).toEqual(['catalogue.setup.manage'])
    expect(capabilitiesFor({ op: 'term.archive', kind: 'category' })).toEqual(['catalogue.setup.manage'])
    expect(capabilitiesFor({ op: 'term.unarchive', kind: 'tag' })).toEqual(['catalogue.taxonomy.write'])
    expect(capabilitiesFor({ op: 'setup.applyPack' })).toEqual(['catalogue.setup.manage'])
  })

  it('P-10 placement; P-14 bulk publish; P-22 item schedule vs channel schedule; import/export', () => {
    expect(capabilitiesFor({ op: 'collection.place' })).toEqual(['catalogue.collection.write', 'catalogue.item.read'])
    expect(capabilitiesForPlan([{ op: 'item.publish' }, { op: 'item.publish' }, { op: 'item.unpublish' }])).toEqual(['catalogue.item.write'])
    expect(capabilitiesFor({ op: 'item.setAvailabilityOverride' })).toEqual(['catalogue.item.write'])
    expect(capabilitiesFor({ op: 'setup.channels' })).toEqual(['catalogue.setup.manage'])
    expect(capabilitiesFor({ op: 'import.start', createsTerms: true })).toEqual(['catalogue.import.use', 'catalogue.item.write', 'catalogue.taxonomy.write'])
    expect(capabilitiesFor({ op: 'export.pdf' })).toEqual(['catalogue.export.use', 'catalogue.item.read'])
    expect(capabilitiesFor({ op: 'item.reviewAllergens' })).toEqual(['catalogue.item.write', 'catalogue.allergen.update'])
    expect(capabilitiesFor({ op: 'item.overrideReadiness' })).toEqual(['catalogue.item.write', 'catalogue.readiness.update'])
  })

  it('P-04 / P-06: an editor is refused naming the first missing capability', () => {
    const editor = ctxFor(grantPermissions('editor', ['catalogue']))
    expect(() => assertCatalogueOperation(editor, 'p1', { op: 'setup.channels' })).toThrow(CatalogueForbidden)
    try {
      assertCatalogueOperation(ctxFor([...grantPermissions('editor', ['catalogue']), 'catalogue.import.use'].filter((p) => p !== 'catalogue.taxonomy.write')), 'p1', { op: 'import.start', createsTerms: true })
    } catch (e) {
      expect((e as CatalogueForbidden).capability).toBe('catalogue.taxonomy.write')
    }
  })
})

describe('C8 §8.6 — refusals (P-07, P-08)', () => {
  it('P-07 a refusal names the capability and nothing else', () => {
    const editor = ctxFor(grantPermissions('editor', ['catalogue']))
    let refusal: unknown = null
    try {
      assertCatalogueOperation(editor, 'p1', { op: 'term.reparent' })
    } catch (e) {
      refusal = catalogueRefusal(e)
    }
    expect(refusal).toEqual({ ok: false, error: 'forbidden', capability: 'catalogue.setup.manage' })
    expect(JSON.stringify(refusal)).not.toMatch(/editor|tmz|u1|p1/)
  })

  it('P-08 a plain authorisation error never yields a capability (not parsed from text)', () => {
    expect(catalogueRefusal(new TenantAuthorizationError('role "editor" on project "tmz" does not grant permission "catalogue.setup.manage"'))).toEqual({ ok: false, error: 'forbidden' })
    expect(catalogueRefusal(new Error('x'))).toBeNull()
  })

  it('without the module: the generic refusal (never reveals the permission)', () => {
    const ctx = ctxFor(grantPermissions('owner', ['catalogue']))
    ctx.projects[0].enabledModuleIds = []
    try {
      assertCatalogueOperation(ctx, 'p1', { op: 'setup.channels' })
      throw new Error('expected refusal')
    } catch (e) {
      expect(e).toBeInstanceOf(TenantAuthorizationError)
      expect(e).not.toBeInstanceOf(CatalogueForbidden)
    }
  })
})

describe('support mode (P-09, P-18; D-16, D-21)', () => {
  it('allergen.update and export.use are in SUPPORT_NEVER_WRITES', () => {
    expect(SUPPORT_NEVER_WRITES).toEqual(expect.arrayContaining(['catalogue.allergen.update', 'catalogue.export.use']))
  })

  it('an approved support edit may write items but never review allergens or export; a view visit writes nothing', () => {
    const perms = grantPermissions('owner', ['catalogue'])
    const approved = ctxFor(perms, { purpose: 'mutation', writesAllowed: true })
    const view = ctxFor(perms, { purpose: 'mutation', writesAllowed: false })
    expect(() => assertModuleAction(approved, 'p1', 'catalogue.item.write')).not.toThrow()
    expect(() => assertModuleAction(approved, 'p1', 'catalogue.allergen.update')).toThrow()
    for (const ctx of [approved, view]) expect(() => assertModuleAction(ctx, 'p1', 'catalogue.export.use')).toThrow()
    expect(() => assertModuleAction(view, 'p1', 'catalogue.setup.manage')).toThrow()
    expect(() => assertModuleAction(ctxFor(perms), 'p1', 'catalogue.export.use')).not.toThrow()
    expect(() => assertModuleAction(ctxFor(grantPermissions('editor', ['catalogue'])), 'p1', 'catalogue.export.use')).not.toThrow()
  })
})
