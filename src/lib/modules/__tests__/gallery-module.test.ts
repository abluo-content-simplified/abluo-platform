import { describe, it, expect } from 'vitest'
import { MODULE_REGISTRY } from '../registry'
import { isSectionTypeAvailable } from '../sections'
import { buildSchema } from '../schema'

// ADR-022 — galleries are a module. These pin the parts a regression would
// break silently: ownership of the section (and therefore gating), and the
// schema types still being registered under their unchanged names.

describe('Gallery module', () => {
  const manifest = MODULE_REGISTRY.find((m) => m.id === 'gallery')

  it('is registered and owns the Photo Gallery section', () => {
    expect(manifest).toBeDefined()
    expect(manifest?.platformContract.sectionTypes).toEqual(['photoGallerySection'])
  })

  it('keeps the stored type names, so no document has to move', () => {
    const names = buildSchema().map((t) => t.name)
    for (const n of ['gallery', 'galleryItem', 'photoGallerySection']) {
      expect(names.filter((x) => x === n)).toHaveLength(1)
    }
  })

  it('gates the section on installation, failing open when the module list is unknown', () => {
    expect(isSectionTypeAvailable('photoGallerySection', ['blog'])).toBe(false)
    expect(isSectionTypeAvailable('photoGallerySection', ['gallery'])).toBe(true)
    expect(isSectionTypeAvailable('photoGallerySection', null)).toBe(true)
  })

  it('declares its permissions with the module prefix', () => {
    for (const p of manifest?.platformContract.permissions ?? []) expect(p.id.startsWith('gallery.')).toBe(true)
  })
})
