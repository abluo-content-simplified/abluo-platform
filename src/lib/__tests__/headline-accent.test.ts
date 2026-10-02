import { describe, it, expect } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { splitLastWord, lastContentLineIndex, renderHeadline, accentsLine } from '@/lib/headline-accent'

describe('splitLastWord', () => {
  it('splits a normal sentence at the final space', () => {
    expect(splitLastWord('A Reservation Engine for Hospitality Platforms')).toEqual({
      head: 'A Reservation Engine for Hospitality ',
      accent: 'Platforms',
    })
  })

  it('accents the whole string for a one-word headline', () => {
    expect(splitLastWord('Platforms')).toEqual({ head: '', accent: 'Platforms' })
  })

  it('keeps trailing punctuation attached to the accented word', () => {
    expect(splitLastWord('Infrastructure that disappears.')).toEqual({
      head: 'Infrastructure that ',
      accent: 'disappears.',
    })
  })

  it('ignores trailing whitespace rather than accenting nothing', () => {
    expect(splitLastWord('Hospitality Platforms.  \n')).toEqual({
      head: 'Hospitality ',
      accent: 'Platforms.',
    })
  })

  it('treats a newline as a separator — accents the last word of the last line', () => {
    expect(splitLastWord('White-label engines\nfor Hospitality Platforms.')).toEqual({
      head: 'White-label engines\nfor Hospitality ',
      accent: 'Platforms.',
    })
  })

  it('accents the whole final line when that line is a single word', () => {
    expect(splitLastWord('Built for\nPlatforms.')).toEqual({
      head: 'Built for\n',
      accent: 'Platforms.',
    })
  })

  it('collapses nothing — repeated spaces stay in the head', () => {
    expect(splitLastWord('one   two')).toEqual({ head: 'one   ', accent: 'two' })
  })

  it('returns empty parts for an empty or whitespace-only headline', () => {
    expect(splitLastWord('')).toEqual({ head: '', accent: '' })
    expect(splitLastWord('   \n ')).toEqual({ head: '', accent: '' })
  })
})

describe('lastContentLineIndex', () => {
  it('returns the last line with a word in it', () => {
    expect(lastContentLineIndex(['One', 'Two'])).toBe(1)
  })

  it('skips an empty trailing line', () => {
    expect(lastContentLineIndex(['One', 'Two', ''])).toBe(1)
    expect(lastContentLineIndex(['One', 'Two', '   '])).toBe(1)
  })

  it('returns -1 when no line has content', () => {
    expect(lastContentLineIndex([])).toBe(-1)
    expect(lastContentLineIndex(['', '  '])).toBe(-1)
  })
})

describe('renderHeadline', () => {
  // 'none' must be byte-identical to rendering the raw string: the helper
  // returns the very same string, not a wrapping element.
  it('returns the input untouched for none / undefined / null', () => {
    expect(renderHeadline('Hospitality Platforms', 'none')).toBe('Hospitality Platforms')
    expect(renderHeadline('Hospitality Platforms', undefined)).toBe('Hospitality Platforms')
    expect(renderHeadline('Hospitality Platforms', null)).toBe('Hospitality Platforms')
  })

  it('returns the falsy input untouched', () => {
    expect(renderHeadline(undefined, 'lastWord')).toBeUndefined()
    expect(renderHeadline(null, 'lastWord')).toBeNull()
    expect(renderHeadline('', 'lastWord')).toBe('')
  })

  it('returns the input untouched when the headline is whitespace only', () => {
    expect(renderHeadline('   ', 'lastWord')).toBe('   ')
  })

  it('wraps the last word in a primary-coloured span', () => {
    const out = renderHeadline('Hospitality Platforms.', 'lastWord') as {
      props: { children: [string, { props: { style: { color: string }; children: string } }] }
    }
    const [head, span] = out.props.children
    expect(head).toBe('Hospitality ')
    expect(span.props.children).toBe('Platforms.')
    expect(span.props.style.color).toBe('var(--color-primary)')
  })

  it('wraps the whole of a one-word headline', () => {
    const out = renderHeadline('Platforms', 'lastWord') as {
      props: { children: [string, { props: { children: string } }] }
    }
    const [head, span] = out.props.children
    expect(head).toBe('')
    expect(span.props.children).toBe('Platforms')
  })
})

// Render through React so the assertions are on real markup, not element shapes.
const html = (node: ReactNode) => renderToStaticMarkup(createElement('h1', null, node))
const ACC = (s: string) => `<span style="color:var(--color-primary)">${s}</span>`

describe('renderHeadline — markup is unchanged for lastWord', () => {
  it('lastWord on a multi-line headline still accents only the last line', () => {
    expect(html(renderHeadline('Tired? Yoga!\nAt peace? Yoga!', 'lastWord'))).toBe(
      `<h1>Tired? Yoga!\nAt peace? ${ACC('Yoga!')}</h1>`,
    )
  })
})

describe('renderHeadline — lastWordEachLine', () => {
  it('accents the last word of every line and keeps the line breaks', () => {
    expect(
      html(renderHeadline('Are you tired? Yoga!\nAre you looking for peace? Yoga!', 'lastWordEachLine')),
    ).toBe(`<h1>Are you tired? ${ACC('Yoga!')}\nAre you looking for peace? ${ACC('Yoga!')}</h1>`)
  })

  it('behaves like lastWord on a single line', () => {
    expect(html(renderHeadline('Êtes-vous fatigué ? Yoga!', 'lastWordEachLine'))).toBe(
      html(renderHeadline('Êtes-vous fatigué ? Yoga!', 'lastWord')),
    )
  })

  it('leaves an empty line alone instead of emitting an empty span', () => {
    expect(html(renderHeadline('One two\n\nThree four', 'lastWordEachLine'))).toBe(
      `<h1>One ${ACC('two')}\n\nThree ${ACC('four')}</h1>`,
    )
  })

  it('accents a one-word line whole', () => {
    expect(html(renderHeadline('Breathe\nYoga!', 'lastWordEachLine'))).toBe(
      `<h1>${ACC('Breathe')}\n${ACC('Yoga!')}</h1>`,
    )
  })
})

describe('renderHeadline — all', () => {
  it('wraps the whole headline in one accent span', () => {
    expect(html(renderHeadline('Enjoy your practice!', 'all'))).toBe(`<h1>${ACC('Enjoy your practice!')}</h1>`)
  })

  it('returns a whitespace-only headline untouched', () => {
    expect(renderHeadline('  ', 'all')).toBe('  ')
  })
})

describe('renderHeadline — unknown values degrade to plain text', () => {
  it('returns the raw string for a value this renderer does not know', () => {
    expect(renderHeadline('Bonne pratique!', 'somethingNewer')).toBe('Bonne pratique!')
  })
})

describe('accentsLine — which hero lines get the accent', () => {
  it('lastWord: only the last content line', () => {
    expect([0, 1, 2].map((i) => accentsLine('lastWord', i, 1))).toEqual([false, true, false])
  })

  it('lastWordEachLine and all: every line', () => {
    expect([0, 1].map((i) => accentsLine('lastWordEachLine', i, 1))).toEqual([true, true])
    expect([0, 1].map((i) => accentsLine('all', i, 1))).toEqual([true, true])
  })

  it('none / null / unknown: no line', () => {
    for (const a of ['none', null, undefined, 'bogus']) {
      expect([0, 1].map((i) => accentsLine(a, i, 1))).toEqual([false, false])
    }
  })
})
