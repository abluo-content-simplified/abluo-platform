// ── Testimonials module — shared constants (ADR-048) ──────────────────────────
// Pure and browser-safe: imported by the schema (Studio bundle), the services
// (server), the website projection and the dashboard (client).

export const TESTIMONIALS_MODULE_ID = 'testimonials'

/** Sanity document types owned by the module. */
export const TESTIMONIAL_TYPE = 'testimonial'
export const TESTIMONIALS_SECTION_TYPE = 'testimonialsSection'

/** Permissions (ADR-048 D8). `taxonomy` is the platform convention for modules with a vocabulary (Categories & Tags). */
export const TESTIMONIAL_PERMISSIONS = {
  read: 'testimonials.read',
  write: 'testimonials.write',
  privateRead: 'testimonials.private.read',
  delete: 'testimonials.delete',
  taxonomy: 'testimonials.taxonomy.write',
} as const

/** Where a testimonial came from (D2) — attribution only, never a "verified" badge. */
export const TESTIMONIAL_SOURCES = ['website', 'google', 'facebook', 'trustpilot', 'other'] as const
export type TestimonialSource = (typeof TESTIMONIAL_SOURCES)[number]

/** Which testimonials a section shows (D5). */
export const TESTIMONIAL_SELECTIONS = ['featured', 'latest', 'tag', 'selected'] as const
export type TestimonialSelection = (typeof TESTIMONIAL_SELECTIONS)[number]
export const DEFAULT_TESTIMONIAL_SELECTION: TestimonialSelection = 'featured'

/** Section layouts (D5). A single large quote can come later as a third layout. */
export const TESTIMONIAL_LAYOUTS = ['carousel', 'grid'] as const
export type TestimonialLayout = (typeof TESTIMONIAL_LAYOUTS)[number]
export const DEFAULT_TESTIMONIAL_LAYOUT: TestimonialLayout = 'carousel'

/** How many testimonials a section shows by default / at most. */
export const DEFAULT_TESTIMONIAL_LIMIT = 6
export const MAX_TESTIMONIAL_LIMIT = 24

/** The taxonomy kind holding the "Testimonials" vocabulary in Categories & Tags (ADR-020 B / Amendment J). */
export const TESTIMONIAL_TAG_KIND = 'tag' as const

/** Phase 2 (D4) — the module-owned Forms definition. Stable form id recorded on every submission. */
export const TESTIMONIAL_FORM_ID = 'testimonial'
/** Stable internal keys of the form's fields — the keys of `submission_data`. */
export const TESTIMONIAL_FORM_KEYS = {
  displayName: 'display_name',
  /** `name` on purpose: the Contact-requests row mapping reads `submission_data.name`. */
  fullName: 'name',
  email: 'email',
  phone: 'phone',
  text: 'testimonial',
  rating: 'rating',
} as const
export const TESTIMONIAL_FORM_STEP_KEY = 'testimonial'

/** Module config key (D10). */
export const TESTIMONIAL_ACCEPT_SUBMISSIONS_KEY = 'acceptSubmissions'
/** Module config key: show an optional photo on testimonials (off by default). */
export const TESTIMONIAL_SHOW_PHOTOS_KEY = 'showPhotos'

export const TESTIMONIAL_LIMITS = {
  displayName: 120,
  context: 200,
  abstract: 600,
  body: 5000,
  sourceUrl: 500,
  age: 120,
  testimonials: 5000,
  patchBytes: 200_000,
} as const

/** Sentence-case Studio helper: the rating bounds. */
export const TESTIMONIAL_RATING = { min: 1, max: 5 } as const

/** The text fields that are localized (all take part in Translate, ADR-023). */
export const TESTIMONIAL_LOCALIZED_FIELDS = ['context', 'abstract', 'body'] as const
export type TestimonialLocalizedField = (typeof TESTIMONIAL_LOCALIZED_FIELDS)[number]

/** The card title: the name as the person wants it, or nothing when anonymous (the renderer shows the dictionary label). */
export function testimonialDisplayName(t: { displayName?: unknown; anonymous?: unknown } | null | undefined): string {
  if (!t || t.anonymous === true) return ''
  return typeof t.displayName === 'string' ? t.displayName.trim() : ''
}
