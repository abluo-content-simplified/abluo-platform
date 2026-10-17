import { describe, expect, it } from 'vitest'
import { internalTag, sameTagText, websiteLabel } from '../tag-text'

describe('internal tags (Media)', () => {
  it('are lower case and keep letters with accents, numbers, spaces and hyphens', () => {
    expect(internalTag('  Café   Rossi ')).toBe('café rossi')
    expect(internalTag('Sommer-Fest 2026')).toBe('sommer-fest 2026')
    expect(internalTag('Größe')).toBe('größe')
  })
  it('drop every other character', () => {
    expect(internalTag('Café & Bar!')).toBe('café bar')
    expect(internalTag('#team_photo.jpg')).toBe('team photo jpg')
    expect(internalTag('-- !! --')).toBe('')
  })
})

describe('website tags (Categories & tags)', () => {
  it('keep the client’s case', () => {
    expect(websiteLabel('iPhone tips')).toBe('iPhone tips')
    expect(websiteLabel('Vini rossi')).toBe('Vini rossi')
  })
  it('turn WORDS IN CAPITALS longer than 4 letters into Words, keeping short acronyms', () => {
    expect(websiteLabel('PIZZA NAPOLETANA DOP')).toBe('Pizza Napoletana DOP')
    expect(websiteLabel('BIO-GEMÜSE')).toBe('BIO-Gemüse')
    expect(websiteLabel('SPA & WELLNESS')).toBe('SPA & Wellness')
    expect(websiteLabel('  ÖKO   ')).toBe('ÖKO')
  })
  it('compare ignoring case', () => {
    expect(sameTagText('Vini Rossi', ' vini  rossi')).toBe(true)
    expect(sameTagText('Vini', 'Vino')).toBe(false)
  })
})
