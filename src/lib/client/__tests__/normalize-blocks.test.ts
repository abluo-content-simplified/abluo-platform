import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { LIMITS, sanitizeBlocks } from '@/lib/api/post-drafts'
import {
  BODY_LIMITS,
  blocksToPlainText,
  countWords,
  normalizeBlocks,
  readingMinutes,
  textToBlocks,
} from '../normalize-blocks'

const span = (text: string, marks: string[] = [], _key = `s${text.length}`) => ({ _type: 'span', _key, text, marks })
const block = (o: Record<string, unknown>) => ({ _type: 'block', _key: 'b1', style: 'normal', markDefs: [], children: [span('Hi')], ...o })

/** Every output must survive the server sanitizer unchanged. */
function roundTrip(value: unknown) {
  const out = normalizeBlocks(value)
  expect(sanitizeBlocks(out)).toEqual(out)
  return out
}

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
    expect(out[1].children.map((s) => s._key)).toEqual(['x2', 'x3'])
    expect(out[2]).toMatchObject({ listItem: 'number', level: 2 })
    expect(out[2].children[0].marks).toEqual(['em', 'strong'])
  })

  it('maps pasted heading styles onto h2/h3 and unknown styles onto normal', () => {
    const out = roundTrip(
      ['h1', 'h4', 'h5', 'h6', 'title', undefined].map((style, i) => block({ _key: `k${i}`, style })),
    )
    expect(out.map((b) => b.style)).toEqual(['h2', 'h3', 'h3', 'h3', 'normal', 'normal'])
  })

  it('drops links and unknown marks but keeps their text, merging spans', () => {
    const out = roundTrip([
      block({
        markDefs: [{ _type: 'link', _key: 'l1', href: 'https://x.y' }],
        children: [span('Read ', [], 'a'), span('this', ['l1'], 'b'), span(' now', ['underline', 'code'], 'c'), span('!', ['b'], 'd')],
      }),
    ])
    expect(out[0].markDefs).toEqual([])
    expect(out[0].children).toEqual([
      { _type: 'span', _key: 'a', text: 'Read this now', marks: [] },
      { _type: 'span', _key: 'd', text: '!', marks: ['strong'] },
    ])
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
    expect(new Set(out[1].children.map((s) => s._key)).size).toBe(2)
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
    expect(out[0].children[0].text).toBe('')
  })

  it('returns [] for an empty or non-array value', () => {
    expect(normalizeBlocks(undefined)).toEqual([])
    expect(normalizeBlocks({})).toEqual([])
    expect(normalizeBlocks([block({ children: [span('')] })])).toEqual([])
  })

  it('respects the server size limits', () => {
    expect(BODY_LIMITS).toEqual({ blocks: LIMITS.blocks, spansPerBlock: LIMITS.spansPerBlock, spanText: LIMITS.spanText })
    const long = 'x'.repeat(LIMITS.spanText * 2 + 5)
    const many = Array.from({ length: LIMITS.spansPerBlock + 50 }, (_, i) => span('y', i % 2 ? ['em'] : [], `k${i}`))
    const out = roundTrip([
      block({ _key: 'long', children: [span(long, [], 'L')] }),
      block({ _key: 'many', children: many }),
      ...Array.from({ length: LIMITS.blocks + 3 }, (_, i) => block({ _key: `n${i}` })),
    ])
    expect(out).toHaveLength(LIMITS.blocks)
    expect(out[0].children.map((s) => s.text.length)).toEqual([LIMITS.spanText, LIMITS.spanText, 5])
    expect(out[1].children).toHaveLength(LIMITS.spansPerBlock)
  })
})

describe('textToBlocks', () => {
  it('turns lines into paragraphs and list markers into lists', () => {
    const out = textToBlocks('First line\r\n\n- one\n• two\n1. alpha\n2) beta\n\n  Last  ')
    expect(sanitizeBlocks(out)).toEqual(out)
    expect(out.map((b) => [b.listItem ?? 'p', b.children[0].text])).toEqual([
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
