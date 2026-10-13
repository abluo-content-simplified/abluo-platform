/**
 * ADR-032 D3 — the lifecycle types and the visibility rule each one uses.
 *
 * Every public delivery path (website queries, sitemap, llms.txt, references
 * dereferenced from public content) filters a lifecycle type with
 * `publicFilterFor(type)`. The coverage test in
 * `__tests__/public-delivery-coverage.test.ts` fails when a public query reads
 * one of these types without it.
 *
 *   post, newsArticle — 'required': no publishedAt = never public (unchanged).
 *   catalogue*        — 'optional' (ADR-033 D9, C1), as event and gallery.
 *   event, gallery    — 'optional': they carry no window fields yet (Phase 3),
 *                       so the rule reduces to "not archived" and every
 *                       existing document stays live with no migration.
 */

import { isPublicFilter, type PublishedAtRule } from './visibility'

export const LIFECYCLE_PUBLIC_RULES = {
  post: 'required',
  newsArticle: 'required',
  event: 'optional',
  gallery: 'optional',
  // ADR-033 D9/C1 — the catalogue adopts the lifecycle from day one. 'optional':
  // no publishedAt = live once published. `visibility` (public / websiteOnly /
  // unlisted) is NOT part of this rule, exactly as for events: it narrows
  // listing/sitemap/partner reach on top of it, and unlisted pages stay
  // reachable by link.
  catalogueItem: 'optional',
  catalogueCollection: 'optional',
  catalogueOptionList: 'optional',
  cataloguePage: 'optional',
} as const satisfies Record<string, PublishedAtRule>

export type LifecycleType = keyof typeof LIFECYCLE_PUBLIC_RULES

export const LIFECYCLE_TYPES = Object.keys(LIFECYCLE_PUBLIC_RULES) as LifecycleType[]

/**
 * GROQ boolean: is a document of `type` public right now.
 * `path` as in isPublicFilter — '' for the document itself, `'ref->'` for a
 * dereferenced field, `'@->'` inside an array filter.
 */
export function publicFilterFor(type: LifecycleType, path = ''): string {
  return isPublicFilter(LIFECYCLE_PUBLIC_RULES[type], path)
}

/**
 * GROQ boolean for a document whose type is only known at runtime (an
 * internal link target, a CTA target): lifecycle types use their rule, every
 * other type is not governed by the lifecycle and passes.
 */
export function publicFilterForAnyType(path = ''): string {
  const t = `${path}_type`
  const cases = LIFECYCLE_TYPES.map((type) => `${t} == "${type}" => ${publicFilterFor(type, path)}`).join(', ')
  return `select(${cases}, true)`
}
