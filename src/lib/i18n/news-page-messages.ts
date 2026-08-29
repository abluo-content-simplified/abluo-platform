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
  de: {
    eyebrow:        'Neueste Updates',
    title:          'News & Ankündigungen',
    subtitle:       'Verfolgen Sie den Weg von Livener, während wir die Zukunft der cloudbasierten Live-Produktion entwickeln.',
    countLabel:     (n) => `${n} ${n === 1 ? 'Artikel' : 'Artikel'}`,
    readArticle:    'Artikel lesen',
    emptyHeading:   'Noch keine Artikel veröffentlicht.',
    emptyBody:      'Schauen Sie bald wieder vorbei für Neuigkeiten von Livener.',
    latestArticles: 'Neueste Artikel',
  },
  fr: {
    eyebrow:        'Dernières actualités',
    title:          'Actualités et annonces',
    subtitle:       'Suivez le parcours de Livener alors que nous développons l\'avenir de la production live dans le cloud.',
    countLabel:     (n) => `${n} ${n === 1 ? 'Article' : 'Articles'}`,
    readArticle:    'Lire l\'article',
    emptyHeading:   'Aucun article publié pour le moment.',
    emptyBody:      'Revenez bientôt pour les actualités de Livener.',
    latestArticles: 'Derniers articles',
  },
  es: {
    eyebrow:        'Últimas novedades',
    title:          'Noticias y anuncios',
    subtitle:       'Sigue el recorrido de Livener mientras desarrollamos el futuro de la producción en directo basada en la nube.',
    countLabel:     (n) => `${n} ${n === 1 ? 'Artículo' : 'Artículos'}`,
    readArticle:    'Leer artículo',
    emptyHeading:   'Todavía no hay artículos publicados.',
    emptyBody:      'Vuelve pronto para ver las novedades de Livener.',
    latestArticles: 'Últimos artículos',
  },
  pt: {
    eyebrow:        'Últimas atualizações',
    title:          'Notícias e anúncios',
    subtitle:       'Acompanhe o percurso da Livener enquanto desenvolvemos o futuro da produção em direto na cloud.',
    countLabel:     (n) => `${n} ${n === 1 ? 'Artigo' : 'Artigos'}`,
    readArticle:    'Ler artigo',
    emptyHeading:   'Ainda não há artigos publicados.',
    emptyBody:      'Volte em breve para novidades da Livener.',
    latestArticles: 'Últimos artigos',
  },
  nl: {
    eyebrow:        'Laatste updates',
    title:          'Nieuws en aankondigingen',
    subtitle:       'Volg de reis van Livener terwijl we de toekomst van cloudgebaseerde liveproductie ontwikkelen.',
    countLabel:     (n) => `${n} ${n === 1 ? 'Artikel' : 'Artikelen'}`,
    readArticle:    'Artikel lezen',
    emptyHeading:   'Nog geen artikelen gepubliceerd.',
    emptyBody:      'Kom binnenkort terug voor updates van Livener.',
    latestArticles: 'Laatste artikelen',
  },
}

export function getNewsPageMessages(locale: string): NewsPageMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
