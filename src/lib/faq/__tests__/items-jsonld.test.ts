/**
 * ADR-037 D6/D7 — which questions a placement shows, and the ONE FAQPage a
 * URL carries: fallback order, locale filtering, de-duplication, limited HTML,
 * unavailable links as plain text, nothing when the module is not installed.
 */
import { describe, expect, it } from 'vitest'
import { placementFaqGroups, normaliseQuestion, usesFaqSets } from '../items'
import { answerHtml, blocksToLimitedHtml, buildFaqPageSchema, faqJsonLdItems, mergeFaqJsonLdItems } from '../jsonld'
import { collectSectionFaqItems, faqJsonLdLinks } from '../collect'
import type { FaqSetData, PageSection, PortableTextBlock } from '@/lib/sanity/types'

const span = (text: string, marks: string[] = []) => ({ _type: 'span', _key: `s${text.length}`, text, marks })
const block = (children: ReturnType<typeof span>[], extra: Partial<PortableTextBlock> = {}) =>
  ({ _type: 'block', _key: `b${Math.random()}`, style: 'normal', markDefs: [], children, ...extra }) as PortableTextBlock

const set = (id: string, items: [string, string | null, PortableTextBlock[] | null][], title: string | null = null): FaqSetData => ({
  _id: id,
  projectSlug: 'acme',
  title,
  items: items.map(([key, question, answer]) => ({ _key: key, question, answer })),
})

const links = { siteBase: '/it/acme', projectSlug: 'acme' }

describe('placementFaqGroups — fallback order', () => {
  const legacy = [{ _key: 'l1', question: 'Vecchia?', answer: 'Sì.' }]

  it('sets win over legacy questions', () => {
    const g = placementFaqGroups({ faqSets: [set('a', [['q', 'Domanda?', [block([span('Risposta.')])]]])], faqSetCount: 1, legacyItems: legacy })
    expect(g.map((x) => x.id)).toEqual(['a'])
  })

  it('chosen but non-public sets never bring legacy questions back', () => {
    expect(placementFaqGroups({ faqSets: [null], faqSetCount: 1, legacyItems: legacy })).toEqual([])
  })

  it('legacy questions show while no set is chosen', () => {
    const g = placementFaqGroups({ faqSets: null, faqSetCount: 0, legacyItems: legacy })
    expect(g).toHaveLength(1)
    expect(g[0].items[0]).toEqual({ key: 'l1', question: 'Vecchia?', answer: { kind: 'plain', text: 'Sì.' } })
  })

  it('without a stored count, the sets received decide', () => {
    expect(usesFaqSets({ faqSets: [set('a', [])] })).toBe(true)
    expect(usesFaqSets({})).toBe(false)
  })
})

describe('placementFaqGroups — locale filtering', () => {
  it('drops items missing a question or an answer in this language, and empty sets', () => {
    const g = placementFaqGroups({
      faqSets: [
        set('a', [
          ['ok', 'Domanda?', [block([span('Risposta.')])]],
          ['noQ', null, [block([span('Solo risposta.')])]],
          ['noA', 'Solo domanda?', null],
          ['blankA', 'Risposta vuota?', [block([span('   ')])]],
        ], 'Titolo'),
        set('empty', [['noA', 'x', null]]),
      ],
      faqSetCount: 2,
    })
    expect(g).toHaveLength(1)
    expect(g[0].title).toBe('Titolo')
    expect(g[0].items.map((i) => i.key)).toEqual(['ok'])
  })

  it('the same set attached twice renders once', () => {
    const s = set('a', [['q', 'Domanda?', [block([span('Risposta.')])]]])
    expect(placementFaqGroups({ faqSets: [s, s], faqSetCount: 2 })).toHaveLength(1)
  })
})

describe('normaliseQuestion', () => {
  it('folds case, spaces and closing punctuation', () => {
    expect(normaliseQuestion('  Come   PRENOTO? ')).toBe(normaliseQuestion('come prenoto'))
    expect(normaliseQuestion('¿Puedo usarlo sin un POS?')).toBe('puedo usarlo sin un pos')
  })
})

