// ── Testimonials module — website queries (ADR-048 D5) ────────────────────────
//
// Public delivery: every string here reads testimonials with TESTIMONIAL_PUBLIC
// (published, not archived, permission to publish, this project) and projects
// them with TESTIMONIAL_FIELDS. The public-delivery coverage test scans this
// file. Bind $projectSlug (fetchForTenant does), $locale and $defaultLocale.

import { TESTIMONIAL_FIELDS, TESTIMONIAL_ORDER, TESTIMONIAL_PUBLIC } from './projection'

/** Featured testimonials, newest first. Binds $limit. */
export const TESTIMONIALS_FEATURED_QUERY = /* groq */ `*[${TESTIMONIAL_PUBLIC} && featured == true] | order(${TESTIMONIAL_ORDER})[0...$limit]{ ${TESTIMONIAL_FIELDS} }`

/** The latest testimonials. Binds $limit. */
export const TESTIMONIALS_LATEST_QUERY = /* groq */ `*[${TESTIMONIAL_PUBLIC}] | order(${TESTIMONIAL_ORDER})[0...$limit]{ ${TESTIMONIAL_FIELDS} }`

/** Testimonials carrying one tag key. Binds $tagKey, $limit. */
export const TESTIMONIALS_BY_TAG_QUERY = /* groq */ `*[${TESTIMONIAL_PUBLIC} && $tagKey in tags] | order(${TESTIMONIAL_ORDER})[0...$limit]{ ${TESTIMONIAL_FIELDS} }`

/** Hand-picked testimonials by Sanity document id (the editor's order is applied in code). Binds $ids. */
export const TESTIMONIALS_BY_IDS_QUERY = /* groq */ `*[${TESTIMONIAL_PUBLIC} && _id in $ids]{ _id, ${TESTIMONIAL_FIELDS} }`
