// ── Courses module — the course page address (ADR-045 D5) ─────────────────────
// Pure and browser-safe: the dashboard editor suggests an address from the
// title with it, and the service normalises typed addresses and fills missing
// ones on publish with the very same function.

import { slugifyNestedPath } from '@/lib/sanity/fields/nested-slug'

/** One URL segment per language: lowercase letters, numbers, single hyphens. */
export const COURSE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const COURSE_SLUG_MAX = 80

/** A typed address or a title → one URL segment ("Iyengar Yoga (Level 2)" → "iyengar-yoga-level-2"); '' when nothing usable is left. */
export function courseSlugFrom(text: string | null | undefined): string {
  if (typeof text !== 'string') return ''
  // A course address is a single segment — "/" is a word break here.
  return slugifyNestedPath(text.replace(/\//g, ' '), COURSE_SLUG_MAX).replace(/-+$/, '')
}

/** `base`, else `base-2`, `base-3`, … — whichever is not in `taken`; always ≤ COURSE_SLUG_MAX. */
export function uniqueCourseSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, COURSE_SLUG_MAX - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * The dashboard editor's rule while the title is typed: before the course is
 * first published, the address follows the title — unless it was typed by
 * hand (it no longer equals what the old title gave). Returns the new address,
 * or null = leave the address alone. A published course never changes its
 * address by itself (that would move a live page).
 */
export function slugFollowingTitle(input: { published: boolean; slug: string | null | undefined; oldTitle: string | null | undefined; newTitle: string }): string | null {
  if (input.published) return null
  const current = input.slug ?? ''
  if (current && current !== courseSlugFrom(input.oldTitle)) return null
  const next = courseSlugFrom(input.newTitle)
  return next === current ? null : next
}
