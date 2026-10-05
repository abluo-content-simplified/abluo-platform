import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { LIMITS, sanitizeBlocks } from '@/lib/api/post-drafts'
import {
  BODY_LIMITS,
  collectInternalRefs,
  hasPreservedContent,
  hrefFromUserInput,
  normalizeHref,
  type BodyBlock,
  blocksToPlainText,
  countWords,
  normalizeBlocks,
  readingMinutes,
  textToBlocks,
} from '../normalize-blocks'

const span = (text: string, marks: string[] = [], _key = `s${text.length}`) => ({ _type: 'span', _key, text, marks })
const block = (o: Record<string, unknown>) => ({ _type: 'block', _key: 'b1', style: 'normal', markDefs: [], children: [span('Hi')], ...o })

/** Every output must survive the server sanitizer unchanged (same reference). */
function roundTrip(value: unknown, reference?: unknown) {
  const out = normalizeBlocks(value, reference)
  expect(sanitizeBlocks(out, reference)).toEqual(out)
  return out as BodyBlock[]
}
const spanOf = (b: BodyBlock, i = 0) => b.children[i] as { text: string; marks: string[]; _key: string }

describe('normalizeBlocks', () => {
  it('passes a clean body through unchanged', () => {
    const body = [
      block({ _key: 'a', style: 'h2', children: [span('Title', [], 'x1')] }),
      block({ _key: 'b', children: [span('Bold', ['strong'], 'x2'), span(' plain', [], 'x3')] }),
      block({ _key: 'c', listItem: 'number', level: 2, children: [span('Item', ['em', 'strong'], 'x4')] }),
      block({ _key: 'd', style: 'blockquote', children: [span('Quote', [], 'x5')] }),
    ]
    const out = roundTrip(body)
    expect(out.map((b) => b._key)).toEqual(['a', 'b', 'c', 'd'])
    expect(out[1].children.map((c) => c._key)).toEqual(['x2', 'x3'])
    expect(out[2]).toMatchObject({ listItem: 'number', level: 2 })
    expect(spanOf(out[2]).marks).toEqual(['em', 'strong'])
  })

  it('maps pasted heading styles onto h2/h3 and unknown styles onto normal', () => {
    const out = roundTrip(
      ['h1', 'h4', 'h5', 'h6', 'title', undefined].map((style, i) => block({ _key: `k${i}`, style })),
    )
    expect(out.map((b) => b.style)).toEqual(['h2', 'h3', 'h3', 'h3', 'normal', 'normal'])
  })

  it('drops unsafe links and unknown marks but keeps their text, merging spans', () => {
    const out = roundTrip([
      block({
        markDefs: [{ _type: 'link', _key: 'l1', href: 'javascript:alert(1)' }],
        children: [span('Read ', [], 'a'), span('this', ['l1'], 'b'), span(' now', ['underline', 'code'], 'c'), span('!', ['b'], 'd')],
      }),
    ])
    expect(out[0].markDefs).toEqual([])
    expect(out[0].children).toEqual([
      { _type: 'span', _key: 'a', text: 'Read this now', marks: [] },
      { _type: 'span', _key: 'd', text: '!', marks: ['strong'] },
    ])
  })

  it('keeps safe links (and blank), drops unused and malformed link defs', () => {
    const out = roundTrip([
      block({
        markDefs: [
          { _type: 'link', _key: 'l1', href: 'https://studio.it/a', blank: true },
          { _type: 'link', _key: 'l2', href: '/contatti' },
          { _type: 'link', _key: 'unused', href: 'https://x.it' },
          { _type: 'link', _key: 'l3', href: 'https://x.it', extra: 1 },
        ],
        children: [span('a', ['l1'], 'a'), span('b', ['l2', 'strong'], 'b'), span('c', ['l3'], 'c')],
      }),
    ])
    expect(out[0].markDefs).toEqual([
      { _type: 'link', _key: 'l1', href: 'https://studio.it/a', blank: true },
      { _type: 'link', _key: 'l2', href: '/contatti' },
    ])
    expect(out[0].children.map((c) => (c as { marks: string[] }).marks)).toEqual([['l1'], ['l2', 'strong'], []])
  })

  it('drops images, embeds and inline objects', () => {
    const out = roundTrip([
      { _type: 'image', _key: 'img', asset: { _ref: 'x' } },
      block({ children: [span('a', [], 'a'), { _type: 'mention', _key: 'm' }, span('b', [], 'b')] }),
      'junk',
      null,
    ])
    expect(out).toHaveLength(1)
    expect(blocksToPlainText(out)).toBe('ab')
  })

  it('normalises lists: unknown types become bullets, levels clamp to 1–4', () => {
    const out = roundTrip([
      block({ _key: 'a', listItem: 'square', level: 9 }),
      block({ _key: 'b', listItem: 'number', level: 0 }),
      block({ _key: 'c', listItem: 'bullet', level: 'x' }),
      block({ _key: 'd', listItem: 'bullet', level: 2.4 }),
    ])
    expect(out.map((b) => [b.listItem, b.level])).toEqual([
      ['bullet', 4],
      ['number', 1],
      ['bullet', 1],
      ['bullet', 2],
    ])
  })

  it('generates missing, invalid and duplicate keys', () => {
    const out = roundTrip([
      block({ _key: undefined, children: [{ _type: 'span', text: 'a' }] }),
      block({ _key: 'has space', children: [span('b', [], 'dup'), span('c', ['em'], 'dup')] }),
      block({ _key: 'same' }),
      block({ _key: 'same' }),
    ])
    const keys = out.map((b) => b._key)
    expect(new Set(keys).size).toBe(4)
    expect(keys[2]).toBe('same')
    expect(new Set(out[1].children.map((c) => c._key)).size).toBe(2)
  })

  it('gives empty blocks one empty span and trims empty trailing paragraphs', () => {
    const out = roundTrip([
      block({ _key: 'a', children: [] }),
      block({ _key: 'b' }),
      block({ _key: 'c', children: [span('   ')] }),
      block({ _key: 'd', children: [] }),
    ])
    expect(out.map((b) => b._key)).toEqual(['a', 'b'])
    expect(out[0].children).toHaveLength(1)
    expect(spanOf(out[0]).text).toBe('')
  })

  it('returns [] for an empty or non-array value', () => {
    expect(normalizeBlocks(undefined)).toEqual([])
    expect(normalizeBlocks({})).toEqual([])
    expect(normalizeBlocks([block({ children: [span('')] })])).toEqual([])
  })

  it('respects the server size limits', () => {
    expect(BODY_LIMITS).toEqual({
      blocks: LIMITS.blocks,
      spansPerBlock: LIMITS.spansPerBlock,
      spanText: LIMITS.spanText,
      markDefsPerBlock: LIMITS.markDefsPerBlock,
      href: LIMITS.href,
    })
    const long = 'x'.repeat(LIMITS.spanText * 2 + 5)
    const many = Array.from({ length: LIMITS.spansPerBlock + 50 }, (_, i) => span('y', i % 2 ? ['em'] : [], `k${i}`))
    const out = roundTrip([
      block({ _key: 'long', children: [span(long, [], 'L')] }),
      block({ _key: 'many', children: many }),
      ...Array.from({ length: LIMITS.blocks + 3 }, (_, i) => block({ _key: `n${i}` })),
    ])
    expect(out).toHaveLength(LIMITS.blocks)
    expect(out[0].children.map((c) => (c as { text: string }).text.length)).toEqual([LIMITS.spanText, LIMITS.spanText, 5])
    expect(out[1].children).toHaveLength(LIMITS.spansPerBlock)
  })
})

