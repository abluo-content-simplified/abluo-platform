/**
 * Unavailable page messages — ADR-032 D12.
 *
 * The branded 404 every tenant shows for content that is scheduled,
 * unpublished, archived, deleted or never existed. The copy is deliberately
 * identical in all of those cases: it never hints at the item or its state.
 *
 * Website chrome, not tenant content — one dictionary per platform locale,
 * English fallback (same pattern as event-messages.ts).
 */

export interface UnavailablePageMessages {
  heading: string
  body: string
  goHome: string
  browseArticles: string
  browseEvents: string
  browseNews: string
}

const MESSAGES: Record<string, UnavailablePageMessages> = {
  en: {
    heading: 'This page isn’t available.',
    body: 'The page may have moved or may no longer be available. You can continue exploring the website using the links below.',
    goHome: 'Go to homepage',
    browseArticles: 'Browse articles',
    browseEvents: 'Browse events',
    browseNews: 'Browse news',
  },
  it: {
    heading: 'Questa pagina non è disponibile.',
    body: 'La pagina potrebbe essere stata spostata o non essere più disponibile. Puoi continuare a esplorare il sito con i link qui sotto.',
    goHome: 'Vai alla home page',
    browseArticles: 'Sfoglia gli articoli',
    browseEvents: 'Sfoglia gli eventi',
    browseNews: 'Sfoglia le notizie',
  },
  de: {
    heading: 'Diese Seite ist nicht verfügbar.',
    body: 'Die Seite wurde möglicherweise verschoben oder ist nicht mehr verfügbar. Über die Links unten können Sie die Website weiter erkunden.',
    goHome: 'Zur Startseite',
    browseArticles: 'Artikel ansehen',
    browseEvents: 'Veranstaltungen ansehen',
    browseNews: 'News ansehen',
  },
  fr: {
    heading: 'Cette page n’est pas disponible.',
    body: 'La page a peut-être été déplacée ou n’est plus disponible. Vous pouvez continuer à explorer le site grâce aux liens ci-dessous.',
    goHome: 'Aller à l’accueil',
    browseArticles: 'Parcourir les articles',
    browseEvents: 'Parcourir les événements',
    browseNews: 'Parcourir les actualités',
  },
  es: {
    heading: 'Esta página no está disponible.',
    body: 'Es posible que la página se haya movido o que ya no esté disponible. Puedes seguir explorando el sitio con los enlaces de abajo.',
    goHome: 'Ir a la página de inicio',
    browseArticles: 'Ver artículos',
    browseEvents: 'Ver eventos',
    browseNews: 'Ver noticias',
  },
  pt: {
    heading: 'Esta página não está disponível.',
    body: 'A página pode ter sido movida ou já não estar disponível. Pode continuar a explorar o site através das ligações abaixo.',
    goHome: 'Ir para a página inicial',
    browseArticles: 'Ver artigos',
    browseEvents: 'Ver eventos',
    browseNews: 'Ver notícias',
  },
  nl: {
    heading: 'Deze pagina is niet beschikbaar.',
    body: 'De pagina is mogelijk verplaatst of niet meer beschikbaar. Via de onderstaande links kun je de website verder verkennen.',
    goHome: 'Naar de homepage',
    browseArticles: 'Artikelen bekijken',
    browseEvents: 'Evenementen bekijken',
    browseNews: 'Nieuws bekijken',
  },
}

export const UNAVAILABLE_PAGE_MESSAGES_FOR_TEST = MESSAGES

export function getUnavailablePageMessages(locale: string | null | undefined): UnavailablePageMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}
