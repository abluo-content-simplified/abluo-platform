/**
 * NewsPage UI Messages — DEPRECATED
 *
 * @deprecated
 * These strings are the fallback for tenants that do not yet have a `blogPage`
 * Sanity document. Once a `blogPage` document exists for a tenant, Sanity is
 * the source of truth for eyebrow, title, and subtitle (ADR-009, Rule 3).
 *
 * Remove this file when all tenants have a published `blogPage` document.
 * The remaining UI chrome (countLabel, readArticle, emptyHeading, emptyBody,
 * latestArticles) should migrate to next-intl locale dictionaries at that point.
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
