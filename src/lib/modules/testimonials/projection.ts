// ── Testimonials module — the ONE public projection of a testimonial (ADR-048 D5, D6) ──
//
// Every website read of a `testimonial` — a testimonials section, later a post
// or a course — projects it with TESTIMONIAL_FIELDS and nothing else, and only
// published, non-archived testimonials with permission to publish are read
// (TESTIMONIAL_PUBLIC). A test (__tests__/projection.test.ts) pins both.
//
// What is NOT here, on purpose: the Sanity `_id`, `projectSlug`, `permissionToPublish`
// (the filter decides), lifecycle dates, and anything private — full name, email,
// phone and notes live in Supabase testimonial_private and never reach Sanity.
// An anonymous testimonial's name is not projected at all.
//
// Why this file and not queries.ts: the Translate module's rule — "no website
// query in queries.ts may mention the translation-status field" — stays true.
// The status is projected here only as a derived boolean (`machine`), never as
// the raw object. (No backticks in the GROQ comments: these are JS template literals.)
//
// ── Language shape (D6) ───────────────────────────────────────────────────────
// `context`, `abstract` and `body` are each projected as
//
//     { text, locale, machine }
//
//   text    the text in the best available language, in this order:
//           the request language ($locale) → the language it was written in
//           (originalLocale) → the site default ($defaultLocale) → English
//   locale  the language `text` is actually in (a platform locale code)
//   machine true when that text is a stored machine translation that no person
//           has reviewed
//
// null when no language has text. normalizeTestimonial() then makes the card
// coherent: the card's language is the BODY's, and a context or abstract in
// another language is dropped, so a card is never mixed.

import { publicFilterFor } from '@/lib/lifecycle/public-types'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import type { ResolvedImage } from '@/lib/sanity/types'
import { TESTIMONIAL_TYPE, type TestimonialSource } from './model'

/** One language-resolved text field, as GROQ returns it. */
export interface TestimonialText {
  text: string
  /** The language `text` is in. */
  locale: string
  /** A machine translation nobody has reviewed. */
  machine: boolean
}

/** The optional photo: a Media Library image of this project, never of an anonymous testimonial. */
export type TestimonialPhoto = ResolvedImage & { lqip?: string | null }

/** A testimonial exactly as TESTIMONIAL_FIELDS returns it. */
export interface TestimonialRaw {
  publicId: string
  /** null when anonymous — the name is never projected then. */
  displayName?: string | null
  anonymous?: boolean | null
  age?: number | null
  rating?: number | null
  /** YYYY-MM-DD */
  givenOn?: string | null
  source?: TestimonialSource | null
  sourceUrl?: string | null
  featured?: boolean | null
  /** Testimonials tag keys (Categories & Tags). */
  tags?: string[] | null
  /** The language it was written in (platform locale code). */
  originalLocale?: string | null
  /** Only when the module setting `showPhotos` is on is it shown (hydrateTestimonialsSection drops it otherwise). */
  photo?: TestimonialPhoto | null
  context?: TestimonialText | null
  abstract?: TestimonialText | null
  body?: TestimonialText | null
}

/** One resolved branch of a text field. `access` is the GROQ accessor for the language. */
function branch(field: string, access: string, locale: string): string {
  return `{ "text": ${field}${access}, "locale": ${locale}, "machine": ${field}.translationStatus${access}.status == "machine" }`
}

/**
 * A localized text field as `{ text, locale, machine }` in the best available
 * language (see the header). Generated from the platform locale registry — no
 * locale is hardcoded here.
 */
export function resolvedText(field: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) throw new Error(`resolvedText: bad field "${field}"`)
  const original = LOCALE_CODES.map((code) => `originalLocale == "${code}" && defined(${field}.${code}) => ${branch(field, `.${code}`, `"${code}"`)}`)
  return /* groq */ `select(
      defined(${field}[$locale]) => ${branch(field, '[$locale]', '$locale')},
      ${original.join(',\n      ')},
      defined(${field}[$defaultLocale]) => ${branch(field, '[$defaultLocale]', '$defaultLocale')},
      defined(${field}.en) => ${branch(field, '.en', '"en"')}
    )`
}

/**
 * Visible on the website right now: this project's, published (never a draft),
 * not archived, not unpublished, and the person gave permission (D2).
 * Needs $projectSlug.
 */
export const TESTIMONIAL_PUBLIC = /* groq */ `_type == "${TESTIMONIAL_TYPE}" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && permissionToPublish == true && ${publicFilterFor('testimonial')}`

