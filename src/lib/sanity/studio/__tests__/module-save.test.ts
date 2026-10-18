import { describe, expect, it } from 'vitest'
import { buildInstallationPatch, installationSelector, isEmptyPatch, isRevisionConflict, type InstallationLike } from '../module-save'

const before = (): InstallationLike => ({
  _key: 'k1',
  moduleId: 'catalogue',
  version: '1.0.0',
  enabled: true,
  installedAt: '2026-10-01T00:00:00Z',
  provenance: 'admin',
  config: { _type: 'catalogueConfig', showPricesByDefault: true, affiliateDisclosure: { _type: 'localizedString', it: 'Vecchio' } },
})

describe('buildInstallationPatch', () => {
  it('a new module is appended whole', () => {
    const e = { moduleId: 'blog', config: {} }
    expect(buildInstallationPatch(undefined, e)).toEqual({ append: e, set: {}, unset: [] })
  })

  it('writes nothing when nothing changed', () => {
    expect(isEmptyPatch(buildInstallationPatch(before(), before()))).toBe(true)
  })

  it('sets only the changed config key, addressed by _key (never replaces the entry)', () => {
    const after = before()
    after.config!.showPricesByDefault = false
    const p = buildInstallationPatch(before(), after)
    expect(p.append).toBeUndefined()
    expect(p.set).toEqual({ 'moduleInstallations[_key=="k1"].config.showPricesByDefault': false })
    expect(p.unset).toEqual([])
  })

  it('leaves config keys the admin did not touch alone (another writer may have changed them)', () => {
    const after = before()
    after.enabled = false
    const p = buildInstallationPatch(before(), after)
    expect(Object.keys(p.set)).toEqual(['moduleInstallations[_key=="k1"].enabled'])
    expect(JSON.stringify(p)).not.toContain('affiliateDisclosure')
  })

  it('unsets keys the admin cleared', () => {
    const after = before()
    delete after.config!.showPricesByDefault
    expect(buildInstallationPatch(before(), after).unset).toEqual(['moduleInstallations[_key=="k1"].config.showPricesByDefault'])
  })

  it('falls back to the module id when the entry has no _key', () => {
    expect(installationSelector({ moduleId: 'blog' })).toBe('moduleInstallations[moduleId=="blog"]')
  })

  it('sets the whole config when the stored entry has none', () => {
    const b = { ...before(), config: undefined }
    const after = { ...b, config: { _type: 'catalogueConfig', a: 1 } }
    expect(buildInstallationPatch(b, after).set).toEqual({ 'moduleInstallations[_key=="k1"].config': after.config })
  })
})

describe('isRevisionConflict', () => {
  it('recognises a 409 and a revision message', () => {
    expect(isRevisionConflict({ statusCode: 409 })).toBe(true)
    expect(isRevisionConflict({ response: { statusCode: 409 } })).toBe(true)
    expect(isRevisionConflict(new Error('Document revision ID mismatch'))).toBe(true)
    expect(isRevisionConflict(new Error('offline'))).toBe(false)
    expect(isRevisionConflict(null)).toBe(false)
  })
})
