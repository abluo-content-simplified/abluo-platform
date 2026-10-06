import { describe, expect, it } from 'vitest'
import {
  canAdvanceGallery,
  canSaveGallery,
  clampIndex,
  firstUndescribed,
  galleryStartStep,
  galleryWizardSteps,
  gallerySections,
} from '../gallery-wizard'

const g = (o: Partial<Parameters<typeof canSaveGallery>[0]> = {}) => ({
  title: { it: 'Studio' },
  description: {},
  tags: [],
  items: [{ alt: { it: 'Sala' } }, { alt: { it: 'Ingresso' } }],
  ...o,
})

describe('gallery wizard steps', () => {
  it('languages only on multilingual sites; review/done are not first-pass steps', () => {
    expect(galleryWizardSteps({ languages: ['it'] })).toEqual(['name', 'photos', 'describe', 'preview'])
    expect(galleryWizardSteps({ languages: ['it', 'en'] })).toEqual(['name', 'photos', 'describe', 'languages', 'preview'])
  })
  it('new galleries start at the name, existing ones on the overview', () => {
    expect(galleryStartStep(true)).toBe('name')
    expect(galleryStartStep(false)).toBe('review')
  })
})

describe('canAdvanceGallery / canSaveGallery', () => {
  it('name needs a title in the main language', () => {
    expect(canAdvanceGallery('name', g({ title: { en: 'x' } }), 'it')).toBe(false)
    expect(canAdvanceGallery('name', g({ title: { it: '  ' } }), 'it')).toBe(false)
    expect(canAdvanceGallery('name', g(), 'it')).toBe(true)
  })
  it('photos needs at least one photo', () => {
    expect(canAdvanceGallery('photos', g({ items: [] }), 'it')).toBe(false)
    expect(canAdvanceGallery('photos', g(), 'it')).toBe(true)
  })
  it('describing never blocks Next; firstUndescribed skips missing assets', () => {
    const items: { alt: Record<string, string>; missing?: boolean }[] = [{ alt: { it: 'Sala' } }, { alt: {} }, { alt: {}, missing: true }]
    expect(canAdvanceGallery('describe', g({ items }), 'it')).toBe(true)
    expect(firstUndescribed(items, 'it')).toBe(1)
    expect(firstUndescribed([items[0], items[2]], 'it')).toBe(-1)
  })
  it('saving needs a title and a photo — never a description (describe later)', () => {
    expect(canSaveGallery(g(), 'it')).toBe(true)
    expect(canSaveGallery(g({ title: {} }), 'it')).toBe(false)
    expect(canSaveGallery(g({ items: [] }), 'it')).toBe(false)
    expect(canSaveGallery(g({ items: [{ alt: {} }] }), 'it')).toBe(true)
  })
})

describe('gallerySections', () => {
  it('states per section, languages on multilingual sites only', () => {
    expect(gallerySections(g(), { languages: ['it'], defaultLocale: 'it' })).toEqual([
      { id: 'name', state: 'done' },
      { id: 'photos', state: 'done' },
      { id: 'describe', state: 'done' },
    ])
    expect(gallerySections(g({ items: [] }), { languages: ['it', 'de'], defaultLocale: 'it' })).toEqual([
      { id: 'name', state: 'done' },
      { id: 'photos', state: 'missing' },
      { id: 'describe', state: 'optional' },
      { id: 'languages', state: 'optional' },
    ])
    expect(gallerySections(g({ title: { it: 'a', de: 'b' } }), { languages: ['it', 'de'], defaultLocale: 'it' })[3]).toEqual({ id: 'languages', state: 'done' })
    // Photos still to describe are optional, never "missing".
    expect(gallerySections(g({ items: [{ alt: {} }] }), { languages: ['it'], defaultLocale: 'it' })[2]).toEqual({ id: 'describe', state: 'optional' })
  })
})

describe('clampIndex', () => {
  it('keeps the position inside the list', () => {
    expect(clampIndex(5, 3)).toBe(2)
    expect(clampIndex(-1, 3)).toBe(0)
    expect(clampIndex(4, 0)).toBe(0)
  })
})
