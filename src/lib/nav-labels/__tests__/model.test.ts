import { describe, expect, it } from 'vitest'
import { CUSTOM_LABEL_IDS, cleanNavLabel, labelLocales, labelsFor, planNavLabels } from '../model'

describe('navigation labels (Tom, 2026-11-11)', () => {
  it('only the sections an organisation really names differently', () => {
    expect([...CUSTOM_LABEL_IDS]).toEqual(['blog', 'events', 'courses', 'documents', 'testimonials', 'people'])
  })
  it('one tidy line, at most 30 characters; empty means the default', () => {
    expect(cleanNavLabel('  Our   Teachers ')).toBe('Our Teachers')
    expect(cleanNavLabel('')).toBe('')
    expect(cleanNavLabel('x'.repeat(31))).toBeNull()
    expect(cleanNavLabel(3)).toBeNull()
  })
  it('plans saves per language; unknown sections and languages are ignored, a too-long one refuses the save', () => {
    expect(planNavLabels({ en: { people: 'Teachers', media: 'Photos' }, it: { people: '' }, xx: { people: 'Nope' } })).toEqual({
      ok: true,
      set: [{ navId: 'people', locale: 'en', label: 'Teachers' }],
      clear: [{ navId: 'people', locale: 'it' }],
    })
    expect(planNavLabels({ en: { people: 'x'.repeat(40) } })).toEqual({ ok: false })
  })
  it('a language without labels falls back to the defaults', () => {
    expect(labelsFor({ en: { people: 'Teachers' } }, 'en')).toEqual({ people: 'Teachers' })
    expect(labelsFor({ en: { people: 'Teachers' } }, 'it')).toEqual({})
  })
})

describe('which languages the Labels page asks for', () => {
  it('the website languages the dashboard offers, plus the one in use', () => {
    expect(labelLocales(['en', 'fr'], 'en')).toEqual(['en']) // CYCE
    expect(labelLocales(['it', 'de'], 'it')).toEqual(['it', 'de']) // Hoffmann
    expect(labelLocales(['en', 'fr'], 'it')).toEqual(['en', 'it'])
    expect(labelLocales(['fr'], 'fr')).toEqual(['en'])
  })
})
