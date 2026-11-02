/** Contract C3-9 — format model fixtures. */
import { describe, expect, it } from 'vitest'
import { EMPTY_CHANNELS } from '../channels'
import { addFormat, effectiveIsbn, formatIssues, formatsOf, isSimple, removeFormat } from '../formats'
import { fk, format, implicitFormat } from './fixtures'

const ctx: Parameters<typeof formatIssues>[1] = { channels: EMPTY_CHANNELS, defaultLocale: 'en', itemProfile: 'product', bookIsbn: null }
const codes = (fs: Parameters<typeof formatIssues>[0], c = ctx) => formatIssues(fs, c).map((i) => i.code)

describe('C3 formats', () => {
  it('C3-F1 no formats — one implicit format with no prices', () => {
    const [f, ...rest] = formatsOf({})
    expect(rest).toEqual([])
    expect(f).toMatchObject({ key: 'default', label: null, implicit: true, prices: [] })
  })
  it('C3-F2 legacy offers only — implicit format, one standard price keyed like the offer (C10-3 mapping)', () => {
    const fs = formatsOf({ offers: [{ _key: 'gmcfddpsji', price: 999 }] })
    expect(fs).toHaveLength(1)
    expect(fs[0]).toMatchObject({ key: 'default', label: null, implicit: true })
    expect(fs[0].prices).toEqual([{ key: 'gmcfddpsji', scope: null, amount: 999, note: null, windows: [] }])
  })
  it('C3-F3 two formats, second unlabelled → format.labelRequired on the second', () => {
    expect(formatIssues([format('a', { label: 'Glass' }), format('b', { label: null })], ctx)).toEqual([{ code: 'format.labelRequired', level: 'error', key: 'b' }])
  })
  it('C3-F4 addFormat from implicit — first gets the label and keeps key default; second appended', () => {
    const out = addFormat([implicitFormat()], { en: 'Glass 25 cl' }, { key: fk('b'), label: { en: 'Bottle' } })
    expect(out.map((f) => [f.key, f.label, f.implicit])).toEqual([
      ['default', { en: 'Glass 25 cl' }, false],
      ['b', { en: 'Bottle' }, false],
    ])
  })
  it('C3-F5 removeFormat to one — the remaining keeps its label, implicit false; isSimple false until cleared', () => {
    const two = addFormat([implicitFormat()], { en: 'Glass' }, { key: fk('b'), label: { en: 'Bottle' } })
    const one = removeFormat(two, fk('b'))
    expect(one).toHaveLength(1)
    expect(one[0]).toMatchObject({ key: 'default', label: { en: 'Glass' }, implicit: false })
    expect(isSimple(one)).toBe(false)
    expect(isSimple([{ ...one[0], label: null }])).toBe(true)
  })
  it('C3-F6 ISBN — single format uses the book ISBN; per-format ISBNs; a format without one is null', () => {
    const single = [implicitFormat()]
    expect(effectiveIsbn(single[0], single, '1529105102')).toBe('1529105102')
    const a = { ...format('a'), identifiers: { isbn: '9780306406157' } }
    const b = { ...format('b'), identifiers: { isbn: '1529105102' } }
    expect(effectiveIsbn(a, [a, b], '0000000000')).toBe('9780306406157')
    expect(effectiveIsbn(b, [a, b], null)).toBe('1529105102')
    const c = format('c')
    expect(effectiveIsbn(c, [a, c], '1529105102')).toBeNull()
  })
  it('C3-F7 GTIN — valid check digit ok, wrong one refused', () => {
    expect(codes([{ ...implicitFormat(), identifiers: { gtin: '4006381333931' } }])).toEqual([])
    expect(codes([{ ...implicitFormat(), identifiers: { gtin: '4006381333932' } }])).toEqual(['format.gtinInvalid'])
  })
  it('C3-F8 implicit override — a channelAvailability row on the implicit format is refused', () => {
    const [f] = formatsOf({ formats: [{ _key: 'default', _type: 'catalogueFormat', channelAvailability: [{ _key: 'delivery', channel: 'delivery', state: 'unavailable' }] }] })
    expect(f.implicit).toBe(true)
    expect(codes([f])).toEqual(['format.implicitOverride'])
  })
  it('other codes: duplicate key, SKU, ISBN conflict with the book, quantity', () => {
    expect(codes([format('a'), format('a')])).toContain('format.keyDuplicate')
    expect(codes([{ ...format('a'), identifiers: { sku: 'bad sku' } }])).toEqual(['format.skuInvalid'])
    expect(codes([{ ...format('a'), identifiers: { sku: 'X1' } }, { ...format('b'), identifiers: { sku: 'X1' } }])).toEqual(['format.skuDuplicateInItem'])
    expect(codes([{ ...implicitFormat(), identifiers: { isbn: '1529105102' } }], { ...ctx, itemProfile: 'book' as never, bookIsbn: '1529105102' as string | null })).toEqual(['format.isbnConflictsBook'])
    expect(codes([{ ...implicitFormat(), quantity: { value: 0, unit: 'cl' } }])).toEqual(['format.quantityInvalid'])
    expect(codes([{ ...implicitFormat(), quantity: { value: 25, unit: 'pint' as never } }])).toEqual(['format.unitUnknown'])
  })
})
