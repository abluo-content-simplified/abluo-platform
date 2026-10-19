/**
 * Which document types an internal body link may point at (ADR-025 · links
 * round 2, ADR-037 D12). Pure constants, no imports: shared by the Studio
 * schema (`bodyLinkAnnotation`), the website resolver (`link-target.ts`) and
 * the dashboard link search, so the three can never disagree.
 */

/** Types the dashboard link search offers today (post editor). */
export const LINK_TARGET_TYPES = ['page', 'post', 'newsArticle', 'event'] as const
export type LinkTargetType = (typeof LINK_TARGET_TYPES)[number]

/**
 * Catalogue items and collections (ADR-037 D12, Tom 2026-10-19). Resolved
 * through the Catalogue module's own public segment; plain text while the
 * module is not installed, the target has no page, or it is not public.
 */
export const CATALOGUE_LINK_TARGET_TYPES = ['catalogueItem', 'catalogueCollection'] as const

/** Every type `bodyLinkAnnotation.internal` may reference. */
export const BODY_LINK_TARGET_TYPES = [...LINK_TARGET_TYPES, ...CATALOGUE_LINK_TARGET_TYPES] as const
export type BodyLinkTargetType = (typeof BODY_LINK_TARGET_TYPES)[number]
