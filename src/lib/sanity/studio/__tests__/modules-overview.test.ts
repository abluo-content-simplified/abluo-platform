import { describe, it, expect } from 'vitest'
import { enabledModuleIdsFrom, splitModules } from '../modules-overview'

describe('Modules overview — on first, off below (Tom, 2026-09-30)', () => {
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

  it('splits into active / inactive, keeping registry order in each group', () => {
    const { active, inactive } = splitModules(registry, ['translate', 'events'])
    expect(active.map((m) => m.id)).toEqual(['events', 'translate'])
    expect(inactive.map((m) => m.id)).toEqual(['blog', 'news', 'gallery'])
  })

  it('a project with no modules has everything inactive', () => {
    const { active, inactive } = splitModules(registry, [])
    expect(active).toEqual([])
    expect(inactive).toHaveLength(5)
  })
})