describe('textToBlocks', () => {
  it('turns lines into paragraphs and list markers into lists', () => {
    const out = textToBlocks('First line\r\n\n- one\n• two\n1. alpha\n2) beta\n\n  Last  ')
    expect(sanitizeBlocks(out)).toEqual(out)
    expect((out as BodyBlock[]).map((b) => [b.listItem ?? 'p', spanOf(b).text])).toEqual([
      ['p', 'First line'],
      ['bullet', 'one'],
      ['bullet', 'two'],
      ['number', 'alpha'],
      ['number', 'beta'],
      ['p', 'Last'],
    ])
  })

  it('returns [] for blank text', () => {
    expect(textToBlocks(' \n\n ')).toEqual([])
  })
})

describe('word count and reading time', () => {
  it('counts words across blocks', () => {
    expect(countWords(textToBlocks('Hello there\nGeneral   Kenobi'))).toBe(4)
    expect(countWords([])).toBe(0)
  })
  it('rounds reading time, minimum one minute', () => {
    expect(readingMinutes(0)).toBe(0)
    expect(readingMinutes(10)).toBe(1)
    expect(readingMinutes(450)).toBe(2)
    expect(readingMinutes(1000)).toBe(5)
  })
})

describe('link hrefs', () => {
  it.each([
    ['https://studio.it', true],
    ['http://studio.it/a?b=1#c', true],
    ['mailto:info@studio.it', true],
    ['tel:+390544123456', true],
    ['/contatti', true],
    ['/it/blog/post-1?x=1', true],
    ['javascript:alert(1)', false],
    ['JavaScript:alert(1)', false],
    ['data:text/html,<b>x</b>', false],
    ['vbscript:x', false],
    ['//evil.example', false],
    ['/\\evil.example', false],
    ['https://', false],
    ['https:evil.example', false],
    ['studio.it', false],
    ['#top', false],
    ['https://studio.it/a b', false],
    ['mailto:not-an-email', false],
    ['', false],
    [`https://x.it/${'a'.repeat(2100)}`, false],
  ])('normalizeHref(%j) → %s', (href, ok) => {
    expect(normalizeHref(href) !== null).toBe(ok)
  })

  it('completes what people type', () => {
    expect(hrefFromUserInput(' www.studio.it ')).toBe('https://www.studio.it')
    expect(hrefFromUserInput('studio.it/contatti')).toBe('https://studio.it/contatti')
    expect(hrefFromUserInput('info@studio.it')).toBe('mailto:info@studio.it')
    expect(hrefFromUserInput('+39 0544 123456')).toBe('tel:+390544123456')
    expect(hrefFromUserInput('/contatti')).toBe('/contatti')
    expect(hrefFromUserInput('javascript:alert(1)')).toBeNull()
    expect(hrefFromUserInput('hello there')).toBeNull()
  })

  it('server refuses unsafe or malformed links', () => {
    const withLink = (def: Record<string, unknown>) => [
      block({ markDefs: [{ _type: 'link', _key: 'l', ...def }], children: [span('x', ['l'], 's')] }),
    ]
    expect(() => sanitizeBlocks(withLink({ href: 'javascript:alert(1)' }))).toThrow()
    expect(() => sanitizeBlocks(withLink({ href: '//evil.example' }))).toThrow()
    expect(() => sanitizeBlocks(withLink({ href: 'https://x.it', blank: 'yes' }))).toThrow()
    expect(() => sanitizeBlocks(withLink({ href: 'https://x.it', onclick: 'x' }))).toThrow()
    expect(sanitizeBlocks(withLink({ href: 'https://x.it', blank: true }))).toHaveLength(1)
  })
})

