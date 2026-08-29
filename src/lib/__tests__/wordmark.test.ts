import { describe, it, expect } from 'vitest'
import { splitWordmark, WORDMARK_ACCENT_STYLE } from '@/lib/wordmark'

describe('splitWordmark', () => {
  it('accents a single character present in the text', () => {
    expect(splitWordmark('No!Logo', '!')).toEqual([
      { text: 'No', accent: false },
      { text: '!', accent: true },
      { text: 'Logo', accent: false },
    ])
  })

  it('accents every occurrence of a character, not just the first', () => {
    expect(splitWordmark('a.b.c', '.')).toEqual([
      { text: 'a', accent: false },
      { text: '.', accent: true },
      { text: 'b', accent: false },
      { text: '.', accent: true },
      { text: 'c', accent: false },
    ])
  })

  it('accepts multiple accent characters', () => {
    expect(splitWordmark('No!Logo?', '!?')).toEqual([
      { text: 'No', accent: false },
      { text: '!', accent: true },
      { text: 'Logo', accent: false },
      { text: '?', accent: true },
    ])
  })

  it('merges adjacent accented characters into one run', () => {
    expect(splitWordmark('ab!!cd', '!')).toEqual([
      { text: 'ab', accent: false },
      { text: '!!', accent: true },
      { text: 'cd', accent: false },
    ])
  })

  it('returns one plain segment when the accent character is absent', () => {
    expect(splitWordmark('Livener', '!')).toEqual([{ text: 'Livener', accent: false }])
  })

  it('returns one plain segment when no accent is configured', () => {
    expect(splitWordmark('Livener')).toEqual([{ text: 'Livener', accent: false }])
    expect(splitWordmark('Livener', '')).toEqual([{ text: 'Livener', accent: false }])
    expect(splitWordmark('Livener', null)).toEqual([{ text: 'Livener', accent: false }])
  })

  it('accents the whole string when every character is listed', () => {
    expect(splitWordmark('abc', 'cba')).toEqual([{ text: 'abc', accent: true }])
  })

  it('is case-sensitive', () => {
    expect(splitWordmark('Oo', 'o')).toEqual([
      { text: 'O', accent: false },
      { text: 'o', accent: true },
    ])
  })

  it('ignores duplicates in the accent string', () => {
    expect(splitWordmark('No!Logo', '!!!')).toEqual([
      { text: 'No', accent: false },
      { text: '!', accent: true },
      { text: 'Logo', accent: false },
    ])
  })

  it('returns no segments for empty or absent text', () => {
    expect(splitWordmark('', '!')).toEqual([])
    expect(splitWordmark(undefined, '!')).toEqual([])
    expect(splitWordmark(null, '!')).toEqual([])
  })

  it('never splits an astral character down the middle', () => {
    expect(splitWordmark('a🎧b', '🎧')).toEqual([
      { text: 'a', accent: false },
      { text: '🎧', accent: true },
      { text: 'b', accent: false },
    ])
  })

  it('accents with a design-system token, never a literal colour', () => {
    expect(WORDMARK_ACCENT_STYLE.color).toBe('var(--color-primary)')
  })
})
