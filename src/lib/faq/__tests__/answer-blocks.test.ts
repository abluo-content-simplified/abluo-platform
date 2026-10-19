/**
 * FAQ answers (ADR-037 D12): the server's strict sanitizer and the editor's
 * normalizing mirror agree — what the mirror produces, the sanitizer accepts.
 */
import { describe, expect, it } from 'vitest'
import { collectInternalRefs, FaqAnswerError, normalizeFaqAnswer, sanitizeFaqAnswer } from '../answer-blocks'

const span = (text: string, marks: string[] = [], key = 's1') => ({ _type: 'span', _key: key, text, marks })
const para = (children: unknown[], extra: Record<string, unknown> = {}) => ({ _type: 'block', _key: 'b1', style: 'normal', markDefs: [], children, ...extra })

describe('sanitizeFaqAnswer', () => {
  it('keeps paragraphs, bold, italic and both list types', () => {
    const value = [
      para([span('Hello '), span('bold', ['strong'], 's2'), span(' it', ['em'], 's3')]),
      { ...para([span('one')]), _key: 'b2', listItem: 'bullet', level: 1 },
      { ...para([span('two')]), _key: 'b3', listItem: 'number', level: 2 },
    ]
    expect(sanitizeFaqAnswer(value)).toEqual(value)
  })

  it('treats null / undefined as no answer and trims trailing empty paragraphs', () => {
    expect(sanitizeFaqAnswer(undefined)).toEqual([])
    expect(sanitizeFaqAnswer(null)).toEqual([])
    expect(sanitizeFaqAnswer([para([span('x')]), { ...para([span('  ')]), _key: 'b2' }])).toHaveLength(1)
  })

  it.each([
    ['a heading', [para([span('x')], { style: 'h2' })]],
    ['a quote', [para([span('x')], { style: 'blockquote' })]],
    ['an image block', [{ _type: 'image', _key: 'i1' }]],
    ['an unknown list', [para([span('x')], { listItem: 'square', level: 1 })]],
    ['a list level of 5', [para([span('x')], { listItem: 'bullet', level: 5 })]],
    ['an unknown decorator', [para([span('x', ['underline'])])]],
    ['a javascript: link', [para([span('x', ['l1'])], { markDefs: [{ _type: 'link', _key: 'l1', href: 'javascript:alert(1)' }] })]],
    ['a non-link annotation', [para([span('x', ['c1'])], { markDefs: [{ _type: 'color', _key: 'c1', value: 'red' }] })]],
    ['an inline object', [para([{ _type: 'emoji', _key: 'e1' }])]],
    ['a duplicate block key', [para([span('a')]), para([span('b')])]],
    ['not an array', 'text'],
  ])('refuses %s', (_label, value) => {
    expect(() => sanitizeFaqAnswer(value)).toThrow(FaqAnswerError)
  })

  it('stores internal links as weak references and keeps external ones', () => {
    const out = sanitizeFaqAnswer([
      para([span('a', ['l1']), span('b', ['l2'], 's2')], {
        markDefs: [
          { _type: 'link', _key: 'l1', internal: { _type: 'reference', _ref: 'page-1' } },
          { _type: 'link', _key: 'l2', href: 'https://example.com', blank: true },
        ],
      }),
    ]) as Array<{ markDefs: unknown[] }>
    expect(out[0].markDefs).toEqual([
      { _type: 'link', _key: 'l1', internal: { _type: 'reference', _ref: 'page-1', _weak: true } },
      { _type: 'link', _key: 'l2', href: 'https://example.com', blank: true },
    ])
    expect([...collectInternalRefs(out)]).toEqual(['page-1'])
  })

  it('drops link definitions no span uses', () => {
    const out = sanitizeFaqAnswer([para([span('x')], { markDefs: [{ _type: 'link', _key: 'l1', href: 'https://example.com' }] })]) as Array<{ markDefs: unknown[] }>
    expect(out[0].markDefs).toEqual([])
  })

  it('accepts a stored link annotation that is an exact copy, even if it is no longer strictly valid', () => {
    const legacy = { _type: 'link', _key: 'l1', href: 'https://example.com', extra: 1 }
    const value = [para([span('x', ['l1'])], { markDefs: [legacy] })]
    expect(() => sanitizeFaqAnswer(value)).toThrow(FaqAnswerError)
    expect(() => sanitizeFaqAnswer(value, value)).not.toThrow()
    expect(() => sanitizeFaqAnswer([para([span('x', ['l1'])], { markDefs: [{ ...legacy, extra: 2 }] })], value)).toThrow(FaqAnswerError)
  })
})

describe('normalizeFaqAnswer (the editor mirror)', () => {
  it('turns headings and quotes into paragraphs and drops what an answer cannot hold', () => {
    const out = normalizeFaqAnswer([
      { _type: 'block', _key: 'h', style: 'h2', markDefs: [], children: [span('Title')] },
      { _type: 'block', _key: 'q', style: 'blockquote', markDefs: [], children: [span('Quote')] },
      { _type: 'image', _key: 'i' },
      { _type: 'block', _key: 'c', style: 'normal', markDefs: [{ _type: 'color', _key: 'c1' }], children: [span('red', ['c1'])] },
    ])
    expect(out.map((b) => b.style)).toEqual(['normal', 'normal', 'normal'])
    expect(out.map((b) => (b.children[0] as { text: string }).text)).toEqual(['Title', 'Quote', 'red'])
    expect(out[2].markDefs).toEqual([])
  })

  it('maps pasted b / i and unsupported list kinds', () => {
    const out = normalizeFaqAnswer([{ _type: 'block', style: 'normal', listItem: 'bullet', level: 9, markDefs: [], children: [{ _type: 'span', text: 'x', marks: ['b', 'i'] }] }])
    expect(out[0].listItem).toBe('bullet')
    expect(out[0].level).toBe(4)
    expect((out[0].children[0] as { marks: string[] }).marks.sort()).toEqual(['em', 'strong'])
  })

  it('always produces something the server sanitizer accepts', () => {
    const messy = [
      { _type: 'block', style: 'h3', markDefs: [{ _type: 'link', _key: 'k', href: 'https://a.it' }, { _type: 'x', _key: 'z' }], children: [{ _type: 'span', text: 'A', marks: ['k', 'z', 'b'] }] },
      { _type: 'block', style: 'normal', listItem: 'number', children: [{ _type: 'span', text: 'B' }] },
      { _type: 'block', style: 'normal', children: [{ _type: 'span', text: '  ' }] },
    ]
    const out = normalizeFaqAnswer(messy)
    expect(() => sanitizeFaqAnswer(out)).not.toThrow()
    expect(out).toHaveLength(2)
  })

  it('returns [] for no content', () => {
    expect(normalizeFaqAnswer(undefined)).toEqual([])
    expect(normalizeFaqAnswer([])).toEqual([])
  })
})