describe('preserving existing content (edit an existing post)', () => {
  const image = { _type: 'image', _key: 'img1', asset: { _type: 'reference', _ref: 'image-abc-800x600-jpg' }, alt: 'Studio' }
  const stored: Array<Record<string, unknown>> = [
    block({ _key: 'h', style: 'h4', children: [span('Old heading', [], 'hs')] }),
    image,
    block({
      _key: 'p',
      markDefs: [
        { _type: 'internalLink', _key: 'ref1', reference: { _type: 'reference', _ref: 'page-1' } },
        { _type: 'link', _key: 'lk', href: 'https://studio.it' },
      ],
      children: [span('See ', [], 'p1'), span('page', ['ref1'], 'p2'), span(' or ', [], 'p3'), span('site', ['lk', 'code'], 'p4'), { _type: 'mention', _key: 'm1', who: 'x' }],
    }),
    block({ _key: 'h1', style: 'h1', children: [span('Big', [], 'h1s')] }),
  ]

  it('an unchanged stored body survives normalize + sanitize byte-for-byte', () => {
    const out = roundTrip(stored, stored)
    expect(out).toEqual(stored)
    expect(hasPreservedContent(out)).toBe(true)
  })

  it('keeps preserved items while the surrounding text is edited and blocks move', () => {
    const edited = [
      image,
      { ...stored[0], children: [span('Edited heading', [], 'hs')] },
      { ...stored[2], children: [span('Now see ', [], 'p1'), ...(stored[2].children as unknown[]).slice(1)] },
    ]
    const out = roundTrip(edited, stored)
    expect(out[0]).toEqual(image)
    expect(out[1]).toMatchObject({ style: 'h4' })
    expect(out[2].markDefs).toEqual(stored[2].markDefs)
    expect(out[2].children.at(-1)).toEqual({ _type: 'mention', _key: 'm1', who: 'x' })
  })

  it('without a reference, preserved content is downgraded or dropped (text kept)', () => {
    const out = roundTrip(stored)
    expect(out.map((b) => b._type)).toEqual(['block', 'block', 'block'])
    expect(out.map((b) => b.style)).toEqual(['h3', 'normal', 'h2'])
    expect(out[1].markDefs).toEqual([{ _type: 'link', _key: 'lk', href: 'https://studio.it' }])
    expect(out[1].children.map((c) => (c as { text: string }).text).join('')).toBe('See page or site')
  })

  it('drops a NEW unknown block, a modified image, a modified annotation and a new inline object', () => {
    const out = normalizeBlocks(
      [
        { _type: 'image', _key: 'img2', asset: { _ref: 'image-new-1x1-png' } },
        { ...image, alt: 'changed' },
        {
          ...stored[2],
          markDefs: [{ _type: 'internalLink', _key: 'ref1', reference: { _type: 'reference', _ref: 'page-EVIL' } }],
          children: [span('page', ['ref1'], 'p2'), { _type: 'mention', _key: 'm2', who: 'y' }],
        },
      ],
      stored
    )
    expect(out).toHaveLength(1)
    expect((out[0] as BodyBlock).markDefs).toEqual([])
    expect((out[0] as BodyBlock).children).toEqual([{ _type: 'span', _key: 'p2', text: 'page', marks: [] }])
  })

  it('server refuses a NEW unknown block even when the body has others', () => {
    expect(() => sanitizeBlocks([{ _type: 'image', _key: 'img2', asset: { _ref: 'image-new-1x1-png' } }], stored)).toThrow()
    expect(() => sanitizeBlocks([{ _type: 'image', _key: 'img1' }])).toThrow()
    expect(() => sanitizeBlocks([{ _type: 'script', _key: 'x', src: 'https://evil' }], stored)).toThrow()
  })

  it('server refuses a modified preserved block, annotation or inline object', () => {
    expect(() => sanitizeBlocks([{ ...image, asset: { _type: 'reference', _ref: 'image-evil-1x1-png' } }], stored)).toThrow()
    expect(() => sanitizeBlocks([{ ...image, extra: 1 }], stored)).toThrow()
    const p = stored[2] as { markDefs: Record<string, unknown>[]; children: unknown[] }
    expect(() =>
      sanitizeBlocks([{ ...p, markDefs: [{ ...p.markDefs[0], reference: { _type: 'reference', _ref: 'page-2' } }, p.markDefs[1]] }], stored)
    ).toThrow()
    expect(() =>
      sanitizeBlocks([{ ...p, children: [...p.children.slice(0, 4), { _type: 'mention', _key: 'm1', who: 'evil' }] }], stored)
    ).toThrow()
  })

  it('server refuses unsupported styles / decorators the stored body does not use', () => {
    const h5 = block({ _key: 'n', style: 'h5' })
    expect(() => sanitizeBlocks([h5], stored)).toThrow()
    expect(sanitizeBlocks([block({ _key: 'n', style: 'h4' })], stored)).toHaveLength(1)
    expect(() => sanitizeBlocks([block({ children: [span('x', ['underline'], 's')] })], stored)).toThrow()
    expect(sanitizeBlocks([block({ children: [span('x', ['code'], 's')] })], stored)).toHaveLength(1)
  })
})

