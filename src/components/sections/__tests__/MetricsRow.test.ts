import { describe, expect, it } from 'vitest'
import { splitAccentFragment } from '../MetricsRow'

/**
 * The accent fragment inside a metric value.
 *
 * tmz.it paints the ½ of "4½" in the accent colour — a fragment INSIDE an
 * otherwise plain string, not a separate field. The split happens in code so an
 * editor types "4½" and gets the treatment, rather than being asked to mark up
 * a span they cannot see the point of.
 */
describe('splitAccentFragment', () => {
  it('peels a vulgar fraction off the end', () => {
    expect(splitAccentFragment('4½')).toEqual({ body: '4', accent: '½' })
    expect(splitAccentFragment('2¾')).toEqual({ body: '2', accent: '¾' })
  })

  it('peels a trailing plus', () => {
    // "30+" and "25+" — the + is the qualifier, and painting it accent is what
    // stops the eye reading the figure as exact.
    expect(splitAccentFragment('30+')).toEqual({ body: '30', accent: '+' })
    expect(splitAccentFragment('25+')).toEqual({ body: '25', accent: '+' })
  })

  it('leaves a plain figure alone', () => {
    // "3" (companies founded) has nothing to accent, and must not gain one.
    expect(splitAccentFragment('3')).toEqual({ body: '3', accent: '' })
    expect(splitAccentFragment('100')).toEqual({ body: '100', accent: '' })
  })

  it('refuses to leave an empty body', () => {
    // A value that is ONLY a fragment would render as an accent-coloured mark
    // with no figure in front of it. Return it whole instead.
    expect(splitAccentFragment('½')).toEqual({ body: '½', accent: '' })
    expect(splitAccentFragment('+')).toEqual({ body: '+', accent: '' })
  })

  it('only looks at the LAST character, not anywhere in the string', () => {
    // Not a general "find the symbols" pass. A "+" in the middle is part of the
    // figure and must not be lifted out of it.
    expect(splitAccentFragment('1+1')).toEqual({ body: '1+1', accent: '' })
    expect(splitAccentFragment('½ day')).toEqual({ body: '½ day', accent: '' })
  })

  it('handles an empty or missing value without throwing', () => {
    expect(splitAccentFragment('')).toEqual({ body: '', accent: '' })
  })

  it('leaves ordinary text alone', () => {
    // A metric whose "value" is a word, which the schema permits.
    expect(splitAccentFragment('Ongoing')).toEqual({ body: 'Ongoing', accent: '' })
  })
})
