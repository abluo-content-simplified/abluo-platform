import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { buildCreateMenu, CREATE_CONTENT_TYPES } from '../add-content-sheet'
import { MODULE_DASHBOARD_ROUTES } from '../client-navigation'
import { MODULE_PERMISSION_MAP } from '../permissions'
import { MODULE_REGISTRY } from '../registry'
import { grantPermissions } from '@/lib/api/tenant-context'

const grantFor = (role: 'owner' | 'editor' | 'viewer', enabledModuleIds: string[]) => ({
  enabledModuleIds,
  projectSlug: 'demo' as never,
  // Full grant permissions (module + platform), as the resolver produces them — ADR-028.
  permissions: grantPermissions(role, enabledModuleIds),
})
const ids = (m: { available: { moduleId: string }[] }) => m.available.map((a) => a.moduleId)

describe('Add-content sheet (ADR-025 D8) — derived from module create actions', () => {
  it('every create permission is a real module permission, ready actions have an href', () => {
    const declared = JSON.stringify(MODULE_PERMISSION_MAP)
    for (const t of CREATE_CONTENT_TYPES) {
      expect(declared).toContain(`"${t.permission}"`)
      if (t.ready) expect(t.href?.('demo')).toMatch(/^\/demo\//)
    }
  })

  it('order follows createOrder and is unique', () => {
    const orders = CREATE_CONTENT_TYPES.map((t) => t.createOrder)
    expect(new Set(orders).size).toBe(orders.length)
    expect(CREATE_CONTENT_TYPES.map((t) => t.moduleId)).toEqual(['blog', 'news', 'events', 'gallery', 'catalogue', 'faq', 'courses', 'people', 'documents', 'testimonials'])
  })

  it('owner: installed types (Blog ready, News coming soon) + not-installed ones under "more"', () => {
    const m = buildCreateMenu(grantFor('owner', ['blog', 'news', 'forms']))
    expect(m.available).toEqual([
      { moduleId: 'blog', ready: true, iconKey: 'blog', href: '/demo/posts/write/new' },
      { moduleId: 'news', ready: false, iconKey: 'news' },
    ])
    expect(m.more).toEqual(['events', 'gallery', 'catalogue', 'faq', 'courses', 'people', 'documents', 'testimonials'])
  })

  it('catalogue (ADR-033 spec §10.1) and faq (ADR-037 D9): offered to writers, never to viewers', () => {
    expect(buildCreateMenu(grantFor('editor', ['catalogue'])).available).toEqual([{ moduleId: 'catalogue', ready: true, iconKey: 'catalogue', href: '/demo/catalogue/new' }])
    expect(buildCreateMenu(grantFor('editor', ['faq'])).available[0].href).toBe('/demo/faq-sets?new=1')
    expect(buildCreateMenu(grantFor('viewer', ['catalogue', 'faq'])).available).toEqual([])
  })

  it('CYCE-like install: courses, people, documents, events, faq all present for the owner, in order', () => {
    const m = buildCreateMenu(grantFor('owner', ['courses', 'people', 'documents', 'events', 'faq']))
    expect(ids(m)).toEqual(['events', 'faq', 'courses', 'people', 'documents'])
    expect(m.available.map((a) => a.href)).toEqual(['/demo/agenda/new', '/demo/faq-sets?new=1', '/demo/courses?new=1', '/demo/people?new=1', '/demo/document-library/new'])
  })

  it('editor without people permission gets no "New person"', () => {
    const g = grantFor('editor', ['courses', 'people'])
    const m = buildCreateMenu({ ...g, permissions: g.permissions.filter((p) => p !== 'people.person.write') })
    expect(ids(m)).toContain('courses')
    expect(ids(m)).not.toContain('people')
  })

  it('editor: same choices, never the upsell', () => {
    const m = buildCreateMenu(grantFor('editor', ['blog', 'news']))
    expect(ids(m)).toEqual(['blog', 'news'])
    expect(m.more).toEqual([])
  })

  it('viewer: nothing to create, no upsell', () => {
    expect(buildCreateMenu(grantFor('viewer', ['blog', 'news']))).toEqual({ available: [], more: [] })
  })
})

describe('create-action guard', () => {
  const tenantDir = path.join(process.cwd(), 'src/app/[locale]/(client)/[tenant]')
  it('every module whose dashboard has a creation route (…/new folder or ?new=1 opener) declares a createAction', () => {
    const missing: string[] = []
    for (const [moduleId, segment] of Object.entries(MODULE_DASHBOARD_ROUTES)) {
      const dir = path.join(tenantDir, segment)
      if (!fs.existsSync(dir)) continue
      const hasNewFolder = fs.existsSync(path.join(dir, 'new')) || fs.existsSync(path.join(dir, 'write', 'new'))
      const page = path.join(dir, 'page.tsx')
      const hasOpener = fs.existsSync(page) && fs.readFileSync(page, 'utf8').includes('new=1')
      if ((hasNewFolder || hasOpener) && !MODULE_REGISTRY.find((m) => m.id === moduleId)?.createAction) missing.push(`${moduleId} (${segment})`)
    }
    expect(missing).toEqual([])
  })
})
