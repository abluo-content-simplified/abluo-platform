/**
 * NewsPage UI Messages
 *
 * Locale-aware strings for the News & Announcements listing page.
 * These are page-level UI strings, not tenant content, so they live
 * in locale dictionaries rather than Sanity.
 *
 * FUTURE: replace with next-intl `getTranslations` once the messages/
 * directory is the authoritative source for all UI strings.
 */

export interface NewsPageMessages {
  eyebrow: string
  title: string
  subtitle: string
  /** e.g. "4 Articles" — $count is replaced at runtime */
  countLabel: (count: number) => string
  readArticle: string
  emptyHeading: string
  emptyBody: string
  latestArticles: string
}

const MESSAGES: Record<string, NewsPageMessages> = {
  en: {
    eyebrow:        'Latest Updates',
    title:          'News & Announcements',
    subtitle:       'Follow Livener\'s journey as we develop the future of cloud-based live production.',
    countLabel:     (n) => `${n} ${n === 1 ? 'Article' : 'Articles'}`,
    readArticle:    'Read Article',
    emptyHeading:   'No articles published yet.',
    emptyBody:      'Check back soon for updates from Livener.',
    latestArticles: 'Latest Articles',
  },
  it: {
    eyebrow:        'Ultimi Aggiornamenti',
    title:          'Notizie e Annunci',
    subtitle:       'Segui il percorso di Livener mentre sviluppiamo il futuro della produzione live basata sul cloud.',
    countLabel:     (n) => `${n} ${n === 1 ? 'Articolo' : 'Articoli'}`,
    readArticle:    'Leggi l\'articolo',
    emptyHeading:   'Nessun articolo pubblicato.',
    emptyBody:      'Torna presto per aggiornamenti da Livener.',
    latestArticles: 'Ultimi Articoli',
  },
}

export function getNewsPageMessages(locale: string): NewsPageMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
