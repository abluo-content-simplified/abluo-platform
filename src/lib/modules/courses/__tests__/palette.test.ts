/**
 * The course colour palette (Tom, 2026-11-08): six colours derived from the
 * site's primary, readable text on their tint, different enough from each
 * other (also in lightness, for colour-blind readers), legacy values read
 * without a migration, and the CSS every reader uses.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio, parseColor } from '@/lib/design-system/contrast'
import {
  COURSE_COLORS,
  COURSE_PALETTE_KEYS,
  COURSE_TEXT_CONTRAST,
  courseColorVar,
  coursePalette,
  coursePaletteCssVars,
  coursePalettePrintCss,
  courseTintStyle,
  isCourseColor,
  normalizeCourseColor,
  oklabDistance,
  rgbToOklch,
} from '../palette'

const rgb = (s: string) => parseColor(s)!.rgb
const PRIMARIES = ['#0A6CFF', '#E4572E', '#2E7D32', '#6A1B9A', '#F2C14E', '#111111', '#FFFFFF', 'oklch(0.62 0.045 220deg)', 'rgb(0 150 136)', '#ff00ff', 'not a colour', null]
const SURFACES = { light: ['#ffffff', '#f7f3ea', 'oklch(1 0 0)'], dark: ['#111114', '#1e1f24', 'oklch(0.205 0.006 271.1)'] } as const

describe('legacy and stored values', () => {
  it('accent → c1, muted → c6, current keys stay, anything else → none (no data migration)', () => {
    expect(normalizeCourseColor('accent')).toBe('c1')
    expect(normalizeCourseColor('muted')).toBe('c6')
    for (const c of COURSE_COLORS) expect(normalizeCourseColor(c)).toBe(c)
    for (const v of [undefined, null, '', 'red', 7, 'c7']) expect(normalizeCourseColor(v)).toBe('none')
  })

  it('only current keys can be saved; the keys are meaning-free and stable', () => {
    expect(COURSE_COLORS).toEqual(['none', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6'])
    expect(isCourseColor('c3')).toBe(true)
    expect(isCourseColor('accent')).toBe(false)
    expect(isCourseColor('muted')).toBe(false)
  })
})

describe('coursePalette', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const surface of SURFACES[theme]) {
      for (const primary of PRIMARIES) {
        it(`${theme} on ${surface}, primary ${primary}: text ≥ 4.5:1 on its tint and on the surface`, () => {
          const p = coursePalette({ primary, surface, theme })
          for (const key of COURSE_PALETTE_KEYS) {
            const { bg, fg } = p[key]
            expect(contrastRatio(rgb(fg), rgb(bg))).toBeGreaterThanOrEqual(COURSE_TEXT_CONTRAST)
            expect(contrastRatio(rgb(fg), rgb(surface))).toBeGreaterThanOrEqual(COURSE_TEXT_CONTRAST)
          }
        })
      }
    }
  }

  it('the six dots differ clearly from each other — in hue AND lightness — in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      for (const primary of PRIMARIES) {
        const p = coursePalette({ primary, surface: SURFACES[theme][0], theme })
        const dots = COURSE_PALETTE_KEYS.map((k) => rgb(p[k].dot))
        for (let i = 0; i < dots.length; i++) for (let j = i + 1; j < dots.length; j++) expect(oklabDistance(dots[i], dots[j])).toBeGreaterThan(0.08)
        // Neighbours differ in lightness (what colour-blind readers rely on), and the set spans a wide range.
        const l = dots.map((d) => rgbToOklch(d).l)
        for (let i = 0; i < l.length - 1; i++) expect(Math.abs(l[i] - l[i + 1])).toBeGreaterThan(0.05)
        expect(Math.max(...l) - Math.min(...l)).toBeGreaterThan(0.2)
      }
    }
  })

  it('colour 1 has the primary hue; the tint stays close to the surface', () => {
    const p = coursePalette({ primary: '#E4572E', surface: '#ffffff', theme: 'light' })
    const dh = Math.abs(rgbToOklch(rgb(p.c1.dot)).h - rgbToOklch(rgb('#E4572E')).h)
    expect(Math.min(dh, 360 - dh)).toBeLessThan(6)
    for (const k of COURSE_PALETTE_KEYS) expect(rgbToOklch(rgb(p[k].bg)).l).toBeGreaterThan(0.88)
    const d = coursePalette({ primary: '#E4572E', surface: '#111114', theme: 'dark' })
    for (const k of COURSE_PALETTE_KEYS) expect(rgbToOklch(rgb(d[k].bg)).l).toBeLessThan(0.4)
  })

  it('is pure: same input, same output', () => {
    expect(coursePalette({ primary: '#0A6CFF', surface: '#fff', theme: 'light' })).toEqual(coursePalette({ primary: '#0A6CFF', surface: '#fff', theme: 'light' }))
  })
})

describe('CSS', () => {
  it('one variable per key and shade', () => {
    const css = coursePaletteCssVars(coursePalette({ primary: '#0A6CFF', surface: '#fff', theme: 'light' }), '')
    for (const k of COURSE_PALETTE_KEYS) for (const s of ['bg', 'fg', 'dot'] as const) expect(css).toContain(`${courseColorVar(k, s)}: rgb(`)
    expect(css.trim().split('\n')).toHaveLength(18)
  })

  it('print is black and white', () => {
    const css = coursePalettePrintCss()
    expect(css).toMatch(/^@media print \{ :root \{/)
    expect(css).toContain('--course-c1-bg: transparent')
    expect(css).toContain('--course-c6-dot: currentColor')
  })

  it('tint style uses the variables only; none → nothing', () => {
    expect(courseTintStyle('none')).toEqual({})
    expect(courseTintStyle('c2')).toEqual({ backgroundColor: 'var(--course-c2-bg)', borderLeft: '3px solid var(--course-c2-dot)' })
    expect(courseTintStyle('c2', { background: false })).toEqual({ borderLeft: '3px solid var(--course-c2-dot)' })
  })
})
