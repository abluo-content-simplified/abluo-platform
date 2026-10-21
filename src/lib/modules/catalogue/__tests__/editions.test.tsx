// Book editions: validation, ordering, rendering, form round-trip. Old links (no edition) are unchanged.
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { CatalogueError, cleanLinks, type PatchContext } from '../dashboard-patch'
import { linkFormsFromDoc, linksPatch, type LinkForm } from '../dashboard-form'
import { resolveLinks } from '../resolve'
import { localizeBuyLinks } from '../amazon-delivery'
import { EDITION_LANGUAGES, editionLabel, orderBuyLinks } from '../editions'
import { BuyLinks, ItemLinks } from '@/components/catalogue/CatalogueItemParts'
import { getCatalogueWebsiteMessages } from '@/components/catalogue/messages'
import type { CatalogueItemLinkDTO } from '../dto'

let n = 0
const pctx = (): Pick<PatchContext, 'locales' | 'newKey'> => ({ locales: new Set(['it', 'en']), newKey: () => `k${++n}` })
const code = (fn: () => unknown) => {
  try {
    fn()
  } catch (e) {
    return e instanceof CatalogueError ? e.code : 'other'
  }
  return 'ok'
}
const EN = 'https://www.amazon.co.uk/dp/B0ENENENEN'
const IT = 'https://www.amazon.it/dp/B0ITITITIT'
const row = (extra: Record<string, unknown>) => ({ _key: 'a', kind: 'buy', url: IT, ...extra })
const link = (key: string, language: string | null, original = false, extra: Partial<CatalogueItemLinkDTO> = {}): CatalogueItemLinkDTO => ({
  key, label: '', url: `https://shop.example/${key}`, kind: 'buy', affiliate: false, ...(language ? { edition: { language, original } } : {}), ...extra,
})

describe('cleanLinks — edition', () => {
  it('stores language and original on a buy link; nothing when absent', () => {
    const [a, b] = cleanLinks([row({ edition: { language: 'en', original: true } }), row({ _key: 'b' })], pctx())
    expect(a.edition).toEqual({ language: 'en', original: true })
    expect('edition' in b).toBe(false)
    const [c] = cleanLinks([row({ edition: { language: 'IT ', original: false } })], pctx())
    expect(c.edition).toEqual({ language: 'it' })
  })
  it('accepts every listed language, refuses others', () => {
    for (const l of EDITION_LANGUAGES) expect(code(() => cleanLinks([row({ edition: { language: l.code } })], pctx()))).toBe('ok')
    for (const bad of ['xx', 'english', 'en-GB', 5, '<b>'])
      expect(code(() => cleanLinks([row({ edition: { language: bad } })], pctx())), String(bad)).toBe('invalid_value')
  })
  it('refuses two originals, an edition on an info link, and a bad flag', () => {
    expect(code(() => cleanLinks([row({ edition: { language: 'en', original: true } }), row({ _key: 'b', edition: { language: 'it', original: true } })], pctx()))).toBe('invalid_value')
    expect(code(() => cleanLinks([{ _key: 'a', url: IT, label: { en: 'x' }, edition: { language: 'en' } }], pctx()))).toBe('invalid_value')
    expect(code(() => cleanLinks([row({ edition: { language: 'en', original: 'yes' } })], pctx()))).toBe('invalid_value')
    expect(code(() => cleanLinks([row({ edition: { original: true } })], pctx()))).toBe('invalid_value')
  })
})

describe('ordering', () => {
  const links = [link('de', 'de'), link('en', 'en', true), link('it', 'it'), link('es', 'es')]
  const keys = (ls: CatalogueItemLinkDTO[]) => ls.map((l) => l.key)
  it("visitor's language first, then the original, then the rest alphabetically by name", () => {
    expect(keys(orderBuyLinks(links, 'it'))).toEqual(['it', 'en', 'de', 'es'])
    expect(keys(orderBuyLinks(links, 'de'))).toEqual(['de', 'en', 'es', 'it'])
  })
  it('without a matching page language: original first', () => {
    expect(keys(orderBuyLinks(links, 'fr'))).toEqual(['en', 'de', 'es', 'it'])
  })
  it('fewer than two editions keep stored order; info links are not buy links', () => {
    const one = [link('a', null), link('b', 'en'), { ...link('c', null), kind: 'info' as const }]
    expect(keys(orderBuyLinks(one, 'en'))).toEqual(['a', 'b'])
  })
})

