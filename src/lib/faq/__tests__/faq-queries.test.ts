/**
 * ADR-037 D6 — the real website queries, run with groq-js against fixtures:
 * placements dereference only public FAQ sets (published, not archived; a
 * draft-only set is invisible), items are read in the request language with
 * NO fallback, and answer links resolve like article bodies — including the
 * new Catalogue targets (D12).
 */
import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import * as Q from '@/lib/sanity/queries'
import { placementFaqGroups } from '../items'
import { sectionFaqGroups } from '../collect'
import { internalTargetPath } from '@/lib/links/link-target'
import type { FAQSection, Post } from '@/lib/sanity/types'

const NOW = new Date('2026-10-19T10:00:00.000Z')
const PAST = '2026-10-01T09:00:00.000Z'
const P = 'acme'
const ref = (id: string) => ({ _type: 'reference', _ref: id, _key: id })
const slug = (s: string, loc = 'it') => ({ [loc]: { _type: 'slug', current: s } })
const block = (text: string, markDefs: unknown[] = [], marks: string[] = []) => ({
  _type: 'block', _key: `b-${text.length}`, style: 'normal', markDefs, children: [{ _type: 'span', _key: 's', text, marks }],
})
const entry = (key: string, q: Record<string, string>, a: Record<string, unknown[]>) => ({
  _type: 'faqEntry', _key: key,
  question: { _type: 'localizedString', ...q },
  answer: { _type: 'faqAnswerText', ...a },
})

const dataset: Record<string, unknown>[] = [
  {
    _id: 'project-acme', _type: 'project', projectSlug: P,
    moduleInstallations: [{ _key: 'c', moduleId: 'catalogue', enabled: true, config: { publicSegment: 'menu' } }],
  },
  {
    _id: 'set-live', _type: 'faqSet', projectSlug: P, internalName: 'Live', title: { it: 'Prenotazioni', de: 'Buchungen' },
    items: [
      entry('q1', { it: 'Come prenoto?', de: 'Wie buche ich?' }, { it: [block('Online.')], de: [block('Online.')] }),
      // Italian only: never shown in German.
      entry('q2', { it: 'Posso annullare?' }, { it: [block('Sì, fino a 24 ore prima.')] }),
      // A question with no answer in Italian: dropped in Italian.
      entry('q3', { it: 'Domanda senza risposta' }, { de: [block('Nur Deutsch.')] }),
      // Links: to the catalogue item (resolved through the segment) and to an archived page (plain text).
      entry('q4', { it: 'Cosa offrite?' }, {
        it: [block('Vedi il menu.', [
          { _type: 'link', _key: 'l1', internal: { _type: 'reference', _ref: 'item-pizza', _weak: true } },
          { _type: 'link', _key: 'l2', internal: { _type: 'reference', _ref: 'post-archived', _weak: true } },
        ], ['l1'])],
      }),
    ],
  },
  { _id: 'set-archived', _type: 'faqSet', projectSlug: P, internalName: 'Old', archivedAt: PAST, items: [entry('x', { it: 'Archiviata?' }, { it: [block('No.')] })] },
  { _id: 'drafts.set-draft', _type: 'faqSet', projectSlug: P, internalName: 'Draft only', items: [entry('d', { it: 'Bozza?' }, { it: [block('Sì.')] })] },
  { _id: 'set-foreign', _type: 'faqSet', projectSlug: 'other', internalName: 'Other site', items: [entry('f', { it: 'Straniera?' }, { it: [block('No.')] })] },
  { _id: 'item-pizza', _type: 'catalogueItem', projectSlug: P, hasPage: true, slug: slug('margherita') },
  { _id: 'post-archived', _type: 'post', projectSlug: P, slug: slug('vecchio'), publishedAt: PAST, archivedAt: PAST },
  {
    _id: 'page-1', _type: 'page', projectSlug: P, slug: { ...slug('faq'), ...slug('faq-de', 'de') }, title: { it: 'FAQ' },
    sections: [
      { _type: 'faqSection', _key: 'sets', title: { it: 'Domande' }, subtitle: { it: 'Tutto quello che serve' }, showSetTitles: true, faqSets: [ref('set-live'), ref('set-archived'), ref('set-draft'), ref('set-foreign')] },
      { _type: 'faqSection', _key: 'legacy', items: [{ _type: 'faqItem', _key: 'l', question: { it: 'Vecchia?' }, answer: { it: 'Sì.' } }] },
      // Sets chosen but none public: the legacy items must NOT come back.
      { _type: 'faqSection', _key: 'both', faqSets: [ref('set-archived')], items: [{ _type: 'faqItem', _key: 'l', question: { it: 'Nascosta?' }, answer: { it: 'Sì.' } }] },
    ],
  },
  {
    _id: 'post-sets', _type: 'post', projectSlug: P, slug: slug('con-faq'), publishedAt: PAST,
    faqSets: [ref('set-live')], faqTitle: { it: 'Le vostre domande' }, faqSubtitle: { de: 'Nur Deutsch' },
    faq: [{ _type: 'faqItem', _key: 'f', question: { it: 'Importata?' }, answer: { it: 'Sì.' } }],
  },
  {
    _id: 'post-legacy', _type: 'post', projectSlug: P, slug: slug('importato'), publishedAt: PAST,
    faq: [{ _type: 'faqItem', _key: 'f', question: { it: 'Importata?' }, answer: { it: 'Sì.' } }],
  },
]

