/**
 * News module UI messages (ADR-020).
 *
 * Platform UI chrome for the News module — reading-time suffix, back link,
 * listing count. NOT tenant content: everything an editor writes (headings,
 * intros, empty-state copy) comes from Sanity, per ADR-009 Rule 3.
 *
 * Deliberately tenant-agnostic. Contrast with the deprecated
 * ./news-page-messages.ts, which despite its name serves the BLOG page and
 * hardcodes Livener's copy into a platform file — exactly the pattern
 * CLAUDE.md's multilingual rules forbid. Nothing here mentions a tenant.
 *
 * Covers every locale in the platform registry (en/it/de), so News can be
 * installed on any website without a missing-string gap.
 *
 * FUTURE: fold into next-intl `messages/*.json` once that directory is the
 * authoritative source for all UI strings — the same migration the other
 * *-messages.ts dictionaries are waiting on.
 */

export interface NewsModuleMessages {
  /** Suffix after a reading-time number, e.g. "5 min read". */
  readingTime: (minutes: number) => string
  /** Back link on a news item, pointing at the news index. */
  backToNews: string
  /** Accessible label for the news listing region. */
  newsListLabel: string
  /** Published-date prefix for screen readers on a news card. */
  publishedOn: string
}

const MESSAGES: Record<string, NewsModuleMessages> = {
  en: {
    readingTime:   (m) => `${m} min read`,
    backToNews:    'Back to News',
    newsListLabel: 'News',
    publishedOn:   'Published on',
  },
  it: {
    readingTime:   (m) => `${m} min di lettura`,
    backToNews:    'Torna alle notizie',
    newsListLabel: 'Notizie',
    publishedOn:   'Pubblicato il',
  },
  de: {
    readingTime:   (m) => `${m} Min. Lesezeit`,
    backToNews:    'Zurück zu den News',
    newsListLabel: 'News',
    publishedOn:   'Veröffentlicht am',
  },
}

export function getNewsModuleMessages(locale: string): NewsModuleMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}

/**
 * Formats a news date for the active locale.
 *
 * Uses the requested locale rather than a hardcoded one. BlogListingSection
 * formats with a literal 'en', which renders Italian and German sites with
 * English month names — not repeated here.
 *
 * Falls back to the raw ISO string if the locale is not a valid BCP-47 tag,
 * so a bad locale degrades to something readable instead of throwing during
 * a server render.
 */
export function formatNewsDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}
