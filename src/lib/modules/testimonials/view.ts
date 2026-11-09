// ── Testimonials module — the card the visitor reads (ADR-048 D5, D6) ─────────
//
// Pure: turns the language-resolved TestimonialPublic into the words and links
// a card and its window print, in the page language. The server component
// calls it; the client component only renders the result — so every sentence
// comes from the dictionary and nothing is worded in the browser.

import { safeLinkHref } from '@/lib/links/safe-href'
import { formatTestimonialMessage, type TestimonialMessages } from '@/lib/i18n/testimonials-messages'
import type { TestimonialsSection } from '@/lib/sanity/types'
import type { TestimonialPublic } from './projection'

export interface TestimonialCardView {
  id: string
  /** The name line: the person's name, or the dictionary "Anonymous". Null = no name at all. */
  name: string | null
  context: string | null
  /** "34 years old", or null. */
  age: string | null
  /** 1-5 when the section shows ratings, else null. */
  rating: number | null
  ratingLabel: string | null
  /** ISO date + the date printed for the page language. */
  dateIso: string | null
  dateText: string | null
  /** "on Google" (+ link when the testimonial carries a safe http(s) address). Attribution only. */
  source: { text: string; href: string | null } | null
  /** "Translated from French" / "(in French)". */
  languageNote: string | null
  /** The language of the card's text, for lang="". */
  lang: string
  /** What the card shows, cut to ~3 lines by CSS. */
  excerpt: string
  /** The full text, one string per paragraph. */
  paragraphs: string[]
  /** Server guess whether the card cuts the text; the browser also checks the real overflow. */
  mayNeedMore: boolean
  readMoreLabel: string
}

type Options = Pick<TestimonialsSection, 'showRating' | 'showDate' | 'showSource'>

const SOURCE_NAMES: Record<string, string> = { google: 'Google', facebook: 'Facebook', trustpilot: 'Trustpilot' }

/** Roughly three lines of a phone-width card. Beyond it (or with a separate full text) the card offers "Read more". */
export const EXCERPT_COMFORT_CHARS = 150

/** A language name in the visitor's language ("French", "francese"); the code itself when unknown. */
export function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}

/** YYYY-MM-DD → "11 November 2026" in the page language. Date only, so no clock conventions apply. */
export function formatGivenOn(iso: string, locale: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return null
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (Number.isNaN(date.getTime())) return null
  const tag = locale === 'en' ? 'en-GB' : locale
  try {
    return new Intl.DateTimeFormat(tag, { dateStyle: 'long', timeZone: 'UTC' }).format(date)
  } catch {
    return iso
  }
}

function sourceOf(t: TestimonialPublic, msgs: TestimonialMessages): TestimonialCardView['source'] {
  if (!t.source || t.source === 'website') return null
  const href = t.sourceUrl && /^https?:\/\//i.test(t.sourceUrl) ? safeLinkHref(t.sourceUrl) : null
  let label: string | undefined = SOURCE_NAMES[t.source]
  if (!label && href) {
    try {
      label = new URL(href).hostname.replace(/^www\./, '')
    } catch {
      label = undefined
    }
  }
  if (!label) return null
  return { text: formatTestimonialMessage(msgs.onSource, { source: label }), href }
}

export function toCardView(t: TestimonialPublic, opts: Options, msgs: TestimonialMessages, pageLocale: string): TestimonialCardView {
  const name = t.anonymous ? msgs.anonymous : t.displayName
  const rating = opts.showRating === true && t.rating ? t.rating : null
  const paragraphs = t.body.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  let languageNote: string | null = null
  if (t.languageNote?.kind === 'translated') languageNote = formatTestimonialMessage(msgs.translatedFrom, { language: languageName(t.languageNote.from, pageLocale) })
  else if (t.languageNote?.kind === 'other-language') languageNote = formatTestimonialMessage(msgs.inLanguage, { language: languageName(t.languageNote.language, pageLocale) })
  const separateFull = t.excerpt !== t.body
  return {
    id: t.id,
    name: name || null,
    context: t.context,
    age: t.age ? formatTestimonialMessage(msgs.ageYears, { age: t.age }) : null,
    rating,
    ratingLabel: rating ? formatTestimonialMessage(msgs.ratingLabel, { rating }) : null,
    dateIso: opts.showDate === true ? t.givenOn : null,
    dateText: opts.showDate === true && t.givenOn ? formatGivenOn(t.givenOn, pageLocale) : null,
    source: opts.showSource === true ? sourceOf(t, msgs) : null,
    languageNote,
    lang: t.locale,
    excerpt: t.excerpt,
    paragraphs,
    mayNeedMore: separateFull || paragraphs.length > 1 || t.body.length > EXCERPT_COMFORT_CHARS,
    readMoreLabel: formatTestimonialMessage(msgs.readMoreAbout, { name: name ?? msgs.dialogFallback }),
  }
}
