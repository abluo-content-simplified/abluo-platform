import { describe, expect, it } from 'vitest'
import { easingDefinitionToFunction } from 'motion-utils'
import { NAMED_EASINGS, resolveEasing, type ResolvedEasing } from '../easing'

const FALLBACK: ResolvedEasing = [0.0, 0.0, 0.2, 1]

describe('resolveEasing', () => {
  describe('CSS cubic-bezier strings', () => {
    it('parses the canonical design-system decelerate curve', () => {
      expect(resolveEasing('cubic-bezier(0, 0, 0.2, 1)', FALLBACK)).toEqual([0, 0, 0.2, 1])
    })

    it('parses a string with no spaces', () => {
      expect(resolveEasing('cubic-bezier(0.4,0,0.2,1)', FALLBACK)).toEqual([0.4, 0, 0.2, 1])
    })

    it('parses a string with irregular whitespace, including tabs and newlines', () => {
      expect(resolveEasing('  cubic-bezier(  0.4 ,\t0 ,\n0.2 , 1 )  ', FALLBACK)).toEqual([
        0.4, 0, 0.2, 1,
      ])
    })

    it('parses decimals with and without a leading zero', () => {
      expect(resolveEasing('cubic-bezier(.25, .1, .25, 1.0)', FALLBACK)).toEqual([
        0.25, 0.1, 0.25, 1,
      ])
    })

    it('parses negative control points (legal per the CSS spec for y values)', () => {
      expect(resolveEasing('cubic-bezier(0.68, -0.55, 0.265, 1.55)', FALLBACK)).toEqual([
        0.68, -0.55, 0.265, 1.55,
      ])
    })

    it('is case-insensitive on the function name', () => {
      expect(resolveEasing('Cubic-Bezier(0, 0, 1, 1)', FALLBACK)).toEqual([0, 0, 1, 1])
    })

    it('falls back on a cubic-bezier with the wrong number of arguments', () => {
      expect(resolveEasing('cubic-bezier(0, 0, 0.2)', FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing('cubic-bezier(0, 0, 0.2, 1, 1)', FALLBACK)).toBe(FALLBACK)
    })

    it('falls back on a malformed cubic-bezier', () => {
      expect(resolveEasing('cubic-bezier(', FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing('cubic-bezier(a, b, c, d)', FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing('cubic-bezier(0, 0, 0.2, 1) !important', FALLBACK)).toBe(FALLBACK)
    })

    it('falls back on other CSS easing functions motion cannot consume', () => {
      expect(resolveEasing('ease-in-out', FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing('steps(4, end)', FALLBACK)).toBe(FALLBACK)
    })
  })

  describe('arrays', () => {
    it('passes a valid 4-number array through unchanged', () => {
      const input = [0.4, 0, 0.2, 1]
      expect(resolveEasing(input, FALLBACK)).toBe(input)
    })

    it('accepts negative and out-of-unit-range numbers in an array', () => {
      expect(resolveEasing([0.68, -0.55, 0.265, 1.55], FALLBACK)).toEqual([
        0.68, -0.55, 0.265, 1.55,
      ])
    })

    it('falls back on a wrong-length array', () => {
      expect(resolveEasing([0, 0, 0.2], FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing([0, 0, 0.2, 1, 1], FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing([], FALLBACK)).toBe(FALLBACK)
    })

    it('falls back on an array containing non-finite or non-numeric entries', () => {
      expect(resolveEasing(['0', '0', '0.2', '1'], FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing([0, 0, NaN, 1], FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing([0, 0, Infinity, 1], FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing([0, 0, null, 1], FALLBACK)).toBe(FALLBACK)
    })
  })

  describe('named easings', () => {
    it.each(NAMED_EASINGS)('passes motion easing "%s" through unchanged', (name) => {
      expect(resolveEasing(name, FALLBACK)).toBe(name)
    })

    it('trims surrounding whitespace around a named easing', () => {
      expect(resolveEasing('  easeOut  ', FALLBACK)).toBe('easeOut')
    })

    it('falls back on names motion does not accept', () => {
      expect(resolveEasing('easeout', FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing('ease', FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing('bounce', FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing('spring', FALLBACK)).toBe(FALLBACK)
    })
  })

  describe('empty and unsupported values', () => {
    it('falls back on null and undefined — the path every live tenant takes today', () => {
      expect(resolveEasing(null, FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing(undefined, FALLBACK)).toBe(FALLBACK)
    })

    it('falls back on empty and whitespace-only strings', () => {
      expect(resolveEasing('', FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing('   ', FALLBACK)).toBe(FALLBACK)
    })

    it('falls back on values of the wrong type', () => {
      expect(resolveEasing(0.5, FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing(true, FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing({ ease: 'easeOut' }, FALLBACK)).toBe(FALLBACK)
      expect(resolveEasing(() => 0.5, FALLBACK)).toBe(FALLBACK)
    })

    it('returns the exact fallback instance it was given, including a named one', () => {
      expect(resolveEasing(null, 'easeInOut')).toBe('easeInOut')
    })

    it('never throws, whatever it is handed', () => {
      const hostile: unknown[] = [
        Symbol('x'),
        new Map(),
        Object.create(null),
        'cubic-bezier(NaN, NaN, NaN, NaN)',
      ]
      for (const value of hostile) {
        expect(() => resolveEasing(value, FALLBACK)).not.toThrow()
        expect(resolveEasing(value, FALLBACK)).toBe(FALLBACK)
      }
    })
  })

  describe('motion compatibility (the actual bug)', () => {
    // motion throws `Invalid easing type 'cubic-bezier(...)'` on CSS strings,
    // which unmounts SlideUp/FadeIn and renders the section blank.
    it('confirms motion rejects the raw design-system value', () => {
      expect(() => easingDefinitionToFunction('cubic-bezier(0, 0, 0.2, 1)' as Parameters<typeof easingDefinitionToFunction>[0])).toThrow()
    })

    it('produces a value motion accepts for every supported input form', () => {
      const inputs: unknown[] = [
        'cubic-bezier(0, 0, 0.2, 1)',
        'cubic-bezier(0.4, 0, 0.2, 1)',
        'cubic-bezier(0.4, 0, 1, 1)',
        'cubic-bezier(0.2, 0, 0, 1)',
        [0.4, 0, 0.2, 1],
        ...NAMED_EASINGS,
        null,
        undefined,
        'nonsense',
        [1, 2],
      ]
      for (const input of inputs) {
        const resolved = resolveEasing(input, FALLBACK)
        expect(() =>
          easingDefinitionToFunction(resolved as Parameters<typeof easingDefinitionToFunction>[0]),
        ).not.toThrow()
      }
    })
  })
})
