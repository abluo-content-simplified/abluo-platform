/**
 * The Categories & Tags sidebar entry follows the manifests: shown exactly to
 * people who can open the manager (module installed, declares a taxonomy, the
 * person holds its taxonomy write or read permission).
 */
import { describe, expect, it } from 'vitest'
import { grantPermissions } from '@/lib/api/tenant-context'
import { buildClientNavItems } from '@/lib/modules/client-navigation'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { TENANT_SURFACES, buildTenantSurfaces, type NavSurface } from '@/lib/client/surfaces'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { manageableTaxonomyModules } from '../manageable'
import { taxonomyReadPermission, taxonomyWritePermission } from '../permissions'

const surface = TENANT_SURFACES.find((s): s is NavSurface => s.kind === 'nav' && s.id === 'taxonomy')!
const declaring = MODULE_REGISTRY.filter((m) => m.taxonomies?.length)
const grantFor = (role: 'owner' | 'editor' | 'viewer', modules: string[], extra: string[] = []) => ({
  projectSlug: asSupabaseProjectSlug('tmz'),
  enabledModuleIds: modules,
  permissions: [...grantPermissions(role, modules), ...extra],
})
const navIds = (g: ReturnType<typeof grantFor>) => buildClientNavItems(g).map((i) => i.moduleId)

describe('registry entry', () => {
  it('sits in the content group directly after Media', () => {
    const nav = TENANT_SURFACES.filter((s) => s.kind === 'nav')
    expect(nav[nav.findIndex((s) => s.id === 'media') + 1].id).toBe('taxonomy')
    expect(surface.group).toBe('content')
    expect(surface.segment).toBe('taxonomy')
  })

  it('is kept equal to the manifests: every module with a taxonomy, its write and read permission', () => {
    expect([...(surface.requires.anyModule ?? [])].sort()).toEqual(declaring.map((m) => m.id).sort())
    const perms = declaring.flatMap((m) => [taxonomyWritePermission(m.id), taxonomyReadPermission(m.id)])
    expect([...(surface.requires.anyPermission ?? [])].sort()).toEqual([...new Set(perms)].sort())
  })
})

describe('who sees "Categories & Tags"', () => {
  it('owner and editor of a project with the Catalogue', () => {
    expect(navIds(grantFor('owner', ['catalogue']))).toContain('taxonomy')
    expect(navIds(grantFor('editor', ['catalogue']))).toContain('taxonomy')
  })

  it('a viewer (read only) sees it too', () => {
    const viewer = grantFor('viewer', ['catalogue'])
    expect(viewer.permissions).not.toContain('catalogue.taxonomy.write')
    expect(navIds(viewer)).toContain('taxonomy')
  })

  it('nobody sees it without an installed module that declares a taxonomy', () => {
    expect(navIds(grantFor('owner', ['blog', 'gallery']))).not.toContain('taxonomy')
    expect(navIds(grantFor('owner', []))).not.toContain('taxonomy')
  })

  it('needs a permission of that module, not just the install', () => {
    expect(buildTenantSurfaces({ enabledModuleIds: ['catalogue'], permissions: [] }).nav.map((n) => n.id)).not.toContain('taxonomy')
    expect(buildTenantSurfaces({ enabledModuleIds: ['catalogue'], permissions: ['catalogue.taxonomy.write'] }).nav.map((n) => n.id)).toContain('taxonomy')
  })
})

describe('manageableTaxonomyModules', () => {
  it('lists the installed modules with a taxonomy and whether the person can change it', () => {
    expect(manageableTaxonomyModules(grantFor('editor', ['catalogue', 'blog']))).toEqual([{ module: 'catalogue', kinds: ['category'], canWrite: true }])
    expect(manageableTaxonomyModules(grantFor('viewer', ['catalogue']))).toEqual([{ module: 'catalogue', kinds: ['category'], canWrite: false }])
  })

  it('is empty without the module, without permission, or when the module declares nothing', () => {
    expect(manageableTaxonomyModules(grantFor('owner', ['blog']))).toEqual([])
    expect(manageableTaxonomyModules({ enabledModuleIds: ['catalogue'], permissions: [] })).toEqual([])
  })
})
