/**
 * ADR-040 B2.2 — the Studio rules for `page.access`, and that the page schema
 * actually wires them (home page never restricted, no public file downloads on
 * a members-only page).
 */
import { describe, it, expect } from 'vitest'
import { schemaTypes } from '@/lib/sanity/schema'
import { ACCESS_ROUTE_SLUG, findFileDownloadCtas, validatePageAccess, validatePageSlugNotReserved } from '../page-schema-rules'
import { RESERVED_SLUGS } from '@/lib/platform/reserved-slugs'
import { ACCESS_ROUTE_SEGMENT } from '../request'

const G = '11111111-1111-4111-8111-111111111111'
const R = { visibility: 'restricted', groups: [G] }
const page = (over: Record<string, unknown> = {}) => ({ pageType: 'landing', sections: [], ...over })

describe('validatePageAccess', () => {
  it('public, absent and unset are always fine', () => {
    expect(validatePageAccess(undefined, page())).toBe(true)
    expect(validatePageAccess(null, page())).toBe(true)
    expect(validatePageAccess({ visibility: 'public' }, page())).toBe(true)
    expect(validatePageAccess({}, page())).toBe(true)
  })
  it('a valid members-only page passes', () => {
    expect(validatePageAccess({ ...R, navigation: 'locked' }, page())).toBe(true)
  })
  it('the home page can never be restricted', () => {
    expect(validatePageAccess(R, page({ pageType: 'home' }))).toMatch(/home page is always public/)
    expect(validatePageAccess({ visibility: 'public' }, page({ pageType: 'home' }))).toBe(true)
  })
  it('needs at least one well-formed group id', () => {
    expect(validatePageAccess({ visibility: 'restricted' }, page())).toMatch(/at least one/)
    expect(validatePageAccess({ visibility: 'restricted', groups: [] }, page())).toMatch(/at least one/)
    expect(validatePageAccess({ visibility: 'restricted', groups: ['teachers'] }, page())).toMatch(/group id/)
  })
  it('refuses an unknown visibility or menu mode', () => {
    expect(validatePageAccess({ visibility: 'Restricted' }, page())).toMatch(/Choose who/)
    expect(validatePageAccess({ ...R, navigation: 'shown' }, page())).toMatch(/Navigation/)
  })
  it('refuses a "Download a file" button anywhere on a members-only page (Sanity files are public by link)', () => {
    const sections = [{ _type: 'heroSection', primaryCta: { actionType: 'page' }, cards: [{ cta: { actionType: 'fileDownload' } }] }]
    expect(findFileDownloadCtas(sections)).toEqual(['sections[0].cards[0].cta'])
    expect(validatePageAccess(R, page({ sections }))).toMatch(/Download a file/)
    expect(validatePageAccess({ visibility: 'public' }, page({ sections }))).toBe(true)
  })
})

describe('the page schema', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pageType = (schemaTypes as any[]).find((t) => t.name === 'page')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const access = pageType.fields.find((f: any) => f.name === 'access')
  it('has an `access` object with visibility, groups and navigation', () => {
    expect(access?.type).toBe('object')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(access.fields.map((f: any) => f.name)).toEqual(['visibility', 'groups', 'navigation'])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vis = access.fields.find((f: any) => f.name === 'visibility')
    expect(vis.initialValue).toBe('public')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(vis.options.list.map((o: any) => o.value)).toEqual(['public', 'restricted'])
  })
  it('is hidden on the home page — but stays visible if a restricted value is already stored there', () => {
    expect(access.hidden({ document: { pageType: 'home' }, value: undefined })).toBe(true)
    expect(access.hidden({ document: { pageType: 'home' }, value: { visibility: 'restricted' } })).toBe(false)
    expect(access.hidden({ document: { pageType: 'landing' }, value: undefined })).toBe(false)
  })
  it('warns editors that uploaded images and files stay public', () => {
    expect(access.description).toMatch(/stay public by link/)
  })
})

describe('the Access route path is not a page slug', () => {
  it('refuses "site-access" and anything below it, in any language; allows look-alikes', () => {
    expect(validatePageSlugNotReserved({ en: { current: 'site-access' } })).toMatch(/reserved/)
    expect(validatePageSlugNotReserved({ it: { current: 'Site-Access/foo' } })).toMatch(/reserved/)
    expect(validatePageSlugNotReserved({ en: { current: 'site-accessibility' } })).toBe(true)
    expect(validatePageSlugNotReserved({ en: { current: 'about' } })).toBe(true)
    expect(validatePageSlugNotReserved(undefined)).toBe(true)
  })
  it('is the same word as the route segment and the reserved-slug list', () => {
    expect(ACCESS_ROUTE_SLUG).toBe(ACCESS_ROUTE_SEGMENT)
    expect(RESERVED_SLUGS).toContain(ACCESS_ROUTE_SLUG)
  })
  it('the page slug field runs the check', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const slug = (schemaTypes as any[]).find((t) => t.name === 'page').fields.find((f: any) => f.name === 'slug')
    expect(String(slug.validation)).toMatch(/validatePageSlugNotReserved/)
  })
})

