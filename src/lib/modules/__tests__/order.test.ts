/**
 * PLAT-3 — one fixed module order and grouping (Tom, 2026-10-28), shared by the
 * Studio module list and the client dashboard sidebar. Deterministic whatever
 * order modules were registered or installed in.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODULE_REGISTRY } from '../registry'
import { compareModuleIds, groupByModuleOrder, MODULE_GROUPS, moduleGroupOf, sortByModuleOrder } from '../order'
import { buildTenantSurfaces, TENANT_SURFACES, type NavSurface } from '@/lib/client/surfaces'
import { buildClientNavItems } from '../client-navigation'
import { groupModules } from '@/lib/sanity/studio/modules-overview'
import { grantPermissions } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const ids = <T extends { id: string }>(xs: readonly T[]) => xs.map((x) => x.id)
function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const out = [...xs]
  let s = seed
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1103515245 + 12345) % 2 ** 31
    const j = s % (i + 1)
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

describe('the approved table', () => {
  it('Publish · Show · Visitors · Tools, with Documents after Catalogue and Live at the end of Publish', () => {
    expect(MODULE_GROUPS.map((g) => [g.label, [...g.modules]])).toEqual([
      ['Publish', ['blog', 'news', 'events', 'faq', 'live']],
      ['Show', ['gallery', 'catalogue', 'documents']],
      ['Visitors', ['forms', 'whatsapp', 'members']],
      ['Tools', ['translate', 'brand-hub']],
    ])
  })
  it('every registered module is placed on purpose (none falls into "Other")', () => {
    expect(MODULE_REGISTRY.filter((m) => moduleGroupOf(m.id) === 'other').map((m) => m.id)).toEqual([])
    const placed = MODULE_GROUPS.flatMap((g) => g.modules)
    expect(new Set(placed).size).toBe(placed.length)
    for (const id of placed) expect(MODULE_REGISTRY.some((m) => m.id === id), `${id} is not a registered module`).toBe(true)
  })
  it('an unknown module goes to "Other", last, ordered by id', () => {
    expect(moduleGroupOf('zeta')).toBe('other')
    expect(sortByModuleOrder(['zeta', 'alpha', 'brand-hub', 'blog'], (x) => x)).toEqual(['blog', 'brand-hub', 'alpha', 'zeta'])
    expect(groupByModuleOrder(['zeta', 'blog'], (x) => x).map((g) => g.group.id)).toEqual(['publish', 'other'])
  })
})

describe('deterministic regardless of registry or install order', () => {
  it('the Studio list order is the same for any registry order', () => {
    const expected = groupModules(MODULE_REGISTRY, []).flatMap((g) => g.modules.map((m) => m.module.id))
    expect(expected).toEqual(['blog', 'news', 'events', 'faq', 'live', 'gallery', 'catalogue', 'documents', 'forms', 'whatsapp', 'members', 'translate', 'brand-hub'])
    for (const seed of [1, 7, 42, 1234]) {
      expect(groupModules(shuffled(MODULE_REGISTRY, seed), shuffled(MODULE_REGISTRY, seed + 1).map((m) => m.id)).flatMap((g) => g.modules.map((m) => m.module.id))).toEqual(expected)
    }
  })
  it('the sidebar order is the same for any install order', () => {
    const all = MODULE_REGISTRY.map((m) => m.id)
    const grant = (enabled: string[]) => ({ projectSlug: asSupabaseProjectSlug('x'), permissions: grantPermissions('owner', all), enabledModuleIds: enabled })
    const expected = buildClientNavItems(grant(all)).map((i) => i.moduleId)
    for (const seed of [3, 11, 99]) expect(buildClientNavItems(grant(shuffled(all, seed))).map((i) => i.moduleId)).toEqual(expected)
  })
  it('compareModuleIds is a total order', () => {
    expect(compareModuleIds('blog', 'blog')).toBe(0)
    expect(Math.sign(compareModuleIds('forms', 'members'))).toBe(-1)
    expect(Math.sign(compareModuleIds('members', 'forms'))).toBe(1)
  })
})

describe('both surfaces use the same source', () => {
  it('the sidebar module entries follow the shared order and carry the shared group', () => {
    const moduleNav = TENANT_SURFACES.filter((s): s is NavSurface => s.kind === 'nav' && Boolean(s.requires.module))
    const modules = moduleNav.map((s) => s.requires.module as string)
    expect(modules).toEqual(sortByModuleOrder(modules, (x) => x))
    for (const s of moduleNav) expect(s.group, s.id).toBe(moduleGroupOf(s.requires.module as string))
  })
  it('an Owner with every module: Home → Publish → Show → Visitors (Access next to Forms) → content → activity → support', () => {
    const all = MODULE_REGISTRY.map((m) => m.id)
    const nav = buildTenantSurfaces({ permissions: grantPermissions('owner', all), enabledModuleIds: all }).nav
    expect(nav.map((n) => [n.id, n.group])).toEqual([
      ['blog', 'publish'], ['events', 'publish'], ['faq', 'publish'],
      ['gallery', 'show'], ['catalogue', 'show'], ['documents', 'show'],
      ['forms', 'visitors'], ['members', 'visitors'],
      ['media', 'content'], ['people', 'content'], ['taxonomy', 'content'],
      ['analytics', 'activity'],
      ['support', 'support'], ['connections', 'support'], ['settings', 'support'],
    ])
  })
  it('Studio and the dashboard both import the shared definition, and neither keeps its own list', () => {
    const root = process.cwd()
    const read = (f: string) => readFileSync(path.join(root, f), 'utf8')
    expect(read('src/lib/client/surfaces.ts')).toMatch(/from '@\/lib\/modules\/order'/)
    expect(read('src/lib/sanity/studio/modules-overview.ts')).toMatch(/from '\.\.\/\.\.\/modules\/order'/)
    expect(read('src/lib/sanity/studio/ModuleList.tsx')).toMatch(/groupByModuleOrder\(MODULE_REGISTRY/)
    expect(read('sanity.config.ts')).toMatch(/sortByModuleOrder\(/)
  })
  it('every group has a dashboard label in en / it / de', () => {
    for (const locale of ['en', 'it', 'de']) {
      const m = JSON.parse(read(`messages/${locale}.json`)).clientDashboard.navGroups as Record<string, string>
      for (const id of [...MODULE_GROUPS.map((g) => g.id), 'other']) expect(m[id], `${locale}: navGroups.${id}`).toBeTruthy()
    }
    function read(f: string) {
      return readFileSync(path.join(process.cwd(), f), 'utf8')
    }
  })
})

void ids
