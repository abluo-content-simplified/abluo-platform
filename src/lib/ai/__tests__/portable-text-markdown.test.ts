import { describe, it, expect } from 'vitest'
import { blocksToMarkdown, markdownToBlocks, parseInline, blocksPlainTextLength, collectHrefs } from '../portable-text-markdown'
import { normalizeBlocks } from '@/lib/client/normalize-blocks'
import { sanitizeBlocks } from '@/lib/api/post-drafts'

let n = 0
const key = () => `k${++n}`
const span = (text: string, marks: string[] = []) => ({ _type: 'span', _key: key(), text, marks })
const block = (children: ReturnType<typeof span>[], o: Record<string, unknown> = {}) => ({
  _type: 'block',
  _key: key(),
  style: 'normal',
  markDefs: [],
  children,
  ...o,
})

/** Compare ignoring keys. */
const shape = (blocks: unknown[]) =>
  (blocks as Array<Record<string, unknown>>).map((b) => ({
    style: b.style,
    listItem: b.listItem,
    level: b.level,
    children: (b.children as Array<{ text: string; marks: string[] }>).map((s) => [s.text, s.marks.join('+')]),
  }))

const ALL_STRUCTURES = [
  block([span('Perché la terapia funziona')], { style: 'h2' }),
  block([span('Un primo passo, '), span('davvero', ['strong']), span(' importante e '), span('sereno', ['em']), span('.')]),
  block([span('Größe & Übung — '), span('tutto insieme', ['strong', 'em']), span(' così.')]),
  block([span('Cosa aspettarsi')], { style: 'h3' }),
  block([span('Prima voce')], { listItem: 'bullet', level: 1 }),
  block([span('Sotto-voce')], { listItem: 'bullet', level: 2 }),
  block([span('Ancora più giù')], { listItem: 'bullet', level: 3 }),
  block([span('Livello quattro')], { listItem: 'bullet', level: 4 }),
  block([span('Di nuovo su')], { listItem: 'bullet', level: 1 }),
  block([span('Una citazione che resta.')], { style: 'blockquote' }),
  block([span('Uno')], { listItem: 'number', level: 1 }),
  block([span('Uno-a')], { listItem: 'number', level: 2 }),
  block([span('Due')], { listItem: 'number', level: 1 }),
  block([span('Fine con '), span('enfasi', ['em']), span(' e caratteri: è, à, ü, ß, ñ, ç.')]),
]

describe('blocksToMarkdown', () => {
  it('renders every supported structure', () => {
    expect(blocksToMarkdown(ALL_STRUCTURES)).toBe(
      [
        '## Perché la terapia funziona',
        '',
        'Un primo passo, **davvero** importante e *sereno*.',
        '',
        'Größe & Übung — ***tutto insieme*** così.',
        '',
        '### Cosa aspettarsi',
        '',
        '- Prima voce',
        '  - Sotto-voce',
        '    - Ancora più giù',
        '      - Livello quattro',
        '- Di nuovo su',
        '',
        '> Una citazione che resta.',
        '',
        '1. Uno',
        '  1. Uno-a',
        '2. Due',
        '',
        'Fine con *enfasi* e caratteri: è, à, ü, ß, ñ, ç.',
      ].join('\n')
    )
  })

  it('moves edge whitespace outside emphasis markers', () => {
    expect(blocksToMarkdown([block([span('a'), span(' bold ', ['strong']), span('b')])])).toBe('a **bold** b')
  })

  it('escapes literal markers and line starts so they survive the round-trip', () => {
    const tricky = [
      block([span('2 * 3 = 6 and snake_case and a \\ backslash')]),
      block([span('# not a heading')]),
      block([span('- not a list\n1. nor this\n> nor a quote')]),
    ]
    expect(shape(markdownToBlocks(blocksToMarkdown(tricky), key))).toEqual(shape(tricky))
  })
})

