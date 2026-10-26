/**
 * ADR-040 §15 (R9) — which pages can show documents, whether a document fits
 * a page ("no mixing"), and what a visitor sees in a Download section. The
 * same fit rule serves the dashboard offer, the server refusal and the
 * website's re-check at every display.
 */
import { describe, expect, it } from 'vitest'
import { documentFitsPage, toDownloadPages, visibleOnPage, whyNotFit } from '../download-pages'
import { downloadAccessFromGate, toSectionDocuments } from '../download-section.server'
import type { PageDocumentRow } from '../store'
import type { DocumentTerm } from '@/lib/modules/documents/terms'

const G1 = '11111111-1111-4111-8111-111111111111'
const G2 = '22222222-2222-4222-8222-222222222222'
const OUT = '33333333-3333-4333-8333-333333333333'

describe('pages that can show documents', () => {
  const rows = [
    { _id: 'home', pageType: 'home', title: { en: 'Home' }, slug: null, access: { visibility: 'restricted', groups: [G1] }, hasDownloadSection: true },
    { _id: 'contact', pageType: 'landing', title: { en: 'Contact', it: 'Contatti' }, slug: { en: { current: 'contact' } }, access: null, hasDownloadSection: true },
    { _id: 'about', pageType: 'landing', title: { en: 'About' }, slug: { en: { current: 'about' } }, access: null, hasDownloadSection: false },
    { _id: 'area', pageType: 'landing', title: { en: 'Parents' }, slug: { en: { current: 'parents' } }, access: { visibility: 'restricted', groups: [G1.toUpperCase()] }, hasDownloadSection: false },
    { _id: 'child', pageType: 'landing', title: { en: 'Timetables' }, slug: { en: { current: 'parents/timetables' } }, access: null, hasDownloadSection: true },
    { _id: 'broken', pageType: 'landing', title: { en: 'Broken' }, slug: { en: { current: 'broken' } }, access: { visibility: 'weird' }, hasDownloadSection: true },
  ]
  const pages = toDownloadPages(rows, { locale: 'it', defaultLocale: 'en' })
  const byId = Object.fromEntries(pages.map((p) => [p.id, p]))

  it('only pages with a Download section, home first, titles in the dashboard language', () => {
    expect(pages.map((p) => p.id)).toEqual(['home', 'broken', 'contact', 'child'])
    expect(byId.contact.title).toBe('Contatti')
  })
  it('the home page is always public, whatever its access field says', () => {
    expect(byId.home).toMatchObject({ isHome: true, restricted: false, groupIds: [] })
  })
  it('a child of a members-only page is protected by it (path ancestors)', () => {
    expect(byId.child).toMatchObject({ restricted: true, groupIds: [G1] })
  })
  it('an unreadable access field closes the page to nobody', () => {
    expect(byId.broken).toMatchObject({ restricted: true, groupIds: [] })
  })
})

describe('no mixing: does a document fit a page?', () => {
  const pub = { restricted: false, groupIds: [] }
  const p1 = { restricted: true, groupIds: [G1] }
  const nobody = { restricted: true, groupIds: [] }
  it('a public document fits every page', () => {
    for (const page of [pub, p1, nobody]) expect(documentFitsPage({ visibility: 'everyone', groupIds: [] }, page)).toBe(true)
  })
  it('a group document fits only a protected page open to one of its groups', () => {
    const d = { visibility: 'groups' as const, groupIds: [G1.toUpperCase(), G2] }
    expect(documentFitsPage(d, p1)).toBe(true)
    expect(documentFitsPage(d, pub)).toBe(false)
    expect(documentFitsPage(d, nobody)).toBe(false)
    expect(documentFitsPage({ visibility: 'groups', groupIds: [G2] }, p1)).toBe(false)
  })
  it('the reason shown in the form', () => {
    expect(whyNotFit({ visibility: 'groups', groupIds: [G2] }, pub)).toBe('public_page')
    expect(whyNotFit({ visibility: 'groups', groupIds: [G2] }, p1)).toBe('other_groups')
    expect(whyNotFit({ visibility: 'everyone', groupIds: [] }, p1)).toBeNull()
  })
  it('several passwords: a visitor sees the union of their groups', () => {
    const page = { restricted: true, groupIds: [G1, G2] }
    const docs = [
      { id: 'a', visibility: 'groups' as const, groupIds: [G1] },
      { id: 'b', visibility: 'groups' as const, groupIds: [G2] },
      { id: 'c', visibility: 'everyone' as const, groupIds: [] },
    ]
    expect(visibleOnPage(docs, page, new Set([G1])).map((d) => d.id)).toEqual(['a', 'c'])
    expect(visibleOnPage(docs, page, new Set([G1, G2])).map((d) => d.id)).toEqual(['a', 'b', 'c'])
    expect(visibleOnPage(docs, page, null).map((d) => d.id)).toEqual(['c'])
  })
})

