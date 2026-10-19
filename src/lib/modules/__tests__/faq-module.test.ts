import { describe, it, expect } from 'vitest'
import { MODULE_REGISTRY } from '../registry'
import { isSectionTypeAvailable } from '../sections'
import { buildSchema } from '../schema'
import { schemaTypes } from '@/lib/sanity/schema'
import { BODY_LINK_TARGET_TYPES } from '@/lib/links/target-types'
import { FAQ_MESSAGES_FOR_TEST, getFaqMessages } from '@/lib/i18n/faq-messages'
import { PLATFORM_LOCALES } from '@/lib/i18n/locales'
import { LIFECYCLE_PUBLIC_RULES } from '@/lib/lifecycle/public-types'

// ADR-037 — the FAQ module. These pin what a regression would break silently:
// ownership of faqSection (and therefore gating), the stored type names, the
// additive fields, the restricted answer format and the shared link targets.

/* eslint-disable @typescript-eslint/no-explicit-any */
const types = buildSchema() as any[]
const type = (name: string) => types.find((t) => t.name === name) ?? (schemaTypes as any[]).find((t) => t.name === name)
const field = (typeName: string, name: string) => type(typeName)?.fields?.find((f: any) => f.name === name)

describe('FAQ module', () => {
  const manifest = MODULE_REGISTRY.find((m) => m.id === 'faq')

  it('is registered, owns the FAQ section and lists FAQ Sets in Studio', () => {
    expect(manifest).toBeDefined()
    expect(manifest?.platformContract.sectionTypes).toEqual(['faqSection'])
    const item = manifest?.platformContract.collections?.[0]?.items?.[0]
    expect(item).toMatchObject({ schemaType: 'faqSet', label: 'FAQ Sets', initialValueTemplate: 'faqSetProjectOwned' })
    expect(manifest?.dependencies.integratesWith).toEqual(['blog', 'events', 'translate'])
    expect(MODULE_REGISTRY.find((m) => m.id === 'blog')?.dependencies.integratesWith).toContain('faq')
  })

  it('keeps the stored type names, each registered exactly once', () => {
    const names = [...(schemaTypes as any[]).map((t) => t.name)]
    for (const n of ['faqItem', 'faqSection', 'faqSet', 'faqEntry', 'faqAnswerText']) {
      expect(names.filter((x) => x === n), n).toHaveLength(1)
    }
  })

  it('gates the section on installation, failing open when the module list is unknown', () => {
    expect(isSectionTypeAvailable('faqSection', ['blog'])).toBe(false)
    expect(isSectionTypeAvailable('faqSection', ['faq'])).toBe(true)
    expect(isSectionTypeAvailable('faqSection', null)).toBe(true)
  })

  it('declares faq.set.read / write / delete with the ADR default roles', () => {
    const perms = Object.fromEntries((manifest?.platformContract.permissions ?? []).map((p) => [p.id, p.defaultRoles]))
    expect(perms).toEqual({
      'faq.set.read': ['owner', 'editor', 'viewer'],
      'faq.set.write': ['owner', 'editor'],
      'faq.set.delete': ['owner'],
    })
  })

  it('faqSet is a lifecycle type with the optional rule (published, not archived)', () => {
    expect(LIFECYCLE_PUBLIC_RULES.faqSet).toBe('optional')
    expect(field('faqSet', 'archivedAt')).toBeDefined()
    expect(field('faqSet', 'publishedAt')).toBeUndefined()
  })
})

describe('FAQ schema — additive fields', () => {
  it('faqSection: sets, subtitle, set titles; inline items read only', () => {
    expect(field('faqSection', 'faqSets')?.of?.[0]?.to).toEqual([{ type: 'faqSet' }])
    expect(field('faqSection', 'subtitle')?.type).toBe('localizedText')
    expect(field('faqSection', 'showSetTitles')?.initialValue).toBe(true)
    expect(field('faqSection', 'items')?.readOnly).toBe(true)
    expect(field('faqSection', 'items')?.of?.[0]?.type).toBe('faqItem')
  })

  it('post: faqSets, faqTitle, faqSubtitle; legacy faq typed, hidden and read only', () => {
    expect(field('post', 'faqSets')?.of?.[0]?.to).toEqual([{ type: 'faqSet' }])
    expect(field('post', 'faqTitle')?.type).toBe('localizedString')
    expect(field('post', 'faqSubtitle')?.type).toBe('localizedText')
    const legacy = field('post', 'faq')
    expect(legacy?.of?.[0]?.type).toBe('faqItem')
    expect(legacy?.hidden).toBe(true)
    expect(legacy?.readOnly).toBe(true)
  })

  it('faqItem is unchanged (question localizedString, answer localizedText)', () => {
    expect(field('faqItem', 'question')?.type).toBe('localizedString')
    expect(field('faqItem', 'answer')?.type).toBe('localizedText')
  })

  it('faqEntry: plain question, restricted rich answer', () => {
    expect(field('faqEntry', 'question')?.type).toBe('localizedString')
    expect(field('faqEntry', 'answer')?.type).toBe('faqAnswerText')
  })

  it('faqAnswerText allows paragraphs, two lists, bold, italic and the shared link only — per locale, with translation status', () => {
    const t = type('faqAnswerText')
    for (const code of Object.keys(PLATFORM_LOCALES)) expect(t.fields.find((f: any) => f.name === code), code).toBeDefined()
    expect(t.fields.find((f: any) => f.name === 'translationStatus')?.hidden).toBe(true)
    const blockDef = t.fields.find((f: any) => f.name === 'it').of[0]
    expect(blockDef.styles.map((s: any) => s.value)).toEqual(['normal'])
    expect(blockDef.lists.map((s: any) => s.value)).toEqual(['bullet', 'number'])
    expect(blockDef.marks.decorators.map((s: any) => s.value)).toEqual(['strong', 'em'])
    expect(blockDef.marks.annotations.map((a: any) => a.name)).toEqual(['link'])
  })

  it('the shared body link targets pages, posts, news, events and catalogue items/collections', () => {
    const blockDef = type('faqAnswerText').fields.find((f: any) => f.name === 'en').of[0]
    const internal = blockDef.marks.annotations[0].fields.find((f: any) => f.name === 'internal')
    expect(internal.to.map((t: any) => t.type)).toEqual([...BODY_LINK_TARGET_TYPES])
    expect(BODY_LINK_TARGET_TYPES).toEqual(['page', 'post', 'newsArticle', 'event', 'catalogueItem', 'catalogueCollection'])
    expect(internal.weak).toBe(true)
    const body = type('localizedPortableText').fields.find((f: any) => f.name === 'en').of[0]
    expect(body.marks.annotations[0]).toBe(blockDef.marks.annotations[0])
  })
})

describe('FAQ messages', () => {
  it('cover every platform locale', () => {
    for (const code of Object.keys(PLATFORM_LOCALES)) expect(FAQ_MESSAGES_FOR_TEST[code]?.defaultHeading, code).toBeTruthy()
  })
  it('default heading, English fallback', () => {
    expect(getFaqMessages('en').defaultHeading).toBe('Frequently Asked Questions')
    expect(getFaqMessages('it').defaultHeading).toBe('Domande frequenti')
    expect(getFaqMessages('de').defaultHeading).toBe('Häufig gestellte Fragen')
    expect(getFaqMessages('xx').defaultHeading).toBe('Frequently Asked Questions')
  })
})
