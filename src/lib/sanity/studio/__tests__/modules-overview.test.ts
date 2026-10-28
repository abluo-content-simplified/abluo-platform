import { describe, it, expect } from 'vitest'
import { enabledModuleIdsFrom, groupModules } from '../modules-overview'

describe('Modules overview — fixed groups, inactive in place (PLAT-3, Tom 2026-10-28)', () => {
  const registry = [{ id: 'blog' }, { id: 'news' }, { id: 'events' }, { id: 'gallery' }, { id: 'translate' }]

  it('an installation counts as on unless explicitly disabled', () => {
    expect(enabledModuleIdsFrom([
      { moduleId: 'events', enabled: true },
      { moduleId: 'gallery' },
      { moduleId: 'blog', enabled: false },
      { enabled: true },
    ])).toEqual(['events', 'gallery'])
    expect(enabledModuleIdsFrom(null)).toEqual([])
    expect(enabledModuleIdsFrom(undefined)).toEqual([])
  })

  it('groups in the fixed order whatever the registry order; inactive modules stay in place, marked off', () => {
    const groups = groupModules(registry, ['translate', 'events'])
    expect(groups.map((g) => [g.label, g.modules.map((m) => `${m.module.id}:${m.on ? 'on' : 'off'}`)])).toEqual([
      ['Publish', ['blog:off', 'news:off', 'events:on']],
      ['Show', ['gallery:off']],
      ['Tools', ['translate:on']],
    ])
    // Switching modules on or off never moves a row.
    const ids = (en: string[]) => groupModules(registry, en).flatMap((g) => g.modules.map((m) => m.module.id))
    expect(ids([])).toEqual(ids(['blog', 'gallery', 'translate']))
    expect(ids(['events'])).toEqual(ids([...registry].reverse().map((m) => m.id)))
  })

  it('a project with no modules lists everything, all off', () => {
    const all = groupModules(registry, []).flatMap((g) => g.modules)
    expect(all).toHaveLength(5)
    expect(all.every((m) => !m.on)).toBe(true)
  })
})