describe('round-trip PT → MD → PT', () => {
  it('preserves all supported structures, accents and nested lists', () => {
    const back = markdownToBlocks(blocksToMarkdown(ALL_STRUCTURES), key)
    expect(shape(back)).toEqual(shape(ALL_STRUCTURES))
  })

  it('output passes sanitizeBlocks unchanged', () => {
    const back = markdownToBlocks(blocksToMarkdown(ALL_STRUCTURES), key)
    expect(sanitizeBlocks(back)).toEqual(back)
  })

  it('keeps soft line breaks inside paragraphs and quotes', () => {
    const b = [block([span('riga uno\nriga due')]), block([span('q1\nq2')], { style: 'blockquote' })]
    expect(shape(markdownToBlocks(blocksToMarkdown(b), key))).toEqual(shape(b))
  })

  it('gives every block and span a fresh unique key', () => {
    const back = markdownToBlocks(blocksToMarkdown(ALL_STRUCTURES))
    const keys = back.flatMap((b) => [b._key, ...b.children.map((s) => s._key)])
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
  })
})

describe('round-trip MD → PT → MD', () => {
  it('is stable for canonical markdown', () => {
    const md = [
      '## Titolo',
      '',
      'Testo con **grassetto**, *corsivo* e ***entrambi***.',
      '',
      '- a',
      '  - b',
      '    1. c',
      '',
      '> citazione',
    ].join('\n')
    expect(blocksToMarkdown(markdownToBlocks(md, key))).toBe(md)
  })
})

describe('markdownToBlocks — forgiving of model output', () => {
  it('maps # to h2 and #### to h3', () => {
    const b = markdownToBlocks('# Big\n\n#### Small', key)
    expect(b.map((x) => x.style)).toEqual(['h2', 'h3'])
  })

  it('keeps link text, drops images, code fences, rules and HTML', () => {
    const md = [
      '```markdown',
      'Vedi [il sito](https://example.com) e <https://x.it>.',
      '',
      '![foto](https://img.example/x.png)',
      '',
      '---',
      '',
      'Uso `codice` e <b>tag</b>.',
      '```',
    ].join('\n')
    expect(shape(markdownToBlocks(md, key))).toEqual([
      { style: 'normal', listItem: undefined, level: undefined, children: [['Vedi il sito e https://x.it.', '']] },
      { style: 'normal', listItem: undefined, level: undefined, children: [['Uso codice e tag.', '']] },
    ])
  })

  it('accepts *, + and 4-space / 1) list variants, capping depth at 4', () => {
    const md = ['* a', '    + b', '        - c', '            - d', '                - e', '1) f'].join('\n')
    expect(markdownToBlocks(md, key).map((b) => [b.listItem, b.level])).toEqual([
      ['bullet', 1],
      ['bullet', 2],
      ['bullet', 3],
      ['bullet', 4],
      ['bullet', 4],
      ['number', 1],
    ])
  })

  it('accepts __bold__ and _italic_ but not intraword underscores', () => {
    expect(parseInline('__a__ _b_ snake_case_name', key).map((s) => [s.text, s.marks.join('+')])).toEqual([
      ['a', 'strong'],
      [' ', ''],
      ['b', 'em'],
      [' snake_case_name', ''],
    ])
  })

  it('leaves unmatched markers as literal text', () => {
    expect(parseInline('**solo aperto e 5 * 3', key).map((s) => s.text).join('')).toBe('**solo aperto e 5 * 3')
  })

  it('strips <draft> wrappers and returns [] for empty input', () => {
    expect(shape(markdownToBlocks('<draft>\nCiao\n</draft>', key))).toHaveLength(1)
    expect(markdownToBlocks('  \n\n', key)).toEqual([])
  })

  it('treats a lazy line after a list item as continuation', () => {
    const b = markdownToBlocks('- voce\ncontinua\n\nParagrafo', key)
    expect(shape(b).map((x) => x.children[0][0])).toEqual(['voce\ncontinua', 'Paragrafo'])
  })
})

describe('blocksPlainTextLength', () => {
  it('counts span text only and tolerates junk', () => {
    expect(blocksPlainTextLength([block([span('abc'), span('de')]), { children: 3 }, null])).toBe(5)
  })
})

