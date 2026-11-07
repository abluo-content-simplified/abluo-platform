/** The course page address helpers shared by the dashboard editor and the service (ADR-045 D5). */
import { describe, expect, it } from 'vitest'
import { COURSE_SLUG_MAX, COURSE_SLUG_PATTERN, courseSlugFrom, slugFollowingTitle, uniqueCourseSlug } from '../slug'

describe('courseSlugFrom', () => {
  it('turns a title or a typed address into one url segment', () => {
    expect(courseSlugFrom('Iyengar Yoga')).toBe('iyengar-yoga')
    expect(courseSlugFrom('  Méditation / Pleine conscience ')).toBe('meditation-pleine-conscience')
    expect(courseSlugFrom('Yoga für Anfänger (Level 2)')).toBe('yoga-fur-anfanger-level-2')
    expect(courseSlugFrom('!!!')).toBe('')
    expect(courseSlugFrom(null)).toBe('')
    const long = courseSlugFrom('a '.repeat(100))
    expect(long.length).toBeLessThanOrEqual(COURSE_SLUG_MAX)
    expect(COURSE_SLUG_PATTERN.test(long)).toBe(true)
  })
  it('uniqueCourseSlug numbers a taken address', () => {
    expect(uniqueCourseSlug('yoga', new Set())).toBe('yoga')
    expect(uniqueCourseSlug('yoga', new Set(['yoga', 'yoga-2']))).toBe('yoga-3')
  })
})

describe('slugFollowingTitle — the editor default', () => {
  it('a never-published course: the address follows the title while it is empty or still the generated one', () => {
    expect(slugFollowingTitle({ published: false, slug: '', oldTitle: '', newTitle: 'Iyengar' })).toBe('iyengar')
    expect(slugFollowingTitle({ published: false, slug: 'iyengar', oldTitle: 'Iyengar', newTitle: 'Iyengar Yoga' })).toBe('iyengar-yoga')
    expect(slugFollowingTitle({ published: false, slug: 'iyengar-yoga', oldTitle: 'Iyengar Yoga', newTitle: 'Iyengar Yoga ' })).toBeNull()
  })
  it('an address typed by hand is never overwritten', () => {
    expect(slugFollowingTitle({ published: false, slug: 'my-own', oldTitle: 'Iyengar', newTitle: 'Iyengar Yoga' })).toBeNull()
  })
  it('a published course keeps its address whatever the title does', () => {
    expect(slugFollowingTitle({ published: true, slug: 'iyengar', oldTitle: 'Iyengar', newTitle: 'Hatha' })).toBeNull()
    expect(slugFollowingTitle({ published: true, slug: '', oldTitle: '', newTitle: 'Hatha' })).toBeNull()
  })
})