describe('what the Download section shows', () => {
  const row = (over: Partial<PageDocumentRow>): PageDocumentRow => ({
    pageId: 'p', sortOrder: 0, documentId: 'd', visibility: 'everyone', title: { it: 'Listino', en: 'Price list' }, note: null,
    categoryTermId: null, tagTermIds: [], groupIds: [], files: [{ locale: 'it', mimeType: 'application/pdf', sizeBytes: 1000, uploadedAt: '2026-10-01T00:00:00Z' }],
    updatedAt: '2026-10-01T00:00:00Z', ...over,
  })
  const base = { locale: 'en', defaultLocale: 'it', siteBaseFor: (l: string) => `/${l}/tmz`, accessEnabled: true, sort: 'manual' as const }

  it('a document only in German is labelled honestly: the link serves its own language', () => {
    const [d] = toSectionDocuments([row({})], { ...base, page: { restricted: false, groupIds: [] }, visitorGroupIds: null })
    expect(d).toMatchObject({ title: 'Price list', file: { locale: 'it' }, href: '/it/tmz/site-access/documents/d', members: false })
  })
  it('picks the visitor’s language when there is a file for it', () => {
    const [d] = toSectionDocuments([row({ files: [
      { locale: 'it', mimeType: 'application/pdf', sizeBytes: 1, uploadedAt: '' },
      { locale: 'en', mimeType: 'application/pdf', sizeBytes: 2, uploadedAt: '' },
    ] })], { ...base, page: { restricted: false, groupIds: [] }, visitorGroupIds: null })
    expect(d).toMatchObject({ file: { locale: 'en' }, otherLocales: ['it'], href: '/en/tmz/site-access/documents/d' })
  })
  it('re-checked at display: a group document on a page made public later is not shown', () => {
    const grp = row({ documentId: 'g', visibility: 'groups', groupIds: [G1] })
    expect(toSectionDocuments([grp], { ...base, page: { restricted: false, groupIds: [] }, visitorGroupIds: [G1] })).toEqual([])
    expect(toSectionDocuments([grp], { ...base, page: { restricted: true, groupIds: [G1] }, visitorGroupIds: [G1] })).toHaveLength(1)
  })
  it('group documents disappear while Access is off; public ones stay', () => {
    const rows = [row({ documentId: 'g', visibility: 'groups', groupIds: [G1] }), row({ documentId: 'e' })]
    const shown = toSectionDocuments(rows, { ...base, accessEnabled: false, page: { restricted: true, groupIds: [G1] }, visitorGroupIds: [G1] })
    expect(shown.map((d) => d.id)).toEqual(['e'])
  })
  it('without a file (or a title) nothing is shown', () => {
    expect(toSectionDocuments([row({ files: [] }), row({ documentId: 'x', title: {} })], { ...base, page: { restricted: false, groupIds: [] }, visitorGroupIds: null })).toEqual([])
  })
  it('sort: manual keeps the client’s order; newest; A–Z', () => {
    const rows = [row({ documentId: 'b', title: { en: 'Beta' }, updatedAt: '2026-01-01' }), row({ documentId: 'a', title: { en: 'alpha' }, updatedAt: '2026-02-01' })]
    const ids = (sort: 'manual' | 'newest' | 'az') => toSectionDocuments(rows, { ...base, sort, page: { restricted: false, groupIds: [] }, visitorGroupIds: null }).map((d) => d.id)
    expect(ids('manual')).toEqual(['b', 'a'])
    expect(ids('newest')).toEqual(['a', 'b'])
    expect(ids('az')).toEqual(['a', 'b'])
  })
  it('the gate decides the page and the visitor: a refused or public gate means "public page, no visitor"', () => {
    expect(downloadAccessFromGate(null)).toEqual({ page: { restricted: false, groupIds: [] }, visitorGroupIds: null })
    const granted = downloadAccessFromGate({ kind: 'granted', chain: [{ visibility: 'restricted', groupIds: [G1.toUpperCase()] }, { visibility: 'public' }], visitorGroupIds: [G1] } as never)
    expect(granted).toEqual({ page: { restricted: true, groupIds: [G1] }, visitorGroupIds: [G1] })
    expect(OUT).not.toBe(G1)
  })
})

describe('categories and tags in the Download section (R9.2)', () => {
  const base = { locale: 'en', defaultLocale: 'it', siteBaseFor: (l: string) => `/${l}`, accessEnabled: true, sort: 'manual' as const, page: { restricted: false, groupIds: [] }, visitorGroupIds: null }
  const terms: { categories: DocumentTerm[]; tags: DocumentTerm[] } = {
    categories: [{ value: 'prezzi', label: { it: 'Prezzi', en: 'Prices' }, color: null }],
    tags: [{ value: 'a', label: { it: 'Alfa' }, color: null }, { value: 'b', label: { it: 'Beta', en: 'Beta EN' }, color: null }],
  }
  const row = (over: Partial<PageDocumentRow>): PageDocumentRow => ({
    pageId: 'p', sortOrder: 0, documentId: 'd', visibility: 'everyone', title: { it: 'Listino' }, note: null, categoryTermId: null, tagTermIds: [], groupIds: [],
    files: [{ locale: 'it', mimeType: 'application/pdf', sizeBytes: 1, uploadedAt: '' }], updatedAt: '', ...over,
  })
  it('labels in the page language (default language as fallback), tags in the vocabulary’s order', () => {
    const [d] = toSectionDocuments([row({ categoryTermId: 'prezzi', tagTermIds: ['b', 'a'] })], { ...base, terms })
    expect(d.category).toEqual({ key: 'prezzi', label: 'Prices' })
    expect(d.tags).toEqual(['Alfa', 'Beta EN'])
  })
  it('a key the vocabulary no longer has is simply not shown', () => {
    const [d] = toSectionDocuments([row({ categoryTermId: 'gone', tagTermIds: ['gone'] })], { ...base, terms })
    expect(d.category).toBeNull()
    expect(d.tags).toEqual([])
  })
})
