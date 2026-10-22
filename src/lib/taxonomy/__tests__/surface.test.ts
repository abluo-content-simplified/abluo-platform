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
  it('closes the content group (Tom, 2026-10-22: after People and FAQ Sets)', () => {
    const nav = TENANT_SURFACES.filter((s) => s.kind === 'nav')
    const content = nav.filter((s) => s.group === 'content')
    expect(content[content.length - 1].id).toBe('taxonomy')
    expect(surface.group).toBe('content')
    expect(surface.segment).toBe('taxonomy')
  })

  it('is kept equal to the manifests: every module with a taxonomy, its write and read permission', () => {
    const [modules, media, galleries] = surface.requires.anyOf!
    expect([...(modules.anyModule ?? [])].sort()).toEqual(declaring.map((m) => m.id).sort())
    const perms = declaring.flatMap((m) => [taxonomyWritePermission(m.id), taxonomyReadPermission(m.id)])
    expect([...(modules.anyPermission ?? [])].sort()).toEqual([...new Set(perms)].sort())
    expect(media).toEqual({ permission: 'media.library.manage' })
    expect(galleries).toEqual({ module: 'gallery', anyPermission: ['gallery.gallery.read', 'gallery.gallery.write'] })
  })
})

describe('Catalogue kinds (slice 7)', () => {
  it('declares category and tag, each used by one item field, and the manager lists both kinds', () => {
    const cat = MODULE_REGISTRY.find((m) => m.id === 'catalogue')!
    expect(cat.taxonomies).toEqual([
      { kind: 'category', usedBy: [{ type: 'catalogueItem', field: 'categories' }] },
      { kind: 'tag', usedBy: [{ type: 'catalogueItem', field: 'tags' }] },
    ])
    const mod = manageableTaxonomyModules(grantFor('owner', ['catalogue']) as never).find((m) => m.module === 'catalogue')
    expect(mod?.kinds).toEqual(['category', 'tag'])
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

  it('nobody sees it without a module that declares a taxonomy, or media or galleries', () => {
    expect(buildTenantSurfaces({ enabledModuleIds: ['forms'], permissions: ['forms.submission.read'] }).nav.map((n) => n.id)).not.toContain('taxonomy')
  })

  it('the media library or galleries are enough on their own (Media and Galleries tabs)', () => {
    expect(buildTenantSurfaces({ enabledModuleIds: [], permissions: ['media.library.manage'] }).nav.map((n) => n.id)).toContain('taxonomy')
    expect(navIds(grantFor('owner', ['gallery']))).toContain('taxonomy')
    expect(navIds(grantFor('editor', ['gallery']))).toContain('taxonomy')
    expect(buildTenantSurfaces({ enabledModuleIds: ['gallery'], permissions: ['gallery.gallery.read'] }).nav.map((n) => n.id)).toContain('taxonomy')
    // A permission without the installed module is not enough for galleries.
    expect(buildTenantSurfaces({ enabledModuleIds: [], permissions: ['gallery.gallery.read'] }).nav.map((n) => n.id)).not.toContain('taxonomy')
  })

  it('needs a permission of that module, not just the install', () => {
    expect(buildTenantSurfaces({ enabledModuleIds: ['catalogue'], permissions: [] }).nav.map((n) => n.id)).not.toContain('taxonomy')
    expect(buildTenantSurfaces({ enabledModuleIds: ['catalogue'], permissions: ['catalogue.taxonomy.write'] }).nav.map((n) => n.id)).toContain('taxonomy')
  })
})

describe('manageableTaxonomyModules', () => {
  it('lists the installed modules with a taxonomy and whether the person can change it', () => {
    expect(manageableTaxonomyModules(grantFor('editor', ['catalogue', 'gallery']))).toEqual([{ module: 'catalogue', kinds: ['category', 'tag'], canWrite: true }])
    expect(manageableTaxonomyModules(grantFor('viewer', ['catalogue']))).toEqual([{ module: 'catalogue', kinds: ['category', 'tag'], canWrite: false }])
  })

  it('is empty without the module, without permission, or when the module declares nothing', () => {
    expect(manageableTaxonomyModules(grantFor('owner', ['gallery']))).toEqual([])
    expect(manageableTaxonomyModules({ enabledModuleIds: ['catalogue'], permissions: [] })).toEqual([])
  })
})

describe('Events categories (Amendment J)', () => {
  it('owner, editor and viewer of a project with Events get Categories & Tags; the manager lists Events with category only', () => {
    for (const role of ['owner', 'editor', 'viewer'] as const) expect(navIds(grantFor(role, ['events']))).toContain('taxonomy')
    const owner = manageableTaxonomyModules(grantFor('owner', ['events']) as never)
    expect(owner).toEqual([{ module: 'events', kinds: ['category'], canWrite: true }])
    const viewer = manageableTaxonomyModules(grantFor('viewer', ['events']) as never)
    expect(viewer).toEqual([{ module: 'events', kinds: ['category'], canWrite: false }])
  })
})

describe('Posts and News categories (Amendment J)', () => {
  it('owner, editor and viewer of a project with Posts or News get Categories & Tags; the manager lists category only', () => {
    for (const module of ['blog', 'news']) {
      for (const role of ['owner', 'editor', 'viewer'] as const) expect(navIds(grantFor(role, [module]))).toContain('taxonomy')
      expect(manageableTaxonomyModules(grantFor('owner', [module]) as never)).toEqual([{ module, kinds: ['category'], canWrite: true }])
      expect(manageableTaxonomyModules(grantFor('editor', [module]) as never)).toEqual([{ module, kinds: ['category'], canWrite: true }])
      expect(manageableTaxonomyModules(grantFor('viewer', [module]) as never)).toEqual([{ module, kinds: ['category'], canWrite: false }])
    }
  })
})