describe('internal links (links round 2)', () => {
  const linkBlock = (def: Record<string, unknown>) => [
    block({ markDefs: [{ _type: 'link', _key: 'l', ...def }], children: [span('Chi sono', ['l'], 's')] }),
  ]

  it('keeps a reference link with an optional new-tab override through normalize + sanitize', () => {
    for (const def of [
      { internal: { _type: 'reference', _ref: 'hoffmann-page-chi-sono', _weak: true } },
      { internal: { _type: 'reference', _ref: 'abc123' }, blank: true },
    ]) {
      const out = roundTrip(linkBlock(def))
      expect(out[0].markDefs).toEqual([{ _type: 'link', _key: 'l', ...def }])
    }
    expect(collectInternalRefs(linkBlock({ internal: { _type: 'reference', _ref: 'abc123' } }))).toEqual(new Set(['abc123']))
  })

  it.each([
    ['a draft id', { internal: { _type: 'reference', _ref: 'drafts.abc' } }],
    ['a path-like id', { internal: { _type: 'reference', _ref: 'a/b' } }],
    ['both href and internal', { href: 'https://x.it', internal: { _type: 'reference', _ref: 'abc' } }],
    ['extra reference fields', { internal: { _type: 'reference', _ref: 'abc', _strengthenOnPublish: {} } }],
    ['_weak false', { internal: { _type: 'reference', _ref: 'abc', _weak: false } }],
    ['not a reference', { internal: { _ref: 'abc' } }],
    ['a non-boolean blank', { internal: { _type: 'reference', _ref: 'abc' }, blank: 1 }],
  ])('refuses %s (server) and drops it keeping the text (client)', (_l, def) => {
    expect(() => sanitizeBlocks(linkBlock(def))).toThrow()
    const out = normalizeBlocks(linkBlock(def)) as BodyBlock[]
    expect(out[0].markDefs).toEqual([])
    expect(spanOf(out[0]).text).toBe('Chi sono')
  })
})
