import { describe, expect, it } from 'vitest'
import { buildCreateMenu, CREATE_CONTENT_TYPES } from '../create-menu'
import { MODULE_PERMISSION_MAP } from '../permissions'
import { permissionsForRole } from '@/lib/api/tenant-context'

const grantFor = (role: 'owner' | 'editor' | 'viewer', enabledModuleIds: string[]) => ({
  role,
  enabledModuleIds,
  permissions: permissionsForRole(role, enabledModuleIds),
})

describe('Add-content sheet (ADR-025 D8)', () => {
  it('every create permission is a real module permission', () => {
    const declared = JSON.stringify(MODULE_PERMISSION_MAP)
    for (const t of CREATE_CONTENT_TYPES) expect(declared).toContain(`"${t.permission}"`)
  })

  it('owner: installed types (Blog ready, News coming soon) + not-installed ones under "more"', () => {
    const m = buildCreateMenu(grantFor('owner', ['blog', 'news', 'forms']))
    expect(m.available).toEqual([
      { moduleId: 'blog', ready: true },
      { moduleId: 'news', ready: false },
    ])
    expect(m.more).toEqual(['events', 'gallery'])
  })

  it('editor: same choices, never the upsell', () => {
    const m = buildCreateMenu(grantFor('editor', ['blog', 'news']))
    expect(m.available.map((a) => a.moduleId)).toEqual(['blog', 'news'])
    expect(m.more).toEqual([])
  })

  it('viewer: nothing to create, no upsell', () => {
    expect(buildCreateMenu(grantFor('viewer', ['blog', 'news']))).toEqual({ available: [], more: [] })
  })
})
