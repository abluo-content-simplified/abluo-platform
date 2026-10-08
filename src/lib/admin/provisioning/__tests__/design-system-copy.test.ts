import { describe, expect, it } from 'vitest'
import { buildProjectDesignSystem } from '../design-system-copy'
import { resolveDesignSystemInheritance } from '@/lib/sanity/design-system-resolver'
import type { DesignSystem } from '@/lib/sanity/types'

const TARGET = { docId: 'ds-rossi', projectSlug: 'rossi', name: 'Studio Rossi' }

const template = {
  _id: 'abluo-base-design-system',
  _type: 'designSystem',
  _rev: 'r1',
  _createdAt: '2026-01-01',
  _updatedAt: '2026-01-02',
  role: 'template',
  name: 'Abluo Base',
  colors: { light: { primary: '#111111' } },
}

const active = {
  _id: 'ds-hoffmann',
  _type: 'designSystem',
  _rev: 'r9',
  _createdAt: '2026-01-01',
  _updatedAt: '2026-02-02',
  role: 'active',
  name: 'Hoffmann',
  description: 'Poppy',
  projectSlug: 'hoffmann',
  parentDesignSystem: { _type: 'reference', _ref: 'psicoterapia-base' },
  colors: { light: { primary: '#C2410C', background: '#FFFFFF' } },
  typography: { headingFont: { family: 'Fraunces' }, typescale: [{ _key: 'h1', level: 'h1', size: 56 }] },
  someFutureField: { nested: [1, 2, 3] },
}

describe('buildProjectDesignSystem — from a template', () => {
  it('creates an empty active child of the template (everything inherited)', () => {
    expect(buildProjectDesignSystem(template, TARGET)).toEqual({
      _id: 'ds-rossi',
      _type: 'designSystem',
      name: 'Studio Rossi',
      role: 'active',
      projectSlug: 'rossi',
      parentDesignSystem: { _type: 'reference', _ref: 'abluo-base-design-system' },
    })
  })

  it('references the PUBLISHED template even when given a draft id', () => {
    expect(buildProjectDesignSystem({ ...template, _id: 'drafts.abluo-base-design-system' }, TARGET).parentDesignSystem).toEqual({ _type: 'reference', _ref: 'abluo-base-design-system' })
  })
})

describe("buildProjectDesignSystem — from another project's active system", () => {
  const copy = buildProjectDesignSystem(active, TARGET)

  it('copies every own field (field-agnostic, incl. fields added later)', () => {
    expect(copy.colors).toEqual(active.colors)
    expect(copy.typography).toEqual(active.typography)
    expect(copy.someFutureField).toEqual({ nested: [1, 2, 3] })
  })

  it("takes the new project's identity and keeps the source's parent", () => {
    expect(copy).toMatchObject({ _id: 'ds-rossi', _type: 'designSystem', name: 'Studio Rossi', role: 'active', projectSlug: 'rossi' })
    expect(copy.parentDesignSystem).toEqual({ _type: 'reference', _ref: 'psicoterapia-base' })
  })

  it('drops Sanity metadata and the source description', () => {
    for (const k of ['_rev', '_createdAt', '_updatedAt', 'description']) expect(copy).not.toHaveProperty(k)
  })

  it('never shares nested objects with the source (editing the copy cannot touch the source)', () => {
    ;(copy.colors as { light: { primary: string } }).light.primary = '#000000'
    expect(active.colors.light.primary).toBe('#C2410C')
  })

  it('has no parent when the source had none', () => {
    const { parentDesignSystem: _p, ...noParent } = active
    void _p
    expect(buildProjectDesignSystem(noParent, TARGET)).not.toHaveProperty('parentDesignSystem')
  })

  it('treats a system without a role as active (copied, not inherited)', () => {
    const { role: _r, ...legacy } = active
    void _r
    expect(buildProjectDesignSystem(legacy, TARGET).colors).toEqual(active.colors)
  })

  it('resolves to the same design as the source over the same parent', async () => {
    const parent = { _id: 'psicoterapia-base', role: 'template', colors: { light: { primary: '#0000FF', surface: '#EEEEEE' } }, radius: { medium: 8 } }
    const fetchFn = async (id: string) => (id === 'psicoterapia-base' ? (parent as unknown as DesignSystem) : null)
    const resolve = (d: unknown) => resolveDesignSystemInheritance(d as DesignSystem, fetchFn)
    const strip = (d: DesignSystem | null) => {
      const { _id, name, projectSlug, description, ...rest } = (d ?? {}) as Record<string, unknown>
      void [_id, name, projectSlug, description]
      return rest
    }
    const fresh = buildProjectDesignSystem(active, TARGET) // `copy` was mutated above
    expect(strip(await resolve(fresh))).toEqual(strip(await resolve(active)))
    expect((await resolve(fresh))?.radius).toMatchObject({ medium: 8 })
  })
})
