import { describe, expect, it } from 'vitest'
import { AMAZON_MARKETPLACES } from '@/lib/affiliate/amazon-marketplaces'
import {
  addRow,
  canAddRow,
  duplicateMarketplaces,
  isIncomplete,
  marketplaceOptions,
  pendingSuggestions,
  removeRow,
  rowsFromStored,
  toStored,
  trackingIdLooksOff,
  updateRow,
} from '../amazon-rows'

describe('suggestions', () => {
  it('suggests the stores of the site languages that have no row yet', () => {
    const rows = rowsFromStored([{ marketplace: 'amazon.it', trackingId: 'tmz-21' }])
    expect(pendingSuggestions(['it', 'de', 'en'], rows)).toEqual(['amazon.de'])
    expect(pendingSuggestions(['it', 'de'], [])).toEqual(['amazon.it', 'amazon.de'])
    expect(pendingSuggestions(['en'], [])).toEqual([])
  })
  it('a quick-add creates a row for that store with an empty ID', () => {
    expect(addRow([], 'amazon.de')).toEqual([{ key: 'amz-amazon-de', marketplace: 'amazon.de', trackingId: '' }])
  })
})

describe('rows', () => {
  it('shows only known marketplaces, once each, with cleaned IDs', () => {
    const rows = rowsFromStored([
      { marketplace: 'amazon.it', trackingId: ' tmz-21 ' },
      { marketplace: 'amazon.it', trackingId: 'dup-21' },
      { marketplace: 'amazon.xx' as never, trackingId: 'x' },
    ])
    expect(rows).toEqual([{ key: 'amz-amazon-it', marketplace: 'amazon.it', trackingId: 'tmz-21' }])
  })
  it('the picker offers a row its own store plus every store no other row uses', () => {
    const rows = [
      { key: 'a', marketplace: 'amazon.it' as const, trackingId: '' },
      { key: 'b', marketplace: 'amazon.de' as const, trackingId: '' },
    ]
    const ids = marketplaceOptions(rows, 'amazon.it').map((o) => o.id)
    expect(ids).toContain('amazon.it')
    expect(ids).not.toContain('amazon.de')
    expect(ids).toContain('amazon.fr')
  })
  it('add, update, remove; blank rows get unique keys; no add once every store is used', () => {
    let rows = addRow([], '')
    rows = addRow(rows, '')
    expect(new Set(rows.map((r) => r.key)).size).toBe(2)
    rows = updateRow(rows, rows[0].key, { marketplace: 'amazon.fr', trackingId: 'a-21' })
    expect(rows[0]).toMatchObject({ marketplace: 'amazon.fr', trackingId: 'a-21' })
    expect(removeRow(rows, rows[1].key)).toHaveLength(1)
    const all = AMAZON_MARKETPLACES.map((m) => ({ key: m.id, marketplace: m.id, trackingId: 'x-21' }))
    expect(canAddRow(all)).toBe(false)
    expect(addRow(all, '')).toHaveLength(all.length)
  })
  it('adding a store that already has a row is a no-op', () => {
    const rows = addRow([], 'amazon.it')
    expect(addRow(rows, 'amazon.it')).toHaveLength(1)
  })
  it('finds duplicates and half-filled rows', () => {
    const rows = [
      { key: 'a', marketplace: 'amazon.it' as const, trackingId: 'x-21' },
      { key: 'b', marketplace: 'amazon.it' as const, trackingId: '' },
    ]
    expect(duplicateMarketplaces(rows)).toEqual(['amazon.it'])
    expect(isIncomplete(rows[1])).toBe(true)
    expect(isIncomplete(rows[0])).toBe(false)
  })
})

describe('format hint (soft)', () => {
  it('hints on a odd-looking ID, never on an empty one or a normal one', () => {
    expect(trackingIdLooksOff('tmz01-21')).toBe(false)
    expect(trackingIdLooksOff('')).toBe(false)
    expect(trackingIdLooksOff('has space')).toBe(true)
  })
})

describe('toStored', () => {
  it('trims, keys by store, drops half-filled rows', () => {
    const r = toStored([
      { marketplace: 'amazon.it', trackingId: '  tmz-21 ' },
      { marketplace: 'amazon.de', trackingId: '' },
      { marketplace: '', trackingId: '' },
    ])
    expect(r).toEqual({ ok: true, value: [{ _type: 'amazonTrackingId', _key: 'amz-amazon-it', marketplace: 'amazon.it', trackingId: 'tmz-21' }] })
  })
  it('refuses a store not on the list, and the same store twice', () => {
    expect(toStored([{ marketplace: 'amazon.zz', trackingId: 'a-21' }])).toEqual({ ok: false, error: 'invalid_marketplace' })
    expect(
      toStored([
        { marketplace: 'amazon.it', trackingId: 'a-21' },
        { marketplace: 'amazon.it', trackingId: 'b-21' },
      ]),
    ).toEqual({ ok: false, error: 'duplicate_marketplace' })
  })
  it('never refuses on format', () => {
    expect(toStored([{ marketplace: 'amazon.it', trackingId: 'weird id!' }]).ok).toBe(true)
  })
  it('refuses non-lists and over-long IDs', () => {
    expect(toStored('x' as never)).toEqual({ ok: false, error: 'invalid_value' })
    expect(toStored([{ marketplace: 'amazon.it', trackingId: 'a'.repeat(65) }])).toEqual({ ok: false, error: 'invalid_value' })
  })
  it('strips control characters', () => {
    const r = toStored([{ marketplace: 'amazon.it', trackingId: 'a\u0000b-21\n' }])
    expect(r.ok && r.value[0].trackingId).toBe('ab-21')
  })
})
