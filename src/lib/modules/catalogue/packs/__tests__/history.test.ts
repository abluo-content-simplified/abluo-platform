// Contract C7.6 / C7.9 / C10-6 R1 — the pack history reader (legacy appliedPreset
// read virtually as <id>@<version>) and the setup-completion reader (D-14).

import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { highestAppliedVersion, legacyPresetRecord, PACK_HISTORY_QUERY, packHistoryId, readPackHistory } from '../history'
import { isSetupComplete, readSetupState } from '../setup-state'
import { MODULE_REGISTRY } from '@/lib/modules/registry'

const TMZ_PRESET = { id: 'bookshop', version: 1, appliedAt: '2026-10-14T09:00:00Z' }

describe('pack history reader', () => {
  it('guard/legacy-preset (reader): appliedPreset{bookshop,1} reads as bookshop@1 with its settings added', () => {
    expect(readPackHistory({ applied: null, appliedPreset: TMZ_PRESET })).toEqual([
      {
        _key: 'bookshop@1',
        id: 'bookshop',
        version: 1,
        appliedAt: '2026-10-14T09:00:00Z',
        appliedBy: 'migration',
        added: { categories: [], tags: [], collections: [], sections: [], optionGroups: [], channels: [], formats: [], settings: ['publicSegment', 'defaultItemProfile'] },
        mapped: {},
        skipped: [],
        source: 'legacyPreset',
      },
    ])
    expect(highestAppliedVersion(readPackHistory({ appliedPreset: TMZ_PRESET }), 'bookshop')).toBe(1) // so Setup can offer bookshop@3 as an update
  })
  it('after D3 the stored entry replaces the virtual one (same key, never twice)', () => {
    const stored = { id: 'bookshop', version: 1, appliedAt: '2026-10-14T09:00:00Z', appliedBy: 'migration', added: { settings: ['publicSegment', 'defaultItemProfile'] }, mapped: [], skipped: [] }
    const h = readPackHistory({ applied: [stored], appliedPreset: TMZ_PRESET })
    expect(h.map((e) => [e._key, e.source])).toEqual([['bookshop@1', 'history']])
  })
  it('stored entries: tolerant, first per key, oldest first; mapped rows become a record', () => {
    const h = readPackHistory({
      applied: [
        { id: 'pizzeria', version: 3, appliedAt: '2026-11-05T10:00:00Z', appliedBy: 'u1', mapped: [{ from: 'category:desserts', to: 'dolci' }, { from: '', to: 'x' }] },
        { id: 'empty', version: 3, appliedAt: '2026-11-01T10:00:00Z', appliedBy: 'u1' },
        { id: 'pizzeria', version: 3, appliedAt: 'dup' },
        { id: 'Bad Id', version: 1 },
        { id: 'wine-bar', version: 0 },
        null,
      ],
    })
    expect(h.map((e) => e._key)).toEqual(['empty@3', 'pizzeria@3'])
    expect(h[1].mapped).toEqual({ 'category:desserts': 'dolci' })
    expect(h[0].added.categories).toEqual([])
  })
  it('no record at all → empty history; malformed legacy records are ignored', () => {
    expect(readPackHistory(null)).toEqual([])
    expect(readPackHistory({ appliedPreset: { id: 'bookshop' } })).toEqual([])
    expect(legacyPresetRecord('bookshop')).toBeNull()
  })
  it('the query reads both sources for one project only', async () => {
    const dataset = [
      { _id: 'proj-tmz', _type: 'project', projectSlug: 'tmz', moduleInstallations: [{ moduleId: 'catalogue', appliedPreset: TMZ_PRESET }] },
      { _id: 'catalogue-packs.other', _type: 'cataloguePackHistory', projectSlug: 'other', applied: [{ id: 'empty', version: 3 }] },
    ]
    const r = (await (await evaluate(parse(PACK_HISTORY_QUERY), { dataset, params: { projectSlug: 'tmz' } })).get()) as { applied: unknown; appliedPreset: unknown }
    expect(r.applied).toBeNull()
    expect(readPackHistory(r).map((e) => e._key)).toEqual(['bookshop@1'])
    expect(packHistoryId('tmz')).toBe('catalogue-packs.tmz')
    expect(() => packHistoryId('../x')).toThrow()
  })
})

describe('setup state (D-14)', () => {
  it('isSetupComplete reads setupCompletedAt only', () => {
    expect(isSetupComplete({ setupCompletedAt: '2026-10-14T09:00:00Z' })).toBe(true)
    expect(isSetupComplete({ setupCompletedAt: '2026-10-14T09:00:00Z', setupSource: 'nonsense' })).toBe(true)
    expect(isSetupComplete({ setupSource: 'pack' })).toBe(false)
    expect(isSetupComplete({ setupCompletedAt: 'not a date' })).toBe(false)
    expect(isSetupComplete(null)).toBe(false)
  })
  it('R1: tmz has no setupCompletedAt yet (D3 sets it), so it reads as not complete — no runtime consumer exists in R1', () => {
    expect(isSetupComplete({ publicSegment: 'books', appliedPreset: TMZ_PRESET } as never)).toBe(false)
  })
  it('both fields are module-written config fields, hidden in every editor', () => {
    const fields = MODULE_REGISTRY.find((m) => m.id === 'catalogue')!.platformContract.configSchema
    expect(fields.find((f) => f.id === 'setupCompletedAt')).toMatchObject({ hidden: true, type: 'string' })
    expect(fields.find((f) => f.id === 'setupSource')).toMatchObject({ hidden: true, type: 'select' })
  })
  it('readSetupState (Setup only) returns the source when completion is set', () => {
    expect(readSetupState({ setupCompletedAt: '2026-10-14T09:00:00Z', setupSource: 'pack' })).toEqual({ completedAt: '2026-10-14T09:00:00Z', source: 'pack' })
    expect(readSetupState({ setupSource: 'pack' })).toEqual({ completedAt: null, source: null })
  })
})

// R2 review fix: setup completion before data step D3 (tmz).
describe('setup completion before data step D3', () => {
  const LEGACY = { id: 'bookshop', version: 1, appliedAt: '2026-10-14T09:00:00Z' }

  it('a valid legacy preset record is complete, source pack; an invalid one is not', () => {
    expect(isSetupComplete({}, LEGACY)).toBe(true)
    expect(readSetupState({}, LEGACY)).toEqual({ completedAt: '2026-10-14T09:00:00Z', source: 'pack' })
    expect(isSetupComplete({}, { id: 'nope!', version: 1 })).toBe(false)
    expect(isSetupComplete({}, null)).toBe(false)
  })

  it('a stored completion wins over the legacy record', () => {
    expect(readSetupState({ setupCompletedAt: '2026-11-01T10:00:00Z', setupSource: 'manual' }, LEGACY)).toEqual({ completedAt: '2026-11-01T10:00:00Z', source: 'manual' })
  })

  it('a legacy record without a date still counts as complete', () => {
    expect(readSetupState({}, { id: 'bookshop', version: 1 }).completedAt).not.toBeNull()
  })
})
