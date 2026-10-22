import { describe, expect, it } from 'vitest'
import { buildDisclosurePatch } from '../disclosure-patch'
import { decodeRev, encodeRev, parseSettingsSet } from '../paths'

describe('allow-list', () => {
  it('accepts the two writable paths', () => {
    const r = parseSettingsSet({ amazonTrackingIds: [{ marketplace: 'amazon.it', trackingId: 'a-21' }], 'affiliateDisclosure.it': '  Ciao  ' })
    expect(r).toMatchObject({ ok: true, disclosure: { it: 'Ciao' } })
  })
  it.each(['siteName', 'supportedLocales', 'defaultLocale', 'phone', 'integrations.googleAnalytics', 'affiliateDisclosure', 'affiliateDisclosure.', 'affiliateDisclosure.it.x', 'showPricesByDefault', 'amazonTrackingIds.0', '__proto__'])(
    'refuses %s as an unknown field',
    (path) => {
      expect(parseSettingsSet({ [path]: 'x' })).toMatchObject({ ok: false, error: 'invalid_field' })
    },
  )
  it('refuses a batch with one bad path (nothing partially accepted)', () => {
    expect(parseSettingsSet({ 'affiliateDisclosure.it': 'ok', phone: '1' })).toMatchObject({ ok: false })
  })
  it('refuses empty batches, wrong types and long text; empty text is allowed (= standard wording)', () => {
    expect(parseSettingsSet({})).toMatchObject({ ok: false })
    expect(parseSettingsSet(null)).toMatchObject({ ok: false })
    expect(parseSettingsSet({ 'affiliateDisclosure.it': 5 })).toMatchObject({ ok: false, error: 'invalid_value' })
    expect(parseSettingsSet({ 'affiliateDisclosure.it': 'x'.repeat(601) })).toMatchObject({ ok: false, error: 'invalid_value' })
    expect(parseSettingsSet({ 'affiliateDisclosure.it': '   ' })).toMatchObject({ ok: true, disclosure: { it: '' } })
  })
  it('validates the Amazon list', () => {
    expect(parseSettingsSet({ amazonTrackingIds: [{ marketplace: 'amazon.nope', trackingId: 'a-21' }] })).toMatchObject({ ok: false, error: 'invalid_marketplace' })
    expect(parseSettingsSet({ amazonTrackingIds: [] })).toMatchObject({ ok: true, amazon: [] })
  })
})

describe('revision', () => {
  it('round-trips the two revisions', () => {
    expect(decodeRev(encodeRev('s1', 'p1'))).toEqual({ siteRev: 's1', projectRev: 'p1' })
    expect(decodeRev(undefined)).toEqual({ siteRev: '', projectRev: '' })
  })
})

describe('disclosure patch', () => {
  const ref = { _key: 'k1', hasConfig: true, disclosure: { _type: 'localizedString', it: 'Vecchio' } }
  it('sets and unsets single languages by installation key', () => {
    expect(buildDisclosurePatch(ref, { it: 'Nuovo', de: '' }, 'catalogueModuleConfig')).toEqual({
      set: { 'moduleInstallations[_key=="k1"].config.affiliateDisclosure.it': 'Nuovo' },
      unset: ['moduleInstallations[_key=="k1"].config.affiliateDisclosure.de'],
    })
  })
  it('creates the missing container in one set (never replaces other config)', () => {
    expect(buildDisclosurePatch({ ...ref, disclosure: null }, { it: 'Ciao' }, 'catalogueModuleConfig').set).toEqual({
      'moduleInstallations[_key=="k1"].config.affiliateDisclosure': { _type: 'localizedString', it: 'Ciao' },
    })
    expect(buildDisclosurePatch({ _key: null, hasConfig: false, disclosure: null }, { it: 'Ciao' }, 'catalogueModuleConfig').set).toEqual({
      'moduleInstallations[moduleId=="catalogue"].config': { _type: 'catalogueModuleConfig', affiliateDisclosure: { _type: 'localizedString', it: 'Ciao' } },
    })
  })
  it('clearing when nothing is stored writes nothing', () => {
    expect(buildDisclosurePatch({ ...ref, disclosure: null }, { it: '' }, 't')).toEqual({ set: {}, unset: [] })
  })
})

describe('Awin paths', () => {
  it('accepts a publisher ID (trimmed), clears on empty, refuses junk', () => {
    expect(parseSettingsSet({ awinPublisherId: ' 123456 ' })).toMatchObject({ ok: true, awinPublisherId: '123456' })
    expect(parseSettingsSet({ awinPublisherId: '' })).toMatchObject({ ok: true, awinPublisherId: '' })
    for (const bad of ['12', '12345678901', 'abc123', '12 34', 5, null]) expect(parseSettingsSet({ awinPublisherId: bad })).toMatchObject({ ok: false, error: 'invalid_value', path: 'awinPublisherId' })
  })
  it('accepts shop ids as stored rows, in order; empty clears', () => {
    const r = parseSettingsSet({ affiliateShops: ['ibs', 'amazon', 'lafeltrinelli'] })
    expect(r).toMatchObject({ ok: true, affiliateShops: [
      { _key: 'shop-ibs', _type: 'affiliateShopSetting', shop: 'ibs' },
      { _key: 'shop-amazon', _type: 'affiliateShopSetting', shop: 'amazon' },
      { _key: 'shop-lafeltrinelli', _type: 'affiliateShopSetting', shop: 'lafeltrinelli' },
    ] })
    expect(parseSettingsSet({ affiliateShops: [] })).toMatchObject({ ok: true, affiliateShops: [] })
  })
  it('refuses unknown, repeated, too many shops and non-arrays', () => {
    for (const bad of [['nope'], ['ibs', 'ibs'], ['amazon', 'ibs', 'lafeltrinelli', 'mondadori', 'ibs'], 'ibs', [5], [null]]) expect(parseSettingsSet({ affiliateShops: bad })).toMatchObject({ ok: false, error: 'invalid_value', path: 'affiliateShops' })
  })
})
