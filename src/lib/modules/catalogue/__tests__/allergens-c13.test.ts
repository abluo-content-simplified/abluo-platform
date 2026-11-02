// C13 §13.7 — tolerant allergen readers: the C13 evidence shape is accepted,
// the legacy shape is judged exactly as before.
import { describe, expect, it } from 'vitest'
import en from '../../../../../messages/en.json'
import it_ from '../../../../../messages/it.json'
import de from '../../../../../messages/de.json'
import { allergenDeclarationIssues, contentFingerprint, describeDeclarationIssue, isPublishableDeclaration, optionDeclarationIssues, unreviewedChoices, type AllergenDeclarationIssue } from '../allergens'

const D = { defaultLocale: 'it' }
const content = { status: 'containsListedAllergens', allergens: ['milk', 'gluten'], mayContain: [], note: { it: 'Con latte', en: 'With milk' } }
const review = (o: Record<string, unknown> = {}) => ({
  reviewedBy: '6f1c0b52-0000-4000-8000-000000000001',
  reviewedAt: '2026-11-02T10:00:00.000Z',
  basis: 'recipe',
  declarationVersion: 1,
  contentFingerprint: contentFingerprint(content, D),
  ...o,
})

describe('legacy shape — unchanged', () => {
  it('W-08 legacy-declaration: a reviewed status without review stays publishable', () => {
    expect(isPublishableDeclaration({ status: 'noneDeclared', confirmed: true })).toBe(true)
    expect(isPublishableDeclaration({ status: 'containsListedAllergens', allergens: ['milk'] })).toBe(true)
    expect(allergenDeclarationIssues({ status: 'containsListedAllergens', allergens: ['milk'] }, D)).toEqual([])
  })

  it('unknown keys are still refused', () => {
    expect(allergenDeclarationIssues({ status: 'noneDeclared', confirmed: true, glutenFree: true })).toEqual(['unexpectedField'])
  })
})

describe('C13 shape — accepted', () => {
  it('review, invalidation and declarationVersion are known keys', () => {
    expect(allergenDeclarationIssues({ ...content, review: review() }, D)).toEqual([])
    expect(allergenDeclarationIssues({ status: 'notReviewed', invalidation: { cause: 'profileChangedToFood', at: '2026-11-02T10:00:00Z' } })).toEqual(['notReviewed'])
    expect(allergenDeclarationIssues({ ...content, declarationVersion: 3 })).toEqual([])
    expect(isPublishableDeclaration({ ...content, review: review() })).toBe(true)
  })

  it('on option choices too (no note)', () => {
    const choice = { status: 'noneDeclared', confirmed: true }
    expect(optionDeclarationIssues({ ...choice, review: review({ contentFingerprint: contentFingerprint(choice, D) }) }, D)).toEqual([])
    expect(unreviewedChoices([{ _key: 'a', kind: 'add', allergenDeclaration: { ...choice, review: review({ contentFingerprint: contentFingerprint(choice, D) }) } }])).toEqual([])
  })

  it('a malformed review is reviewShape (gate: integrity.declarationShape) and not publishable', () => {
    for (const bad of [review({ reviewedBy: '' }), review({ reviewedAt: 'yesterday' }), review({ basis: 'gut' }), review({ declarationVersion: 0 }), review({ basisNote: 'x' }), review({ extra: 1 }), 'yes', review({ linked: [{ choiceKey: 'c' }] })]) {
      expect(allergenDeclarationIssues({ ...content, review: bad }, D), JSON.stringify(bad)).toContain('reviewShape')
    }
    expect(allergenDeclarationIssues({ ...content, declarationVersion: -1 })).toEqual(['reviewShape'])
    expect(allergenDeclarationIssues({ ...content, review: review({ basis: 'other', basisNote: 'kitchen sheet' }) }, D)).toEqual([])
  })

  it('W-02 "may contain" needs the risk-assessment confirmation', () => {
    const may = { ...content, mayContain: ['fish'] }
    const fp = contentFingerprint(may, D)
    expect(allergenDeclarationIssues({ ...may, review: review({ contentFingerprint: fp }) }, D)).toEqual(['mayContainNotAssessed'])
    const confirmed = review({ contentFingerprint: fp, mayContainRiskAssessment: { confirmed: true, confirmedBy: 'u1', confirmedAt: '2026-11-02T10:00:00Z' } })
    expect(allergenDeclarationIssues({ ...may, review: confirmed }, D)).toEqual([])
  })

  it('W-09/W-13 an edit outside the review is detected by the fingerprint (with the site default locale)', () => {
    const edited = { ...content, allergens: ['milk'], review: review() }
    expect(allergenDeclarationIssues(edited, D)).toEqual(['editedOutsideReview'])
    expect(isPublishableDeclaration(edited)).toBe(true) // no locale: the caller cannot judge the note, so the check is skipped
  })

  it('the fingerprint ignores order, duplicates and non-default note locales (translation-only edits never reset)', () => {
    const a = contentFingerprint(content, D)
    expect(contentFingerprint({ ...content, allergens: ['gluten', 'milk', 'milk'] }, D)).toBe(a)
    expect(contentFingerprint({ ...content, note: { it: 'Con latte', en: 'Contains milk', de: 'Mit Milch' } }, D)).toBe(a)
    expect(contentFingerprint({ ...content, note: { it: 'Con latte intero' } }, D)).not.toBe(a)
    expect(contentFingerprint({ ...content, status: 'noneDeclared' }, D)).not.toBe(a)
    expect(a).toMatch(/^fp1-[0-9a-f]{16}$/)
  })
})

describe('messages for the new issue kinds', () => {
  const kinds: AllergenDeclarationIssue[] = ['reviewShape', 'mayContainNotAssessed', 'editedOutsideReview']
  it.each([['en', en], ['it', it_], ['de', de]] as const)('%s has dashboard text for each', (_l, m) => {
    const issues = (m as { catalogue: { dashboard: { item: { issues: { allergens: Record<string, string> } } } } }).catalogue.dashboard.item.issues.allergens
    for (const k of kinds) expect(issues[k]?.trim(), k).toBeTruthy()
  })
  it('Studio text exists for each', () => {
    for (const k of kinds) expect(describeDeclarationIssue(k)).toMatch(/\w/)
  })
})