describe('limited HTML answers', () => {
  it('keeps p, lists, strong, em and escapes text', () => {
    const html = blocksToLimitedHtml([
      block([span('Uno '), span('forte', ['strong']), span(' e '), span('corsivo', ['em']), span(' <script>')]),
      block([span('A')], { listItem: 'bullet' }),
      block([span('B')], { listItem: 'bullet' }),
      block([span('1')], { listItem: 'number' }),
      block([span('Fine.')]),
    ])
    expect(html).toBe('<p>Uno <strong>forte</strong> e <em>corsivo</em> &lt;script&gt;</p><ul><li>A</li><li>B</li></ul><ol><li>1</li></ol><p>Fine.</p>')
  })

  it('resolves internal links; an unavailable target becomes plain text', () => {
    const blocks = [block([span('menu', ['l1']), span(' e '), span('vecchio', ['l2']), span(' e '), span('esterno', ['l3'])], {
      markDefs: [
        { _type: 'link', _key: 'l1', internal: { _ref: 'i' }, internalTarget: { _type: 'catalogueItem', projectSlug: 'acme', hasPage: true, slug: 'margherita', segment: 'menu', live: true } },
        { _type: 'link', _key: 'l2', internal: { _ref: 'p' }, internalTarget: { _type: 'post', projectSlug: 'acme', slug: 'x', live: false } },
        { _type: 'link', _key: 'l3', href: 'https://example.org/a?b=1&c=2' },
      ],
    })]
    const html = answerHtml({ kind: 'rich', blocks }, links)
    expect(html).toBe('<p><a href="/it/acme/menu/margherita">menu</a> e vecchio e <a href="https://example.org/a?b=1&amp;c=2">esterno</a></p>')
  })

  it('site paths become absolute with a canonical origin (no project segment)', () => {
    const ctx = faqJsonLdLinks({ locale: 'it', siteBase: '/it/acme', origin: 'https://www.acme.it', projectSlug: 'acme' })
    const blocks = [block([span('pagina', ['l'])], { markDefs: [{ _type: 'link', _key: 'l', internal: { _ref: 'x' }, internalTarget: { _type: 'page', projectSlug: 'acme', slug: 'contatti', live: true } }] })]
    expect(answerHtml({ kind: 'rich', blocks }, ctx)).toBe('<p><a href="https://www.acme.it/it/contatti">pagina</a></p>')
  })

  it('legacy plain answers are escaped text', () => {
    expect(answerHtml({ kind: 'plain', text: 'A & B <c>' }, links)).toBe('A &amp; B &lt;c&gt;')
  })
})

describe('one FAQPage per URL', () => {
  const sectionA = { _type: 'faqSection', _key: 'a', faqSetCount: 1, faqSets: [set('s1', [['q1', 'Come prenoto?', [block([span('Online.')])]], ['q2', 'Posso annullare?', [block([span('Sì.')])]]])] }
  const sectionB = { _type: 'faqSection', _key: 'b', items: [{ _key: 'l', question: 'come prenoto', answer: 'Doppione.' }, { _key: 'm', question: 'Dove siete?', answer: 'A Cervia.' }] }
  const sections = [sectionA, { _type: 'textSection', _key: 't' }, sectionB] as unknown as PageSection[]

  it('merges every FAQ section in render order, de-duplicated by normalised question', () => {
    const items = collectSectionFaqItems(sections, { available: true, links })
    const schema = buildFaqPageSchema({ items, url: 'https://www.acme.it/it/faq', origin: 'https://www.acme.it' })!
    expect(schema['@type']).toBe('FAQPage')
    expect(schema['@id']).toBe('https://www.acme.it/it/faq#faq')
    expect(schema.isPartOf).toEqual({ '@id': 'https://www.acme.it#website' })
    const main = schema.mainEntity as { name: string; acceptedAnswer: { text: string } }[]
    expect(main.map((q) => q.name)).toEqual(['Come prenoto?', 'Posso annullare?', 'Dove siete?'])
    expect(main[0].acceptedAnswer.text).toBe('<p>Online.</p>')
  })

  it('nothing when the FAQ module is not installed, or no item is visible', () => {
    expect(collectSectionFaqItems(sections, { available: false, links })).toEqual([])
    expect(buildFaqPageSchema({ items: [] })).toBeNull()
  })

  it('a post adds its own placement after the page sections, still one list', () => {
    const post = faqJsonLdItems(placementFaqGroups({ legacyItems: [{ _key: 'x', question: 'Dove siete?', answer: 'Altro.' }, { _key: 'y', question: 'Orari?', answer: '9-18.' }] }), links)
    const merged = mergeFaqJsonLdItems(collectSectionFaqItems(sections, { available: true, links }), post)
    expect(merged.map((i) => i.question)).toEqual(['Come prenoto?', 'Posso annullare?', 'Dove siete?', 'Orari?'])
  })
})
