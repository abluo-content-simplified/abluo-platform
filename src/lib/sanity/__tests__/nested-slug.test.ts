import { describe, it, expect } from 'vitest'
import {
  slugifyNestedPath,
  validateNestedSlug,
  joinSlugSegments,
} from '@/lib/sanity/fields/nested-slug'

// D1 — nested routing. The point of these tests is the FAILURE MODE they lock
// out: Sanity's default slugifier deletes "/", so a nested slug retyped in the
// Studio would silently collapse to one segment and 404 a live page.

describe('slugifyNestedPath', () => {
  it('keeps the separator between segments — the whole reason this exists', () => {
    expect(slugifyNestedPath('Servizi/Terapia Individuale')).toBe('servizi/terapia-individuale')
  })

  it('still slugifies a single segment exactly as before', () => {
    expect(slugifyNestedPath('Chi Sono')).toBe('chi-sono')
  })

  it('strips accents per segment (Italian and German copy both need this)', () => {
    expect(slugifyNestedPath('Servizi/Percorsi di Crescita Personale'))
      .toBe('servizi/percorsi-di-crescita-personale')
    expect(slugifyNestedPath('Dienstleistungen/Einzeltherapie für Berufstätige'))
      .toBe('dienstleistungen/einzeltherapie-fur-berufstatige')
  })

  it('drops empty segments rather than emitting "//" or a leading "/"', () => {
    expect(slugifyNestedPath('/servizi//terapia-individuale/')).toBe('servizi/terapia-individuale')
  })

  it('collapses punctuation inside a segment without eating the separator', () => {
    expect(slugifyNestedPath("Servizi/Italiani all'estero")).toBe('servizi/italiani-all-estero')
  })

  it('respects maxLength', () => {
    expect(slugifyNestedPath('a'.repeat(200)).length).toBe(96)
  })
})

describe('validateNestedSlug', () => {
  it.each([
    'home',
    'chi-sono',
    'servizi/terapia-individuale',
    'a/b/c',
    'dienstleistungen/einzeltherapie',
  ])('accepts %s', (slug) => {
    expect(validateNestedSlug(slug)).toBe(true)
  })

  it.each(['/servizi', 'servizi/', 'servizi//terapia', 'Servizi/Terapia', 'servizi/terapia_individuale', 'servizi terapia'])(
    'rejects %s',
    (slug) => {
      expect(validateNestedSlug(slug)).not.toBe(true)
    }
  )

  it('treats an absent slug as valid — required-ness is a separate rule', () => {
    expect(validateNestedSlug(undefined)).toBe(true)
    expect(validateNestedSlug('')).toBe(true)
  })
})

describe('joinSlugSegments', () => {
  it('rebuilds the stored slug from the catch-all segments', () => {
    expect(joinSlugSegments(['servizi', 'terapia-individuale'])).toBe('servizi/terapia-individuale')
  })

  it('is an identity for the one-segment case — every existing page still resolves', () => {
    expect(joinSlugSegments(['chi-sono'])).toBe('chi-sono')
  })

  it('decodes percent-encoded segments', () => {
    expect(joinSlugSegments(['servizi', 'italiani-all%27estero'])).toBe("servizi/italiani-all'estero")
  })

  it('round-trips whatever slugifyNestedPath produced', () => {
    const stored = slugifyNestedPath('Servizi/Sostegno alla Coppia')
    expect(joinSlugSegments(stored.split('/'))).toBe(stored)
  })
})