/** Newest first: the day it was given, else when it was created. */
export const TESTIMONIAL_ORDER = /* groq */ `coalesce(givenOn, _createdAt) desc, _createdAt desc`

/** Needs $locale and $defaultLocale, like every website query. */
export const TESTIMONIAL_FIELDS = /* groq */ `
    publicId,
    "displayName": select(anonymous == true => null, displayName),
    "anonymous": coalesce(anonymous, false),
    age,
    rating,
    givenOn,
    source,
    sourceUrl,
    "featured": coalesce(featured, false),
    "tags": coalesce(tags, []),
    originalLocale,
    "photo": select(anonymous != true && photo->projectSlug == $projectSlug => photo->{
      "asset": image.asset,
      "hotspot": image.hotspot,
      "crop": image.crop,
      "lqip": image.asset->metadata.lqip
    }),
    "context": ${resolvedText('context')},
    "abstract": ${resolvedText('abstract')},
    "body": ${resolvedText('body')}
`

/** Top-level keys of TESTIMONIAL_FIELDS — the whitelist the projection test enforces. */
export const TESTIMONIAL_PUBLIC_KEYS = [
  'publicId',
  'displayName',
  'anonymous',
  'age',
  'rating',
  'givenOn',
  'source',
  'sourceUrl',
  'featured',
  'tags',
  'originalLocale',
  'photo',
  'context',
  'abstract',
  'body',
] as const satisfies readonly (keyof TestimonialRaw)[]

// ── The card the website renders ──────────────────────────────────────────────

/** What the card says about the language of its text (D6), as data — the renderer words it from its dictionary. */
export type TestimonialLanguageNote =
  /** A machine translation of what the person wrote in `from`: "Translated from French". */
  | { kind: 'translated'; from: string }
  /** The page's language has no text: shown in `language`, labelled "(in French)". */
  | { kind: 'other-language'; language: string }

/** A testimonial ready to render: one coherent language, no empty card. */
export interface TestimonialPublic {
  /** The testimonial's publicId — a stable React key / dialog id. */
  id: string
  /** null = anonymous (or no name): the renderer shows the dictionary label "Anonymous" when `anonymous`. */
  displayName: string | null
  anonymous: boolean
  age: number | null
  rating: number | null
  givenOn: string | null
  source: TestimonialSource | null
  sourceUrl: string | null
  featured: boolean
  tags: string[]
  originalLocale: string | null
  /** null unless the person has a photo and the site shows photos. */
  photo: TestimonialPhoto | null
  /** The language of the whole card (the body's). */
  locale: string
  context: string | null
  /** The short version, or null — the card then shows the first lines of `body`. */
  abstract: string | null
  body: string
  /** `abstract` when there is one, else `body`: the text the card cuts to ~3 lines. */
  excerpt: string
  /** Wording hint for the language line; null = the text is in the page language, in the original or reviewed. */
  languageNote: TestimonialLanguageNote | null
}

const clean = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * Raw projection row → card, for a page in `pageLocale`. Returns null when the
 * testimonial has no body text in any language (nothing to show).
 *
 * The card's language is the body's. A context or short version in any other
 * language is dropped — a card is never mixed (D6).
 */
export function normalizeTestimonial(raw: TestimonialRaw | null | undefined, pageLocale: string): TestimonialPublic | null {
  if (!raw || typeof raw.publicId !== 'string') return null
  const body = clean(raw.body?.text)
  if (!raw.body || !body) return null
  const locale = raw.body.locale
  const same = (t: TestimonialText | null | undefined) => (t && t.locale === locale ? clean(t.text) : null)
  const abstract = same(raw.abstract)
  const original = clean(raw.originalLocale)
  const anonymous = raw.anonymous === true
  let languageNote: TestimonialLanguageNote | null = null
  if (locale !== pageLocale) languageNote = { kind: 'other-language', language: locale }
  else if (raw.body.machine && original && original !== locale) languageNote = { kind: 'translated', from: original }
  return {
    id: raw.publicId,
    displayName: anonymous ? null : clean(raw.displayName),
    anonymous,
    age: typeof raw.age === 'number' ? raw.age : null,
    rating: typeof raw.rating === 'number' && raw.rating >= 1 && raw.rating <= 5 ? raw.rating : null,
    givenOn: clean(raw.givenOn),
    source: raw.source ?? null,
    sourceUrl: clean(raw.sourceUrl),
    featured: raw.featured === true,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : [],
    originalLocale: original,
    photo: !anonymous && raw.photo?.asset ? raw.photo : null,
    locale,
    context: same(raw.context),
    abstract,
    body,
    excerpt: abstract ?? body,
    languageNote,
  }
}
