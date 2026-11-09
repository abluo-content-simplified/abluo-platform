/**
 * The links list of the Digital Card editor (round 4, Tom 2026-11-09): each
 * link as it will look (label or the label it gets when none is typed — the
 * page's / file's title, as the website), and the drag / keyboard reorder.
 * Fixtures: Claudia Hoffmann's card as stored (a Home link labelled only in
 * DE, a Contatti link with no label) and her pages.
 */
import { describe, expect, it } from 'vitest'
import type { DigitalCardLinkValue } from '@/lib/api/digital-cards'
import { socialsPendingInStudio } from '@/lib/api/digital-cards'
import { dropLink, linkDisplay, linkFallbackLabel, linkTargetText, moveIndex } from '@/components/client/digital-cards/links-model'
import { getDigitalCardSiteMessages } from '@/lib/i18n/digital-cards-site-messages'
import { linkView } from '../website'

const link = (over: Partial<DigitalCardLinkValue>): DigitalCardLinkValue => ({ key: 'k', kind: 'page', label: {}, description: {}, url: '', page: null, file: null, value: '', hidden: false, primary: false, ...over })
const HOME = link({ key: 'cbfdf6bf94e1', page: 'hoffmann-page-home', label: { de: 'Homepage' } })
const CONTATTI = link({ key: 'b6791e1598d8', page: 'hoffmann-page-contatti' })
const targets = {
  pages: [
    { id: 'hoffmann-page-home', title: 'Home' },
    { id: 'hoffmann-page-contatti', title: 'Contatti e appuntamenti' },
  ],
  files: { 'media-cv': { title: 'Curriculum', url: 'https://cdn/cv.pdf' } },
}
const it_ = getDigitalCardSiteMessages('it')
const de = getDigitalCardSiteMessages('de')

describe('how a link shows in the list', () => {
  it('no label: the page title — never the type name ("Page of this website")', () => {
    expect(linkDisplay(CONTATTI, 'it', 'it', targets, it_)).toEqual({ label: 'Contatti e appuntamenti', isDefault: true, description: '', target: 'Contatti e appuntamenti' })
  })

  it('a label typed only in DE: shown in DE; in IT (default) the page title', () => {
    expect(linkDisplay(HOME, 'de', 'it', targets, de)).toMatchObject({ label: 'Homepage', isDefault: false })
    expect(linkDisplay(HOME, 'it', 'it', targets, it_)).toMatchObject({ label: 'Home', isDefault: true })
  })

  it('other languages fall back to the default language label, then the default', () => {
    const l = link({ page: 'hoffmann-page-home', label: { it: 'Pagina iniziale' } })
    expect(linkDisplay(l, 'de', 'it', targets, de).label).toBe('Pagina iniziale')
  })

  it('every kind has a sensible default: file title, standard labels', () => {
    expect(linkFallbackLabel(link({ kind: 'file', file: 'media-cv' }), targets, it_)).toBe('Curriculum')
    expect(linkFallbackLabel(link({ kind: 'phone', value: '+39 0332 1' }), targets, it_)).toBe(it_.linkPhone)
    expect(linkFallbackLabel(link({ kind: 'url', url: 'https://x.it' }), targets, it_)).toBe(it_.linkUrl)
    expect(linkFallbackLabel(link({ kind: 'page', page: null }), targets, it_)).toBe(it_.linkPage)
  })

  it('the editor promises what the website shows (same fallback)', () => {
    const shown = linkView({ _key: 'b6791e1598d8', kind: 'page', label: null, primary: false, page: { pageType: 'landing', slug: 'contatti', title: 'Contatti e appuntamenti' } } as never, {
      locale: 'it',
      siteBase: '/it',
      messages: it_,
      enabledModules: [],
    })
    expect(shown?.label).toBe(linkDisplay(CONTATTI, 'it', 'it', targets, it_).label)
  })

  it('target text per kind', () => {
    expect(linkTargetText(link({ kind: 'url', url: 'https://www.ch-psicoterapeuta.com/' }), targets)).toBe('www.ch-psicoterapeuta.com')
    expect(linkTargetText(link({ kind: 'whatsapp', value: ' +39 333 ' }), targets)).toBe('+39 333')
  })
})

describe('reorder', () => {
  const list = [HOME, CONTATTI, link({ key: 'k3', kind: 'url', url: 'https://x.it' })]
  it('drag: drop after / before another row', () => {
    expect(dropLink(list, HOME.key, { key: 'k3', after: true })?.map((l) => l.key)).toEqual([CONTATTI.key, 'k3', HOME.key])
    expect(dropLink(list, 'k3', { key: HOME.key, after: false })?.map((l) => l.key)).toEqual(['k3', HOME.key, CONTATTI.key])
    expect(dropLink(list, HOME.key, { key: CONTATTI.key, after: false })).toBeNull() // no change
  })
  it('keyboard (grip ArrowUp / ArrowDown): one place, never out of range', () => {
    expect(moveIndex(list, 1, 0).map((l) => l.key)).toEqual([CONTATTI.key, HOME.key, 'k3'])
    expect(moveIndex(list, 0, -1)).toEqual(list)
    expect(moveIndex(list, 2, 3)).toEqual(list)
  })
})

describe('Studio-only social profiles (the editor notice)', () => {
  const live = [{ key: 'linkedin', label: 'linkedin', detail: 'https://it.linkedin.com/in/claudia-hoffmann-psicoterapeuta' }]
  it('Hoffmann: none published, two in the draft → pending', () => {
    expect(socialsPendingInStudio([], [{ platform: 'linkedin', url: 'https://it.linkedin.com/in/claudia-hoffmann-psicoterapeuta' }, { platform: 'facebook', url: 'https://www.facebook.com/claudiahoffmannpsicologapsicoterapeuta/' }])).toBe(true)
  })
  it('draft equal to what is live, or no draft → nothing pending', () => {
    expect(socialsPendingInStudio(live, [{ platform: 'linkedin', url: 'https://it.linkedin.com/in/claudia-hoffmann-psicoterapeuta' }])).toBe(false)
    expect(socialsPendingInStudio(live, null)).toBe(false)
    expect(socialsPendingInStudio(live, [{ platform: '', url: '' }])).toBe(false)
  })
})
