import { describe, expect, it } from 'vitest'
import { MODULE_REGISTRY } from '../registry'
import { applyPreset, presetDeclarationErrors, presetValues, previewPreset } from '../presets'
import { presetValidatorErrors } from '../config-validators'

const catalogue = MODULE_REGISTRY.find((m) => m.id === 'catalogue')!
const schema = catalogue.platformContract.configSchema
const presets = catalogue.platformContract.starterPresets!
const restaurant = presets.find((p) => p.id === 'restaurant')!
const bookshop = presets.find((p) => p.id === 'bookshop')!
const NOW = () => '2026-10-14T10:00:00.000Z'

describe('catalogue manifest (ADR-033 D-1)', () => {
  it('declares exactly Restaurant and Bookshop, valid against configSchema', () => {
    expect(presets.map((p) => p.id)).toEqual(['restaurant', 'bookshop'])
    for (const p of presets) expect(presetDeclarationErrors(p, schema)).toEqual([])
  })
  it('a generic installation creates no channels: no installSeed anywhere', () => {
    expect(JSON.stringify(schema)).not.toContain('installSeed')
  })
  it('exposes defaultItemProfile as an optional select with no default', () => {
    const f = schema.find((x) => x.id === 'defaultItemProfile')!
    expect(f.type).toBe('select')
    expect(f.required).toBeFalsy()
    expect(f.initialValue).toBeUndefined()
    expect(f.options!.map((o) => o.value)).toEqual(['foodOrDrink', 'product', 'service'])
  })
  it('no preset carries a currency', () => {
    for (const p of presets) expect(Object.keys(p.config)).not.toContain('currency')
  })
  it('matches the ADR table', () => {
    expect(restaurant.config.publicSegment).toBe('menu')
    expect(restaurant.config.defaultItemProfile).toBe('foodOrDrink')
    // D12 update 2026-10-16: the dashboard label defaults to "Catalogue"; presets never write it.
    for (const p of presets) expect(p.config).not.toHaveProperty('navLabel')
    expect((restaurant.config.serviceChannels as { value: string }[]).map((c) => c.value)).toEqual(['dine-in', 'takeaway'])
    expect(bookshop.config.publicSegment).toBe('books')
    expect(bookshop.config.serviceChannels).toBeUndefined()
    expect(bookshop.config.defaultItemProfile).toBe('product')
  })
})

describe('presetValues — locale filtering', () => {
  it('restricts localized labels to the site locales', () => {
    const v = presetValues(restaurant, schema, ['en', 'it']) as Record<string, any>
    expect(v.serviceChannels[0]).toEqual({ _key: 'preset-dine-in', value: 'dine-in', label: { en: 'Dine-in', it: 'Al tavolo' } })
    expect(v.serviceChannels[1].label).toEqual({ en: 'Takeaway', it: 'Da asporto' })
  })
  it('keeps all labels when locales are unknown', () => {
    const v = presetValues(restaurant, schema, []) as Record<string, any>
    expect(v.serviceChannels[0].label.de).toBe('Vor Ort')
  })
})

describe('previewPreset', () => {
  it('lists exactly what will be written, with no currency row', () => {
    const rows = previewPreset(restaurant, schema, {}, ['en', 'it'])
    expect(rows.map((r) => r.fieldId)).toEqual(['publicSegment', 'serviceChannels', 'defaultItemProfile'])
    expect(rows.find((r) => r.fieldId === 'publicSegment')).toMatchObject({ to: 'menu', from: null })
    expect(rows.find((r) => r.fieldId === 'defaultItemProfile')!.to).toBe('Food or drink')
  })
  it('shows what an existing value would be replaced by', () => {
    const rows = previewPreset(bookshop, schema, { publicSegment: 'shop' }, ['en'])
    expect(rows.find((r) => r.fieldId === 'publicSegment')).toMatchObject({ to: 'books', from: 'shop' })
  })
})

describe('applyPreset', () => {
  it('writes the preset over the form values, keeps the rest, records id+version+appliedAt', () => {
    const r = applyPreset(restaurant, schema, { currency: 'CHF', categories: [] }, ['en'], undefined, NOW)
    expect(r.applied).toBe(true)
    expect(r.values.currency).toBe('CHF')
    expect(r.values.publicSegment).toBe('menu')
    expect(r.appliedPreset).toEqual({ id: 'restaurant', version: 2, appliedAt: NOW() })
  })
  it('is idempotent: re-applying the same id+version changes nothing', () => {
    const first = applyPreset(restaurant, schema, {}, ['en'], undefined, NOW)
    const again = applyPreset(restaurant, schema, { publicSegment: 'carta' }, ['en'], first.appliedPreset, NOW)
    expect(again.applied).toBe(false)
    expect(again.values).toEqual({ publicSegment: 'carta' })
    expect(again.appliedPreset).toBe(first.appliedPreset)
  })
  it('is never re-applied for any other preset or a newer version', () => {
    const existing = { id: 'restaurant', version: 1, appliedAt: NOW() }
    expect(applyPreset(bookshop, schema, {}, ['en'], existing).applied).toBe(false)
    expect(applyPreset({ ...restaurant, version: 2 }, schema, {}, ['en'], existing).applied).toBe(false)
  })
  it('records the version of the preset applied', () => {
    expect(applyPreset({ ...bookshop, version: 3 }, schema, {}, ['en'], undefined, NOW).appliedPreset!.version).toBe(3)
  })
})

describe('presetValidatorErrors — segment clash blocks applying', () => {
  const noData = { pageSlugs: [] }
  it('passes when the segment is free', () => {
    expect(presetValidatorErrors(restaurant, schema, {}, undefined, noData, ['en'])).toEqual([])
  })
  it('blocks on a page that already starts with the segment, with the clash message', () => {
    const data = { pageSlugs: [{ slug: { en: { current: 'menu/lunch' } } }] }
    const errs = presetValidatorErrors(restaurant, schema, {}, undefined, data, ['en'])
    expect(errs).toHaveLength(1)
    expect(errs[0].fieldId).toBe('publicSegment')
    expect(errs[0].error).toContain('"menu" is already the start of one of your pages')
  })
  it('only the clashing preset is blocked', () => {
    const data = { pageSlugs: [{ slug: 'menu' }] }
    expect(presetValidatorErrors(bookshop, schema, {}, undefined, data, ['en'])).toEqual([])
  })
})