async function run<T = unknown>(query: string, params: Record<string, unknown> = {}): Promise<T> {
  const base = { projectSlug: P, locale: 'it', defaultLocale: 'it', charsPerMinute: 1000 }
  const all = { ...base, ...params }
  const value = await evaluate(parse(query, { params: all }), { dataset, params: all, timestamp: NOW })
  return (await value.get()) as T
}

describe('FAQ sections on a page', () => {
  it('dereference only the public set of this website (not archived, draft-only or foreign)', async () => {
    const page = await run<{ sections: FAQSection[] }>(Q.pageBySlugQuery, { slug: 'faq' })
    const [sets] = page.sections
    expect((sets.faqSets ?? []).map((s) => s!._id)).toEqual(['set-live'])
    expect(sets.faqSetCount).toBe(4)
    expect(sets.subtitle).toBe('Tutto quello che serve')
    expect(sets.showSetTitles).toBe(true)
  })

  it('show only items complete in the request language (no fallback)', async () => {
    const it_ = await run<{ sections: FAQSection[] }>(Q.pageBySlugQuery, { slug: 'faq' })
    expect(sectionFaqGroups(it_.sections[0])[0].items.map((i) => i.key)).toEqual(['q1', 'q2', 'q4'])
    const de = await run<{ sections: FAQSection[] }>(Q.pageBySlugQuery, { slug: 'faq-de', locale: 'de' })
    const groups = sectionFaqGroups(de.sections[0])
    expect(groups[0].items.map((i) => i.key)).toEqual(['q1'])
    expect(groups[0].title).toBe('Buchungen')
    // The Italian subtitle is a section heading (legacy loc() rule), not an FAQ item.
  })

  it('read legacy inline items only while no set is chosen', async () => {
    const page = await run<{ sections: FAQSection[] }>(Q.pageBySlugQuery, { slug: 'faq' })
    expect(sectionFaqGroups(page.sections[1])[0].items.map((i) => i.question)).toEqual(['Vecchia?'])
    expect(sectionFaqGroups(page.sections[2])).toEqual([])
  })
})

describe('FAQs on a blog post', () => {
  it('reads the sets, the heading in this language only, and never the legacy array when sets are chosen', async () => {
    const post = await run<Post>(Q.postBySlugQuery, { slug: 'con-faq' })
    expect(post.faqTitle).toBe('Le vostre domande')
    expect(post.faqSubtitle).toBeNull()
    const groups = placementFaqGroups({ faqSets: post.faqSets, faqSetCount: post.faqSetCount, legacyItems: post.legacyFaq })
    expect(groups.map((g) => g.id)).toEqual(['set-live'])
    expect(groups[0].title).toBe('Prenotazioni')
  })

  it('falls back to the imported legacy FAQ when no set is chosen', async () => {
    const post = await run<Post>(Q.postBySlugQuery, { slug: 'importato' })
    const groups = placementFaqGroups({ faqSets: post.faqSets, faqSetCount: post.faqSetCount, legacyItems: post.legacyFaq })
    expect(groups).toHaveLength(1)
    expect(groups[0].items[0]).toMatchObject({ question: 'Importata?', answer: { kind: 'plain', text: 'Sì.' } })
  })

  it('the draft preview query carries the same FAQ projection', async () => {
    const { postDraftPreviewQuery } = await import('@/lib/sanity/post-preview-query')
    expect(postDraftPreviewQuery).toContain('"faqSets": (faqSets[')
    expect(postDraftPreviewQuery).toContain('"faqSetCount": count(faqSets)')
    expect(postDraftPreviewQuery).toContain('"legacyFaq"')
  })
})

describe('answer links (D12)', () => {
  it('a catalogue item resolves through the installed segment; an archived post is not live', async () => {
    const post = await run<Post>(Q.postBySlugQuery, { slug: 'con-faq' })
    const set = post.faqSets![0]!
    const q4 = set.items!.find((i) => i._key === 'q4')!
    const defs = (q4.answer![0].markDefs as { internalTarget: Record<string, unknown> }[])
    expect(defs[0].internalTarget).toMatchObject({ _type: 'catalogueItem', hasPage: true, slug: 'margherita', segment: 'menu' })
    expect(internalTargetPath(defs[0].internalTarget, P)).toBe('menu/margherita')
    expect(defs[1].internalTarget.live).toBe(false)
    expect(internalTargetPath(defs[1].internalTarget, P)).toBeNull()
  })
})