describe('links', () => {
  const linked = () => [
    block([span('Scrivi a '), span('noi', ['L1']), span(' o leggi '), span('la guida', ['strong', 'L2']), span(' [non un link] e '), span('chiama', ['L3']), span('.')], {
      markDefs: [
        { _type: 'link', _key: 'L1', href: 'mailto:info@studio.it' },
        { _type: 'link', _key: 'L2', href: 'https://studio.it/guida_(2026)' },
        { _type: 'link', _key: 'L3', href: 'tel:+390544123456' },
      ],
    }),
    block([span('Contatti', ['L4'])], { style: 'h3', markDefs: [{ _type: 'link', _key: 'L4', href: '/contatti' }] }),
    block([span('voce '), span('qui', ['L5'])], { listItem: 'bullet', level: 1, markDefs: [{ _type: 'link', _key: 'L5', href: 'https://x.it/a?b=1&c=2#d' }] }),
  ]
  const linkShape = (blocks: unknown[]) =>
    (blocks as Array<{ style: string; markDefs: { _key: string; href: string }[]; children: { text: string; marks: string[] }[] }>).map((b) => ({
      style: b.style,
      spans: b.children.map((s) => [
        s.text,
        s.marks.filter((m) => m === 'strong' || m === 'em').join('+'),
        b.markDefs.find((d) => s.marks.includes(d._key))?.href ?? '',
      ]),
    }))

  it('renders links as [text](href), bare or <…> when parentheses would confuse', () => {
    const md = blocksToMarkdown(linked())
    expect(md).toContain('[noi](mailto:info@studio.it)')
    expect(md).toContain('[**la guida**](https://studio.it/guida_(2026))')
    expect(md).toContain('\\[non un link\\]')
    expect(md).toContain('### [Contatti](/contatti)')
    expect(md).toContain('- voce [qui](https://x.it/a?b=1&c=2#d)')
    expect(blocksToMarkdown([block([span('x', ['L'])], { markDefs: [{ _type: 'link', _key: 'L', href: 'https://x.it/a)b' }] })])).toBe(
      '[x](<https://x.it/a)b>)'
    )
  })

  it('round-trips links PT → MD → PT through normalize + sanitize when the hrefs are allowed', () => {
    const input = linked()
    const back = markdownToBlocks(blocksToMarkdown(input), key, { allowedHrefs: collectHrefs(input) })
    expect(linkShape(back)).toEqual(linkShape(input))
    const normalized = normalizeBlocks(back)
    expect(normalized).toEqual(back)
    expect(sanitizeBlocks(normalized)).toEqual(normalized)
  })

  it('keeps only the text of links the caller did not allow (a model must not invent links)', () => {
    const back = markdownToBlocks('Vedi [qui](https://evil.example) e [là](https://studio.it)', key, {
      allowedHrefs: new Set(['https://studio.it']),
    })
    expect(back[0].markDefs.map((d) => d.href)).toEqual(['https://studio.it'])
    expect(back[0].children.map((c) => c.text).join('')).toBe('Vedi qui e là')
    expect(markdownToBlocks('[qui](https://studio.it)', key)[0].markDefs).toEqual([])
  })

  it('never turns an unsafe href into a link, even if allowed', () => {
    const back = markdownToBlocks('[x](javascript:alert(1)) [y](//evil.example)', key, {
      allowedHrefs: new Set(['javascript:alert(1)', '//evil.example']),
    })
    expect(back[0].markDefs).toEqual([])
    expect(back[0].children.map((c) => c.text).join('')).toBe('x y')
  })

  it('collectHrefs lists only safe link hrefs', () => {
    expect([...collectHrefs([...linked(), block([span('z', ['B'])], { markDefs: [{ _type: 'link', _key: 'B', href: 'javascript:x' }] })])]).toEqual([
      'mailto:info@studio.it',
      'https://studio.it/guida_(2026)',
      'tel:+390544123456',
      '/contatti',
      'https://x.it/a?b=1&c=2#d',
    ])
  })
})
