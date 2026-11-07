import { describe, expect, it } from 'vitest'
import { createSettingsStore } from '../settings-store'
import { fakeDb, opsOf } from './fake-db'

const P = '11111111-1111-4111-8111-111111111111'
const ROW = { project_id: P, rules: { holdDays: 3 }, bank_details: { en: 'IBAN' }, payment_instructions: null, reference_prefix: 'CYCE', version: 4 }
const write = { rules: { holdDays: 6 }, bankDetails: null, paymentInstructions: null, referencePrefix: 'AB' }

describe('settings store', () => {
  it('reads one project’s row, filtered by project_id', async () => {
    const { db, calls } = fakeDb({ data: [ROW] })
    const r = await createSettingsStore(db).get(P)
    expect(r).toEqual({ ok: true, value: { projectId: P, rules: { holdDays: 3 }, bankDetails: { en: 'IBAN' }, paymentInstructions: null, referencePrefix: 'CYCE', version: 4 } })
    expect(opsOf(calls[0], 'eq')).toEqual([['project_id', P]])
  })
  it('no row = null (defaults apply)', async () => {
    expect(await createSettingsStore(fakeDb({ data: [] }).db).get(P)).toEqual({ ok: true, value: null })
  })
  it('a missing table (066 not applied) is unavailable', async () => {
    const r = await createSettingsStore(fakeDb({ error: { code: '42P01', message: 'relation does not exist' } }).db).get(P)
    expect(r).toEqual({ ok: false, error: { kind: 'unavailable' } })
  })
  it('updates on the loaded version and bumps it, scoped to the project', async () => {
    const { db, calls } = fakeDb({ data: [{ ...ROW, version: 5 }] })
    const r = await createSettingsStore(db).save(P, 4, write)
    expect(r.ok && r.value.version).toBe(5)
    expect(opsOf(calls[0], 'eq')).toEqual([['project_id', P], ['version', 4]])
    expect(opsOf(calls[0], 'update')[0][0]).toMatchObject({ version: 5, rules: { holdDays: 6 }, reference_prefix: 'AB' })
  })
  it('zero rows updated = conflict', async () => {
    expect(await createSettingsStore(fakeDb({ data: [] }).db).save(P, 4, write)).toEqual({ ok: false, error: { kind: 'conflict', code: 'changed' } })
  })
  it('the first save inserts version 1 for this project; a lost race is a conflict', async () => {
    const { db, calls } = fakeDb({ data: [{ ...ROW, version: 1 }] })
    expect((await createSettingsStore(db).save(P, 0, write)).ok).toBe(true)
    expect(opsOf(calls[0], 'insert')[0][0]).toMatchObject({ project_id: P, version: 1 })
    const dup = await createSettingsStore(fakeDb({ error: { code: '23505', message: 'duplicate' } }).db).save(P, 0, write)
    expect(dup).toEqual({ ok: false, error: { kind: 'conflict', code: 'changed' } })
  })
  it('lists active price categories of one project', async () => {
    const { db, calls } = fakeDb({ data: [{ id: 'c1', key: 'member', label: { en: 'Member' }, requires_membership: true, sort: 1, version: 1 }] })
    const r = await createSettingsStore(db).listPriceCategories(P)
    expect(r.ok && r.value[0]).toMatchObject({ key: 'member', requiresMembership: true })
    expect(opsOf(calls[0], 'eq')).toEqual([['project_id', P]])
    expect(opsOf(calls[0], 'is')).toEqual([['archived_at', null]])
  })
})
