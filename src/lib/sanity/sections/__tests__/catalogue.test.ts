import { describe, it, expect } from 'vitest'
import { PAGE_SECTIONS_OF } from '@/lib/sanity/fields/shared'
import { MODULE_REGISTRY } from '@/lib/modules'
import {
  SECTION_CATALOGUE,
  SECTION_GROUPS,
  insertMenuGroups,
  offeredSectionTypes,
  sectionOwnerMap,
} from '../catalogue'
import { SECTION_PREVIEWS } from '@/sanity/components/section-picker/SectionPreviews'
const SECTION_PREVIEW_TYPES = Object.keys(SECTION_PREVIEWS)

const TYPES = PAGE_SECTIONS_OF.map((m) => (m as { type: string }).type)

describe('section catalogue', () => {
  it('describes every section a page can hold', () => {
    const missing = TYPES.filter((t) => !SECTION_CATALOGUE[t])
    expect(missing, `Add these to SECTION_CATALOGUE (src/lib/sanity/sections/catalogue.ts): ${missing.join(', ')}`).toEqual([])
  })

  it('has no stale entries', () => {
    expect(Object.keys(SECTION_CATALOGUE).filter((t) => !TYPES.includes(t))).toEqual([])
  })

  it('every entry points at a real group and has a short description', () => {
    const groups = new Set(SECTION_GROUPS.map((g) => g.id))
    for (const [type, e] of Object.entries(SECTION_CATALOGUE)) {
      expect(groups.has(e.group), type).toBe(true)
      expect(e.description.length, type).toBeGreaterThan(10)
      expect(e.description.length, `${type}: keep it to one short line`).toBeLessThanOrEqual(100)
    }
  })

  it('every section has a preview sketch', () => {
    expect(TYPES.filter((t) => !SECTION_PREVIEW_TYPES.includes(t))).toEqual([])
  })

  it('module sections sit in the module group, platform sections do not', () => {
    const owner = sectionOwnerMap(MODULE_REGISTRY)
    for (const t of TYPES) {
      if (owner[t]) expect(SECTION_CATALOGUE[t].group, t).toBe('modules')
    }
  })

  it('insert-menu groups cover every type exactly once', () => {
    const flat = insertMenuGroups(TYPES).flatMap((g) => g.of)
    expect(flat.sort()).toEqual([...TYPES].sort())
  })
})

describe('offeredSectionTypes', () => {
  const owner = { photoGallerySection: 'gallery', faqSection: 'faq' }
  const types = ['heroSection', 'photoGallerySection', 'faqSection']

  it('offers everything when installation state is unknown', () => {
    expect(offeredSectionTypes(types, owner, null)).toEqual(types)
  })
  it('hides sections of modules that are not installed', () => {
    expect(offeredSectionTypes(types, owner, new Set(['faq']))).toEqual(['heroSection', 'faqSection'])
  })
  it('keeps a type already used on the page, so it never turns invalid', () => {
    expect(offeredSectionTypes(types, owner, new Set(), new Set(['photoGallerySection']))).toEqual([
      'heroSection',
      'photoGallerySection',
    ])
  })
})
