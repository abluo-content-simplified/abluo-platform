/**
 * R1 reader switch (C5-5 caller table) and schema registration (C10-6 R1 row).
 * GROQ readers are evaluated with groq-js against both stored shapes.
 */
import { describe, expect, it } from 'vitest'
import { evaluate as groq, parse } from 'groq-js'
import { CATALOGUE_DASHBOARD_LIST_QUERY, CATALOGUE_GLANCE_QUERY, CATALOGUE_REF_TARGETS_QUERY } from '../../dashboard-queries'
import { CURRENCY_ITEM_PRICES_QUERY, currencyImpact } from '../../validation'
import { itemStateFromDoc, offerFormsFromDoc } from '../../dashboard-form'
import { catalogueSchemaTypes, catalogueItem } from '../../schema'
import { CATALOGUE_COMMERCE_SCHEMA_TYPE_NAMES } from '../../schema-commerce'
import { evaluate, ruleIssues, rulesOverlap, type AvailabilityState } from '../../availability'
import { evaluateWindows, windowIssues, windowsOverlap } from '../windows'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import { buildModuleConfigSchemaTypes } from '@/lib/modules/config-schema'
import { validateRegistry } from '@/lib/modules/validate'

const LEGACY = { _id: 'legacy', _type: 'catalogueItem', projectSlug: 'p', offers: [{ _key: 'o1', price: 8 }, { _key: 'o2', price: 12 }] }
const V2 = { _id: 'v2', _type: 'catalogueItem', projectSlug: 'p', formats: [{ _key: 'a', prices: [{ _key: 'p1', amount: 5 }] }, { _key: 'b', prices: [{ _key: 'p2', amount: 7 }, { _key: 'p3', amount: 9 }] }] }
const EMPTY = { _id: 'empty', _type: 'catalogueItem', projectSlug: 'p' }
/** An empty `formats: []` beside legacy offers never hides them (same rule as commerceOf). */
const EMPTY_FORMATS = { _id: 'ef', _type: 'catalogueItem', projectSlug: 'p', formats: [], offers: [{ _key: 'o', price: 3 }] }
const OTHER = { _id: 'other', _type: 'catalogueItem', projectSlug: 'q', offers: [{ _key: 'x', price: 1 }] }
const DATASET = [LEGACY, V2, EMPTY, EMPTY_FORMATS, OTHER]
const run = async <T>(query: string, params: Record<string, unknown>) => (await (await groq(parse(query, { params }), { dataset: DATASET, params })).get()) as T

describe('GROQ readers accept both shapes', () => {
  it('CURRENCY_ITEM_PRICES_QUERY (D7 warning, config-validators): formats amounts, else legacy offers', async () => {
    const rows = await run<{ _id: string; prices: number[] | null }[]>(CURRENCY_ITEM_PRICES_QUERY, { projectSlug: 'p' })
    const by = Object.fromEntries(rows.map((r) => [r._id, r.prices]))
    expect(by.legacy).toEqual([8, 12])
    expect(by.v2).toEqual([5, 7, 9])
    expect(by.ef).toEqual([3])
    expect(currencyImpact(rows)).toMatchObject({ prices: 6, items: 3 })
  })
  it('dashboard list: offerCount + prices from formats, else offers', async () => {
    const r = await run<{ items: { _id: string; offerCount: number; prices: number[] | null }[] }>(CATALOGUE_DASHBOARD_LIST_QUERY, { projectSlug: 'p' })
    const by = Object.fromEntries(r.items.map((i) => [i._id, i]))
    expect([by.legacy.offerCount, by.legacy.prices]).toEqual([2, [8, 12]])
    expect([by.v2.offerCount, by.v2.prices]).toEqual([3, [5, 7, 9]])
    expect(by.empty.offerCount).toBe(0)
    expect([by.ef.offerCount, by.ef.prices]).toEqual([1, [3]])
  })
  it('option-item picker result is `hasPrice` (D-21), true for a priced item in either shape', async () => {
    const rows = await run<{ _id: string; hasPrice: boolean; offered?: unknown }[]>(CATALOGUE_REF_TARGETS_QUERY, { type: 'catalogueItem', projectSlug: 'p', ids: ['legacy', 'v2', 'empty', 'ef'], draftIds: [] })
    expect(Object.fromEntries(rows.map((r) => [r._id, r.hasPrice]))).toEqual({ legacy: true, v2: true, empty: false, ef: true })
    expect(rows.every((r) => !('offered' in r))).toBe(true)
  })
  it('home glance noPrice counts items with no price in either shape', async () => {
    const r = await run<{ noPrice: number }>(CATALOGUE_GLANCE_QUERY, { projectSlug: 'p' })
    expect(r.noPrice).toBe(1)
  })
})

