/**
 * The tenant/admin boundary (ADR-029 §3.1): nothing renders in the tenant UI
 * unless it is registered in `surfaces.ts`, and nothing registered may expose
 * platform configuration. This is the test that turns "opt-in, not automatic"
 * from a convention into a build failure.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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
  return [...(r.permission ? [r.permission] : []), ...(r.anyPermission ?? [])]
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
    // Only Home-level widgets (site status, attention) may be open to every member.
    const open = TENANT_SURFACES.filter((s) => requirementPermissions(s.requires).length === 0 && !s.requires.module)
    expect(open.every((s) => s.kind === 'widget')).toBe(true)
  })

  it('no entry is gated on a configuration permission', () => {
    for (const s of TENANT_SURFACES) {
      for (const p of requirementPermissions(s.requires)) {
        expect(CONFIGURATION_PERMISSIONS, `${s.kind}:${s.id} requires ${p}`).not.toContain(p)
      }
    }
  })

  it('every feature control is on the allowlist; the allowlist has no stale ids', () => {
    const controls = TENANT_SURFACES.filter((s): s is FeatureControlSurface => s.kind === 'featureControl')
    for (const c of controls) expect(FEATURE_CONTROL_ALLOWLIST).toContain(c.id)
    for (const id of FEATURE_CONTROL_ALLOWLIST) expect(controls.map((c) => c.id)).toContain(id)
  })

  it('buildTenantSurfaces drops a feature control that is not allowlisted', () => {
    const rogue: TenantSurface = { kind: 'featureControl', id: 'rogue', requires: {} }
    expect(buildTenantSurfaces({ permissions: [], enabledModuleIds: [] }, [rogue]).featureControls).toEqual([])
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
    it(`${s.id}: segment "${s.segment}" is an existing route folder`, () => {
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
  const dirs = ['src/app/[locale]/(client)', 'src/components/client']

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
    expect(ids(s.nav)).toEqual(['blog', 'forms', 'gallery', 'media', 'people'])
    expect(ids(s.widgets)).toEqual(expect.arrayContaining(['siteStatus', 'attention', 'glance.posts', 'glance.requests', 'glance.galleries', 'latest.posts']))
  })

  it('an editor never gets People, and never a configuration-gated surface', () => {
    const s = buildTenantSurfaces(grantFor('editor', ['blog', 'gallery']))
    expect(ids(s.nav)).toContain('blog')
    expect(ids(s.nav)).not.toContain('people')
    expect(ids(s.nav)).not.toContain('forms') // module not installed
  })

  it('a member with no extras gets only widgets that require nothing', () => {
    const s = buildTenantSurfaces({ permissions: [], enabledModuleIds: [] })
    expect(s.nav).toEqual([])
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