describe('rendering', () => {
  const m = getCatalogueWebsiteMessages('it')
  const html = (links: CatalogueItemLinkDTO[], mm = m) => renderToStaticMarkup(<BuyLinks links={links} siteHosts={[]} m={mm} />)
  it('several editions: one button per language in its own name, original marked, visitor first', () => {
    const out = html([link('en', 'en', true), link('it', 'it')])
    expect(out.indexOf('Italiano')).toBeLessThan(out.indexOf('English'))
    expect(out).toContain('English · Originale')
    expect(out).not.toContain('Acquista')
    expect(getCatalogueWebsiteMessages('de').editionOriginal).toBe('Original')
    expect(editionLabel({ language: 'en', original: true }, 'Original')).toBe('English · Original')
  })
  it('affiliate behaviour per edition link is kept (rel, marker, per-visitor Amazon store, tag)', () => {
    const ids = [{ marketplace: 'amazon.it', trackingId: 'tmzit-21' }, { marketplace: 'amazon.co.uk', trackingId: 'tmzuk-21' }]
    const ls = localizeBuyLinks([link('en', 'en', true, { url: EN }), link('it', 'it', false, { url: IT })], { country: 'IT', trackingIds: ids })
    const out = html(ls)
    expect(out).toContain('href="https://www.amazon.it/dp/B0ITITITIT?tag=tmzit-21"')
    expect(out).toContain('href="https://www.amazon.co.uk/dp/B0ENENENEN?tag=tmzuk-21"')
    expect(out.match(/rel="sponsored nofollow noopener noreferrer"/g)).toHaveLength(2)
    expect(out.match(/data-affiliate-marker/g)).toHaveLength(2)
  })
  it('one edition: usual label with the language as a secondary part; none: exactly as before', () => {
    expect(html([link('en', 'en')])).toContain('Acquista · English')
    const old = html([link('x', null)])
    expect(old).toContain('>Acquista<')
    expect(old).not.toContain('·')
  })
  it('cards: one primary buy link, the info links stay', () => {
    const out = renderToStaticMarkup(<ItemLinks links={[link('en', 'en', true), link('it', 'it'), { ...link('i', null), kind: 'info', label: 'More' }]} siteHosts={[]} compact m={m} />)
    expect(out).toContain('Acquista · Italiano')
    expect(out).not.toContain('English')
    expect(out).toContain('More')
    // old data without m / editions is untouched
    const plain = renderToStaticMarkup(<ItemLinks links={[link('x', null, false, { label: 'Buy it' })]} siteHosts={[]} compact />)
    expect(plain).toContain('Buy it')
  })
})

describe('form and data round-trip', () => {
  it('stored → editor → patch → server keeps the edition; old links unchanged', () => {
    const stored = [
      { _key: 'a', kind: 'buy', url: 'https://x.example/a', label: { en: 'Buy' }, edition: { language: 'en', original: true } },
      { _key: 'b', kind: 'buy', url: 'https://x.example/b', edition: { language: 'it' } },
      { _key: 'c', kind: 'buy', url: 'https://x.example/c' },
    ]
    const forms = linkFormsFromDoc(stored)
    expect(forms[0].edition).toEqual({ language: 'en', original: true })
    expect(forms[1].edition).toEqual({ language: 'it', original: false })
    expect(forms[2].edition).toBeUndefined()
    const patch = linksPatch(forms, 'en')
    expect(patch[0]).toMatchObject({ edition: { language: 'en', original: true } })
    expect(patch[1]).toMatchObject({ edition: { language: 'it' } })
    expect((patch[1] as { edition: object }).edition).not.toHaveProperty('original')
    expect('edition' in patch[2]).toBe(false)
    const cleaned = cleanLinks(patch, pctx())
    expect(cleaned[0].edition).toEqual({ language: 'en', original: true })
    const dto = resolveLinks(cleaned as never, { locale: 'en', defaultLocale: 'en' } as never)
    expect(dto[0].edition).toEqual({ language: 'en', original: true })
    expect(dto[1].edition).toEqual({ language: 'it', original: false })
    expect(dto[2].edition).toBeUndefined()
  })
  it('linksPatch: an unknown language is not sent; a second original is dropped; info links never carry one', () => {
    const f = (key: string, extra: Partial<LinkForm>): LinkForm => ({ key, label: {}, url: `https://x.example/${key}`, kind: 'buy', affiliate: false, ...extra })
    const p = linksPatch([f('a', { edition: { language: 'zz', original: true } }), f('b', { edition: { language: 'en', original: true } }), f('c', { edition: { language: 'it', original: true } }), f('d', { kind: 'info', label: { en: 'L' }, edition: { language: 'en', original: false } })], 'en')
    expect('edition' in p[0]).toBe(false)
    expect(p[1]).toMatchObject({ edition: { language: 'en', original: true } })
    expect((p[2] as { edition: object }).edition).toEqual({ language: 'it' })
    expect('edition' in p[3]).toBe(false)
  })
})
