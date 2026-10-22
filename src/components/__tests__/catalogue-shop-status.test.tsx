/** Buy-link editor: the status line + final link under an Awin shop address (IBS …), and same-edition rules. */
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import messages from '../../../messages/en.json'

// next-intl outside Next: read the real English messages, fill {args}.
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: (ns: string) => (key: string, args: Record<string, unknown> = {}) => {
    const msg = ns.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], messages)
    const text = (msg as Record<string, string>)[key]
    if (typeof text !== 'string') throw new Error(`missing message ${ns}.${key}`)
    return text.replace(/\{(\w+)\}/g, (_, k) => String(args[k]))
  },
}))
vi.mock('@/i18n/navigation', () => ({ Link: ({ href, children, ...r }: { href: string; children?: React.ReactNode }) => <a href={href} {...r}>{children}</a> }))
vi.mock('@/app/[locale]/(client)/[tenant]/catalogue/actions', () => ({ checkCatalogueSlugsAction: vi.fn(), resolveAmazonLinkAction: vi.fn() }))

import { ShopLinkBlock, type AmazonEditorContext } from '@/components/client/catalogue/item-fields'
import { linkFormIssues, linksPatch, type LinkForm } from '@/lib/modules/catalogue/dashboard-form'
import { cleanLinks } from '@/lib/modules/catalogue/dashboard-patch'
import { applyEditionChange, duplicateEditionShop, hasManyOriginals } from '@/lib/modules/catalogue/editions'

const IBS = 'https://www.ibs.it/libro-x-9788800000000.html'
const ctx = (affiliate: AmazonEditorContext['affiliate'], canOpenSettings = true): AmazonEditorContext => ({ projectSlug: 'tmz', trackingIds: [], canOpenSettings, affiliate })
const html = (url: string, c: AmazonEditorContext) =>
  renderToStaticMarkup(<ShopLinkBlock url={url} amazon={c} />)

describe('ShopLinkBlock', () => {
  it('tracked: your Awin ID added + final link', () => {
    const h = html(IBS, ctx({ awinPublisherId: '123456', affiliateShops: [{ shop: 'ibs' }] }))
    expect(h).toContain('✓ IBS · your Awin ID added')
    expect(h).toContain('Final link')
    expect(h).toContain('123456')
  })
  it('pasted: the ID from the link', () => {
    const h = html('https://www.awin1.com/cread.php?awinmid=1&awinaffid=777777&ued=' + encodeURIComponent(IBS), ctx({}))
    expect(h).toContain('✓ IBS · using the Awin ID from your link')
  })
  it('no publisher ID: link to Settings, or ask the admin', () => {
    const c = ctx({ affiliateShops: [{ shop: 'ibs' }] })
    const h = html(IBS, c)
    expect(h).toContain('IBS · no Awin ID yet. Add it in Settings.')
    expect(h).toContain('href="/tmz/settings"')
    const h2 = html(IBS, { ...c, canOpenSettings: false })
    expect(h2).toContain('Ask your site admin')
    expect(h2).not.toContain('/tmz/settings')
  })
  it('not approved: works but earns nothing, with a Settings link', () => {
    const h = html(IBS, ctx({ awinPublisherId: '123456', affiliateShops: [] }))
    expect(h).toContain('IBS isn’t ticked as approved in Settings yet. The link works but earns nothing.')
    expect(h).toContain('href="/tmz/settings"')
  })
  it('other hosts and Amazon: nothing', () => {
    expect(html('https://shop.example.com/b', ctx({}))).toBe('')
    expect(html('https://www.amazon.it/dp/B08N5WRWNW', ctx({}))).toBe('')
  })
})

const lf = (key: string, url: string, language = 'it', original = false): LinkForm => ({ key, label: {}, url, kind: 'buy', affiliate: false, edition: { language, original } })
const AMZ = 'https://www.amazon.it/dp/B08N5WRWNW'

describe('one edition, several shops', () => {
  it('Amazon + IBS for the same edition, both original: valid and saved', () => {
    const links = [lf('a', AMZ, 'it', true), lf('b', IBS, 'it', true)]
    expect(linkFormIssues(links, 'en')).toEqual([])
    expect(linksPatch(links, 'en').map((l) => (l as { edition?: { original?: boolean } }).edition?.original)).toEqual([true, true])
    expect(hasManyOriginals(links)).toBe(false)
    const cleaned = cleanLinks(links.map((l) => ({ _key: l.key, url: l.url, kind: 'buy', edition: l.edition })), { locales: new Set(['en']), newKey: () => 'k' })
    expect(cleaned).toHaveLength(2)
  })
  it('same edition, same shop twice: an error naming the shop (client and server)', () => {
    const links = [lf('a', IBS), lf('b', 'https://www.ibs.it/altro-9788800000001.html')]
    expect(linkFormIssues(links, 'en')).toEqual([{ kind: 'duplicateShop', key: 'b', shop: 'IBS' }])
    expect(duplicateEditionShop(links)).toEqual({ index: 1, shop: 'IBS' })
    expect(() => cleanLinks(links.map((l) => ({ _key: l.key, url: l.url, kind: 'buy', edition: l.edition })), { locales: new Set(['en']), newKey: () => 'k' })).toThrow(/already has a link to IBS/)
  })
  it('the same shop for another language is fine; two original languages are still refused', () => {
    expect(linkFormIssues([lf('a', IBS, 'it'), lf('b', IBS, 'en')], 'en')).toEqual([])
    expect(hasManyOriginals([lf('a', IBS, 'it', true), lf('b', AMZ, 'en', true)])).toBe(true)
  })
})

describe('review fixes', () => {
  const WRAP = 'https://www.awin1.com/cread.php?awinmid=9777&awinaffid=1111111&ued=' + encodeURIComponent(IBS)
  it('a pasted Awin wrapper counts as the same shop as the direct address', () => {
    expect(duplicateEditionShop([lf('a', WRAP), lf('b', IBS)])).toEqual({ index: 1, shop: 'IBS' })
  })
  it('original belongs to a language: ticking/unticking applies to all links of it', () => {
    const links = [lf('a', AMZ, 'it'), lf('b', IBS, 'it'), lf('c', IBS, 'en', true)]
    const ticked = applyEditionChange(links, 'a', { language: 'it', original: true })
    expect(ticked.map((l) => l.edition?.original)).toEqual([true, true, false])
    const unticked = applyEditionChange(ticked, 'b', { language: 'it', original: false })
    expect(unticked.map((l) => l.edition?.original)).toEqual([false, false, false])
  })
  it('a link that becomes an original language inherits it', () => {
    const links = [lf('a', AMZ, 'it', true), { ...lf('b', IBS, 'en'), edition: undefined }]
    expect(applyEditionChange(links, 'b', { language: 'it', original: false })[1].edition).toEqual({ language: 'it', original: true })
  })
  it('linksPatch and cleanLinks store every link of the original language as original', () => {
    const links = [lf('a', AMZ, 'it', true), lf('b', IBS, 'it')]
    expect(linksPatch(links, 'en').map((l) => (l as { edition?: { original?: boolean } }).edition?.original)).toEqual([true, true])
    const cleaned = cleanLinks(links.map((l) => ({ _key: l.key, url: l.url, kind: 'buy', edition: l.edition })), { locales: new Set(['en']), newKey: () => 'k' })
    expect(cleaned.map((l) => (l.edition as { original?: boolean }).original)).toEqual([true, true])
  })
})