describe('editor state reader', () => {
  it('legacy offers read exactly as before', () => {
    const offers = [{ _key: 'a', channel: 'dine-in', price: 9.5, availability: [{ _key: 'w', days: ['mon'], from: '18:00', to: '02:00' }] }]
    expect(itemStateFromDoc({ offers }).offers).toEqual(offerFormsFromDoc(offers))
  })
  it('a document with formats shows its prices (flattened), never an empty price form', () => {
    expect(itemStateFromDoc({ formats: [{ _key: 'default', prices: [{ _key: 'p', amount: 4, channel: 'takeaway', windows: [{ days: ['fri'], from: '12:00', to: '15:00' }] }] }] }).offers).toEqual([
      { key: 'p', channel: 'takeaway', price: '4.00', availability: [{ key: 'p-w0', days: ['fri'], from: '12:00', to: '15:00' }] },
    ])
  })
})

describe('window vocabulary rename (C2-C5-C10 §0) — deprecated aliases keep their old values', () => {
  it('evaluate ↔ evaluateWindows', () => {
    const rules = [{ days: ['mon'], from: '12:00', to: '15:00' }]
    const t = new Date('2026-11-02T12:00:00Z')
    const map: Record<string, AvailabilityState> = { inWindow: 'available', outsideWindow: 'outOfHours' }
    expect(evaluate(rules, t, 'Europe/Rome')).toBe(map[evaluateWindows(rules, t, 'Europe/Rome')])
    expect(evaluate([], t, 'Europe/Rome')).toBe('available')
    expect(rulesOverlap).toBe(windowsOverlap)
    expect(ruleIssues).toBe(windowIssues)
  })
})

describe('schema registration (R1: declared, hidden, written by no one)', () => {
  it('the commerce object types are registered and listed in the manifest', () => {
    const names = catalogueSchemaTypes.map((t) => t.name)
    const manifest = MODULE_REGISTRY.find((m) => m.id === 'catalogue')!
    for (const n of CATALOGUE_COMMERCE_SCHEMA_TYPE_NAMES) {
      expect(names).toContain(n)
      expect(manifest.platformContract.schemaTypes).toContain(n)
    }
  })
  it('item fields formats + channelAvailability are hidden and read-only', () => {
    const fields = (catalogueItem as unknown as { fields: { name: string; hidden?: unknown; readOnly?: unknown }[] }).fields
    for (const name of ['formats', 'channelAvailability']) {
      const f = fields.find((x) => x.name === name)!
      expect(f).toBeDefined()
      expect(f.hidden).toBe(true)
      expect(f.readOnly).toBe(true)
    }
    expect(fields.find((x) => x.name === 'offers')).toBeDefined() // legacy stays until R3
  })
  it('module config: channel attributes, formatTemplates and catalogueMigrations are generated; the registry validates', () => {
    expect(() => validateRegistry(MODULE_REGISTRY)).not.toThrow()
    const cfg = buildModuleConfigSchemaTypes().find((t) => t.name === 'catalogueModuleConfig') as unknown as { fields: { name: string; type: string; hidden?: boolean; of?: { type: string; fields?: { name: string }[] }[] }[] }
    const channels = cfg.fields.find((f) => f.name === 'serviceChannels')!
    expect(channels.of![0].fields!.map((f) => f.name)).toEqual(expect.arrayContaining(['value', 'label', 'active', 'defaultAvailability', 'defaultSchedule']))
    const templates = cfg.fields.find((f) => f.name === 'formatTemplates')!
    expect(templates).toMatchObject({ type: 'array', hidden: true })
    expect(templates.of![0].type).toBe('catalogueFormatTemplate')
    expect(cfg.fields.find((f) => f.name === 'catalogueMigrations')).toMatchObject({ type: 'catalogueMigrationMarkers', hidden: true })
  })
})
