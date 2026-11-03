/**
 * The tenant/admin boundary (ADR-029 §3.1): nothing renders in the tenant UI
 * unless it is registered in `surfaces.ts`, and nothing registered may expose
 * platform configuration. This is the test that turns "opt-in, not automatic"
 * from a convention into a build failure.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import {
  CATALOGUE_SETUP_PERMISSION,
  CATALOGUE_SETUP_PERMISSION_DEFINED,
  CATALOGUE_SETUP_ROUTE_EXISTS,
  catalogueSetupPermissions,
  MODULES_WITHOUT_TENANT_SURFACE,
  NAV_GROUPS,
  TENANT_SURFACES as ALL_SURFACES,
} from '../surfaces'
import {
  buildTenantSurfaces,
  CONFIGURATION_PERMISSIONS,
  FEATURE_CONTROL_ALLOWLIST,
  surfaceAllowed,
  TENANT_SURFACES,
  type FeatureControlSurface,
  type NavSurface,
  type SurfaceRequirement,
  type TenantSurface,
} from '../surfaces'
import { grantPermissions } from '@/lib/api/tenant-context'

const ROOT = process.cwd()
const LOCALES = ['en', 'it', 'de'] as const

function requirementPermissions(r: SurfaceRequirement): string[] {
  return [...(r.permission ? [r.permission] : []), ...(r.anyPermission ?? []), ...(r.anyOf ?? []).flatMap(requirementPermissions)]
}

describe('registry shape', () => {
  it('has unique ids per kind', () => {
    for (const kind of ['nav', 'widget', 'featureControl'] as const) {
      const ids = TENANT_SURFACES.filter((s) => s.kind === kind).map((s) => s.id)
      expect(new Set(ids).size, `duplicate ${kind} id`).toBe(ids.length)
    }
  })

  it('every entry states `requires` explicitly (an empty object is a deliberate "anyone")', () => {
    for (const s of TENANT_SURFACES) {
      expect(s.requires, `${s.kind}:${s.id} has no requires`).toBeTypeOf('object')
      expect(s.requires).not.toBeNull()
    }
  })

  it('every entry that reaches content or people names a module or a permission', () => {
    // Only Home-level widgets (site status, attention) may be open to every member —
    // and the Support page (Tom, 2026-10-22), which reads no data: it says ticketing is coming.
    const open = TENANT_SURFACES.filter((s) => requirementPermissions(s.requires).length === 0 && !s.requires.module)
    expect(open.filter((s) => s.kind !== 'widget').map((s) => s.id)).toEqual(['support'])
  })

  it('no entry is gated on a configuration permission', () => {
    for (const s of TENANT_SURFACES) {
      for (const p of requirementPermissions(s.requires)) {
        // Only a permission Tom approved by name (FEATURE_CONTROL_ALLOWLIST) may gate a surface: billing.manage → Billing.
        if (FEATURE_CONTROL_ALLOWLIST.includes(p)) continue
        expect(CONFIGURATION_PERMISSIONS, `${s.kind}:${s.id} requires ${p}`).not.toContain(p)
      }
    }
  })

  it('every feature control is on the allowlist; the allowlist has no stale ids', () => {
    const controls = TENANT_SURFACES.filter((s): s is FeatureControlSurface => s.kind === 'featureControl')
    for (const c of controls) expect(FEATURE_CONTROL_ALLOWLIST).toContain(c.id)
    // An entry is a feature control id, or a configuration permission some surface is approved to be gated on.
    const gating = TENANT_SURFACES.flatMap((s) => requirementPermissions(s.requires))
    for (const id of FEATURE_CONTROL_ALLOWLIST) expect([...controls.map((c) => c.id), ...gating]).toContain(id)
  })

  it('buildTenantSurfaces drops a feature control that is not allowlisted', () => {
    const rogue: TenantSurface = { kind: 'featureControl', id: 'rogue', requires: {} }
    expect(buildTenantSurfaces({ permissions: [], enabledModuleIds: [] }, [rogue]).featureControls).toEqual([])
  })
})

describe('billing surface (ADR-041 Phase 5)', () => {
  const billing = TENANT_SURFACES.find((s) => s.kind === 'nav' && s.id === 'billing')

  it('is a nav entry on the Owner permission or invoice access, and the Owner permission is allowlisted', () => {
    expect(billing).toBeDefined()
    expect(billing?.requires).toEqual({ anyPermission: ['billing.manage', 'billing.invoice.read'] })
    expect(FEATURE_CONTROL_ALLOWLIST).toContain('billing.manage')
  })

  it('shows for either billing permission and for nobody else', () => {
    const ids = (permissions: string[]) => buildTenantSurfaces({ permissions, enabledModuleIds: [] }).nav.map((n) => n.id)
    expect(ids(['billing.manage'])).toContain('billing')
    expect(ids(['billing.invoice.read'])).toContain('billing')
    expect(ids(['site.details.read', 'users.manage', 'modules.manage'])).not.toContain('billing')
  })
})

describe('nav surfaces', () => {
  const nav = TENANT_SURFACES.filter((s): s is NavSurface => s.kind === 'nav')
  const tenantRoutes = path.join(ROOT, 'src/app/[locale]/(client)/[tenant]')

  for (const locale of LOCALES) {
    const messages = JSON.parse(readFileSync(path.join(ROOT, 'messages', `${locale}.json`), 'utf8'))
    for (const s of nav) {
      it(`${locale}: clientDashboard.nav.${s.id} exists`, () => {
        const label = messages.clientDashboard?.nav?.[s.id]
        expect(typeof label).toBe('string')
        expect((label as string).trim()).not.toBe('')
      })
    }
  }

  for (const s of nav) {
    it.skipIf(s.available === false)(`${s.id}: segment "${s.segment}" is an existing route folder`, () => {
      const dir = path.join(tenantRoutes, s.segment)
      expect(existsSync(dir) && statSync(dir).isDirectory()).toBe(true)
      expect(existsSync(path.join(dir, 'page.tsx')), `${s.segment}/page.tsx`).toBe(true)
    })
  }

  it('segments are unique', () => {
    expect(new Set(nav.map((s) => s.segment)).size).toBe(nav.length)
  })
})

describe('no tenant route or component reaches configuration code', () => {
  // Studio structure, the integration config registry, Studio panes and the
  // sanity/ folder are admin-only. The client app reads content only through
  // the tenant-scoped data layer.
  const FORBIDDEN: [string, RegExp][] = [
    ['sanity/structure', /from\s+['"]sanity\/structure['"]|import\(\s*['"]sanity\/structure['"]/],
    ['@/lib/integrations', /from\s+['"]@\/lib\/integrations(\/[^'"]*)?['"]/],
    ['@/sanity (Studio)', /from\s+['"]@\/sanity(\/[^'"]*)?['"]/],
    ['Studio panes', /from\s+['"]@\/lib\/sanity\/studio(\/[^'"]*)?['"]/],
    ['Studio navigation', /from\s+['"]@\/lib\/modules\/navigation['"]/],
  ]
  // The shared App layer (ADR-030) renders inside the tenant UI too.
  const dirs = ['src/app/[locale]/(client)', 'src/components/client', 'src/components/app']

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      if (statSync(full).isDirectory()) return sources(full)
      return /\.(ts|tsx)$/.test(name) && !full.includes('__tests__') ? [full] : []
    })
  }

  const files = dirs.flatMap((d) => sources(path.join(ROOT, d)))
  it('finds the client sources', () => {
    expect(files.length).toBeGreaterThan(20)
  })
  for (const [label, re] of FORBIDDEN) {
    it(`nothing imports ${label}`, () => {
      const offenders = files.filter((f) => re.test(readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f))
      expect(offenders).toEqual([])
    })
  }
})

describe('buildTenantSurfaces', () => {
  const grantFor = (role: 'owner' | 'editor' | 'viewer', modules: string[]) => ({
    permissions: grantPermissions(role, modules),
    enabledModuleIds: modules,
  })
  const ids = (s: { id: string }[]) => s.map((x) => x.id)

  it('an owner with every module sees every nav item and the module widgets', () => {
    const s = buildTenantSurfaces(grantFor('owner', ['blog', 'forms', 'gallery']))
    // ADR-042 §3: Content · Catalogue · Visitors · Library · Insights · Project, then the bottom block.
    expect(ids(s.nav)).toEqual(['blog', 'gallery', 'forms', 'media', 'taxonomy', 'analytics', 'users', 'connections', 'settings', 'support'])
    expect(s.nav.map((n) => n.group)).toEqual(['content', 'content', 'visitors', 'library', 'library', 'insights', 'project', 'project', 'project', 'bottom'])
    expect(ids(s.widgets)).toEqual(expect.arrayContaining(['siteStatus', 'attention', 'glance.posts', 'glance.requests', 'glance.galleries', 'traffic', 'latest.posts']))
  })

  it('analytics: Owner and Site admin by role; an Editor only with the extra (ADR-029 §7.1)', () => {
    expect(ids(buildTenantSurfaces(grantFor('owner', [])).nav)).toContain('analytics')
    const editor = grantFor('editor', ['blog'])
    expect(ids(buildTenantSurfaces(editor).nav)).not.toContain('analytics')
    expect(ids(buildTenantSurfaces(editor).widgets)).not.toContain('traffic')
    const withExtra = { ...editor, permissions: [...editor.permissions, 'analytics.read'] }
    expect(ids(buildTenantSurfaces(withExtra).nav)).toContain('analytics')
    expect(ids(buildTenantSurfaces(withExtra).widgets)).toContain('traffic')
  })

  it('an editor never gets Users, and never a configuration-gated surface', () => {
    const s = buildTenantSurfaces(grantFor('editor', ['blog', 'gallery']))
    expect(ids(s.nav)).toContain('blog')
    expect(ids(s.nav)).not.toContain('users')
    expect(ids(s.nav)).not.toContain('connections') // ADR-031: connections.manage is Owner / Site admin only
    expect(ids(s.nav)).not.toContain('forms') // module not installed
  })

  it('Settings: Owner, Site admin and Editor see it; nobody without site.details.read', () => {
    for (const role of ['owner', 'editor'] as const) expect(ids(buildTenantSurfaces(grantFor(role, ['blog'])).nav)).toContain('settings')
    expect(ids(buildTenantSurfaces({ permissions: [], enabledModuleIds: [] }).nav)).not.toContain('settings')
    expect(ids(buildTenantSurfaces({ permissions: ['settings.manage'], enabledModuleIds: [] }).nav)).not.toContain('settings')
  })

  it('a member with no extras gets only widgets that require nothing', () => {
    const s = buildTenantSurfaces({ permissions: [], enabledModuleIds: [] })
    expect(ids(s.nav)).toEqual(['support']) // the Support page is for everyone on the project
    expect(s.featureControls).toEqual([])
    expect(s.widgets.length).toBeGreaterThan(0)
    expect(s.widgets.every((w) => requirementPermissions(w.requires).length === 0 && !w.requires.module)).toBe(true)
  })

  it('a module that is not installed yields nothing, even when the permission is held', () => {
    const s = buildTenantSurfaces({ permissions: ['blog.post.read', 'blog.post.write'], enabledModuleIds: [] })
    expect(ids(s.nav)).not.toContain('blog')
    expect(ids(s.widgets)).not.toContain('glance.posts')
    expect(ids(s.widgets)).not.toContain('latest.posts')
  })

  it('surfaceAllowed requires module AND permission AND any-of', () => {
    const g = { permissions: ['a'], enabledModuleIds: ['m'] }
    expect(surfaceAllowed(g, { module: 'm', permission: 'a' })).toBe(true)
    expect(surfaceAllowed(g, { module: 'x', permission: 'a' })).toBe(false)
    expect(surfaceAllowed(g, { module: 'm', permission: 'b' })).toBe(false)
    expect(surfaceAllowed(g, { anyPermission: ['b', 'a'] })).toBe(true)
    expect(surfaceAllowed(g, { anyPermission: ['b', 'c'] })).toBe(false)
  })
})

// ── Module coverage (Tom, 2026-10-08) ─────────────────────────────────────────
// Every installable module either has tenant surfaces or is explicitly listed
// as "not yet built" / "admin only" — never silently missing.

describe('module coverage', () => {
  const surfaced = new Set(ALL_SURFACES.map((s) => s.requires.module).filter(Boolean))

  it.each(MODULE_REGISTRY.map((m) => m.id))('module "%s" has tenant surfaces or a declared reason', (id) => {
    expect(surfaced.has(id) || id in MODULES_WITHOUT_TENANT_SURFACE).toBe(true)
  })

  it('no module is both surfaced and listed as missing', () => {
    for (const id of Object.keys(MODULES_WITHOUT_TENANT_SURFACE)) expect(surfaced.has(id)).toBe(false)
  })

  it('the missing-list names only real modules', () => {
    const ids = new Set(MODULE_REGISTRY.map((m) => m.id))
    for (const id of Object.keys(MODULES_WITHOUT_TENANT_SURFACE)) expect(ids.has(id)).toBe(true)
  })
})

describe('catalogue group (ADR-033 spec §10.1, ADR-042 N2 / N2a)', () => {
  const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id)
  const READ = grantPermissions('viewer', ['catalogue'])

  it('Items, Collections and Options + the glance widget, for anyone who can read items, only with the module', () => {
    const s = buildTenantSurfaces({ enabledModuleIds: ['catalogue'], permissions: READ })
    expect(ids(s.nav.filter((n) => n.group === 'catalogue'))).toEqual(['catalogueItems', 'catalogueCollections', 'catalogueOptions'])
    expect(ids(s.widgets)).toContain('glance.catalogue')
    const without = buildTenantSurfaces({ enabledModuleIds: [], permissions: grantPermissions('owner', []) })
    expect(ids(without.nav).filter((i) => i.startsWith('catalogue'))).toEqual([])
    expect(ids(without.widgets)).not.toContain('glance.catalogue')
  })

  it('fails closed: without catalogue.item.read the group is empty (no group, no entries)', () => {
    const s = buildTenantSurfaces({ enabledModuleIds: ['catalogue'], permissions: [] })
    expect(s.nav.filter((n) => n.group === 'catalogue')).toEqual([])
  })

  it('routes: /catalogue/items, /catalogue/collections, /catalogue/option-lists; Items owns the editor and new-item routes', () => {
    const byId = (id: string) => TENANT_SURFACES.find((t): t is NavSurface => t.kind === 'nav' && t.id === id)!
    expect(byId('catalogueItems').segment).toBe('catalogue/items')
    expect(byId('catalogueCollections').segment).toBe('catalogue/collections')
    expect(byId('catalogueOptions').segment).toBe('catalogue/option-lists')
    expect(byId('catalogueItems').owns).toEqual({ base: 'catalogue', except: ['collections', 'option-lists', 'setup'] })
  })

  it('Setup is declared but hidden until its route exists, whatever the permissions', () => {
    const setup = TENANT_SURFACES.find((t): t is NavSurface => t.kind === 'nav' && t.id === 'catalogueSetup')!
    expect(setup.available).toBe(CATALOGUE_SETUP_ROUTE_EXISTS)
    const all = buildTenantSurfaces({ enabledModuleIds: ['catalogue'], permissions: [...READ, 'catalogue.taxonomy.write', CATALOGUE_SETUP_PERMISSION] })
    expect(ids(all.nav)).not.toContain('catalogueSetup')
  })

  it('once its route exists: Setup permission or catalogue.taxonomy.write opens it, plain readers do not (N2a)', () => {
    const setup = { ...TENANT_SURFACES.find((t): t is NavSurface => t.kind === 'nav' && t.id === 'catalogueSetup')!, available: true }
    const registry = [setup]
    const visible = (permissions: string[]) => ids(buildTenantSurfaces({ enabledModuleIds: ['catalogue'], permissions }, registry).nav)
    expect(visible(['catalogue.taxonomy.write'])).toEqual(['catalogueSetup'])
    expect(visible(READ)).toEqual([])
    expect(buildTenantSurfaces({ enabledModuleIds: [], permissions: ['catalogue.taxonomy.write'] }, registry).nav).toEqual([])
  })

  it('the Setup permission is gated by a helper that is false until the permission exists in the manifest', () => {
    const manifest = { has: (id: string) => JSON.stringify(MODULE_REGISTRY).includes(`"id":"${id}"`) }
    expect(CATALOGUE_SETUP_PERMISSION_DEFINED).toBe(manifest.has(CATALOGUE_SETUP_PERMISSION))
    expect(catalogueSetupPermissions().includes(CATALOGUE_SETUP_PERMISSION)).toBe(CATALOGUE_SETUP_PERMISSION_DEFINED)
    expect(catalogueSetupPermissions()).toContain('catalogue.taxonomy.write')
  })

  it('the Setup route flag matches the route folder', () => {
    expect(existsSync(path.join(ROOT, 'src/app/[locale]/(client)/[tenant]/catalogue/setup/page.tsx'))).toBe(CATALOGUE_SETUP_ROUTE_EXISTS)
  })
})

describe('navigation groups (ADR-042 N1, section 3)', () => {
  const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id)
  const all = MODULE_REGISTRY.map((m) => m.id)
  const owner = { permissions: [...grantPermissions('owner', all), 'billing.manage', 'catalogue.taxonomy.write'], enabledModuleIds: all }

  it('the groups are Content · Catalogue · Visitors · Library · Insights · Project, then the bottom block', () => {
    expect([...NAV_GROUPS]).toEqual(['content', 'catalogue', 'visitors', 'library', 'insights', 'project', 'bottom'])
  })

  it('places every destination as Tom confirmed (2026-11-02)', () => {
    const by = (g: string) => ids(buildTenantSurfaces(owner).nav.filter((n) => n.group === g))
    expect(by('content')).toEqual(['blog', 'events', 'faq', 'gallery', 'documents'])
    expect(by('catalogue')).toEqual(['catalogueItems', 'catalogueCollections', 'catalogueOptions'])
    expect(by('visitors')).toEqual(['forms', 'members'])
    expect(by('library')).toEqual(['people', 'media', 'taxonomy'])
    expect(by('insights')).toEqual(['analytics'])
    expect(by('project')).toEqual(['users', 'connections', 'settings', 'billing'])
    expect(by('bottom')).toEqual(['support'])
  })

  it('every group is a known group and sorted: no entry sits before an earlier group', () => {
    const groups = buildTenantSurfaces(owner).nav.map((n) => NAV_GROUPS.indexOf(n.group))
    expect(groups.every((g) => g >= 0)).toBe(true)
    expect([...groups].sort((a, b) => a - b)).toEqual(groups)
  })

  it('nothing sits in the wrong group for a person with little access (entry visibility by permission)', () => {
    const editor = buildTenantSurfaces({ enabledModuleIds: ['blog', 'catalogue'], permissions: ['blog.post.read'] }).nav
    expect(ids(editor)).toEqual(['blog', 'taxonomy', 'support'])
  })

  it('navSegmentsFor reports first path segments once (the project switcher)', async () => {
    const { navSegmentsFor } = await import('../surfaces')
    const segs = navSegmentsFor({ enabledModuleIds: ['catalogue'], permissions: READ_ITEMS })
    expect(segs.filter((s) => s === 'catalogue')).toEqual(['catalogue'])
    expect(segs).not.toContain('catalogue/items')
  })
})

const READ_ITEMS = ['catalogue.item.read']

describe('switchTarget — the project switcher never lands on a 404', async () => {
  const { switchTarget, navSegmentsFor } = await import('../surfaces')
  it('keeps the section when the next project has it', () => {
    expect(switchTarget('/tmz/posts', 'tmz', 'livener', ['posts', 'agenda'])).toBe('/livener/posts')
  })
  it('goes to Home when the next project lacks the section (TMZ Catalogue → Livener)', () => {
    expect(switchTarget('/tmz/catalogue', 'tmz', 'livener', ['posts', 'agenda'])).toBe('/livener/home')
    expect(switchTarget('/tmz/settings', 'tmz', 'livener', ['posts'])).toBe('/livener/home')
  })
  it('opens the list, not an item of the old project', () => {
    expect(switchTarget('/tmz/catalogue/abc-123', 'tmz', 'shop', ['catalogue'])).toBe('/shop/catalogue')
  })
  it('Home and bare paths go to Home', () => {
    expect(switchTarget('/tmz/home', 'tmz', 'livener', ['posts'])).toBe('/livener/home')
    expect(switchTarget('/tmz', 'tmz', 'livener', ['posts'])).toBe('/livener/home')
  })
  it('a project section list follows modules and permissions', () => {
    const segs = navSegmentsFor({ enabledModuleIds: ['events', 'forms'], permissions: ['events.event.read', 'forms.submission.read'] })
    expect(segs).toContain('agenda')
    expect(segs).toContain('submissions')
    expect(segs).not.toContain('catalogue')
  })
})
