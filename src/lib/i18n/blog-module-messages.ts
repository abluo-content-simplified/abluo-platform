/**
 * Blog module UI messages.
 *
 * Sibling of ./news-module-messages.ts, and the fix for a defect that file
 * already documented in a comment rather than repairing:
 *
 *   "BlogListingSection formats dates with a hardcoded 'en' and hardcodes
 *    'min read', which renders Italian and German sites with English strings;
 *    that is not reproduced here (CLAUDE.md: no hardcoded user-facing strings)."
 *
 * So an Italian reader on an Italian page saw "Feb 12, 2026 · 2 min read".
 * Every string here is platform CHROME, not tenant content — headings, intros
 * and empty-state copy still come from Sanity, per ADR-009 Rule 3.
 *
 * Covers every locale in the platform registry, so the Blog module can be
 * installed on any website without a missing-string gap.
 */

export interface BlogModuleMessages {
  /** Suffix after a reading-time number. */
  readingTime: (minutes: number) => string
  /** Compact form used where space is tight (mini cards). */
  readingTimeShort: (minutes: number) => string
  /** Accessible label for the listing region. */
  blogListLabel: string
  /** Published-date prefix for screen readers. */
  publishedOn: string
}

const MESSAGES: Record<string, BlogModuleMessages> = {
  en: { readingTime: (m) => `${m} min read`,        readingTimeShort: (m) => `${m} min`,     blogListLabel: 'Articles',  publishedOn: 'Published on' },
  it: { readingTime: (m) => `${m} min di lettura`,  readingTimeShort: (m) => `${m} min`,     blogListLabel: 'Articoli',  publishedOn: 'Pubblicato il' },
  de: { readingTime: (m) => `${m} Min. Lesezeit`,   readingTimeShort: (m) => `${m} Min.`,    blogListLabel: 'Artikel',   publishedOn: 'Veröffentlicht am' },
  fr: { readingTime: (m) => `${m} min de lecture`,  readingTimeShort: (m) => `${m} min`,     blogListLabel: 'Articles',  publishedOn: 'Publié le' },
  es: { readingTime: (m) => `${m} min de lectura`,  readingTimeShort: (m) => `${m} min`,     blogListLabel: 'Artículos', publishedOn: 'Publicado el' },
  pt: { readingTime: (m) => `${m} min de leitura`,  readingTimeShort: (m) => `${m} min`,     blogListLabel: 'Artigos',   publishedOn: 'Publicado em' },
  nl: { readingTime: (m) => `${m} min leestijd`,    readingTimeShort: (m) => `${m} min`,     blogListLabel: 'Artikelen', publishedOn: 'Gepubliceerd op' },
}

export function getBlogModuleMessages(locale: string | undefined): BlogModuleMessages {
  return MESSAGES[locale ?? 'en'] ?? MESSAGES.en
}

/**
 * A published date in the READER'S locale.
 *
 * `toLocaleDateString(locale)` gives "12 feb 2026" for it, "12. Feb. 2026" for
 * de and "Feb 12, 2026" for en — the month abbreviation and the field order
 * both change, which is exactly why hardcoding 'en' was visible to an Italian
 * reader at a glance.
 */
export function formatBlogDate(iso: string, locale: string | undefined): string {
  const d = new Date(iso)
  // An unparseable date does NOT throw — toLocaleDateString returns the literal
  // string "Invalid Date", which a try/catch never sees and which would then be
  // printed to a visitor. The explicit NaN check is what makes the fallback real.
  // (news-module-messages.ts has the same latent hole.)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return d.toLocaleDateString(locale ?? 'en', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}
