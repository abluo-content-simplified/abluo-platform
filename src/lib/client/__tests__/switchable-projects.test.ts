import { describe, expect, it } from 'vitest'
import { filterSwitchableProjects } from '../switchable-projects'

const grants = [
  { projectId: 'a', projectSlug: 'hoffmann' },
  { projectId: 'b', projectSlug: 't42' },
  { projectId: 'c', projectSlug: 'cyce' },
]

describe('filterSwitchableProjects', () => {
  it('hides inactive projects', () => {
    const out = filterSwitchableProjects(grants, { a: 'active', b: 'inactive', c: 'preview' })
    expect(out.map((g) => g.projectSlug)).toEqual(['hoffmann', 'cyce'])
  })

  it('keeps the project currently open even when inactive', () => {
    const out = filterSwitchableProjects(grants, { b: 'inactive' }, 't42')
    expect(out.map((g) => g.projectSlug)).toEqual(['hoffmann', 't42', 'cyce'])
  })

  it('hides nothing when statuses are unknown', () => {
    expect(filterSwitchableProjects(grants, {})).toHaveLength(3)
  })
})
