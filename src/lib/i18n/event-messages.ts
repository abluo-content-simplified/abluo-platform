/**
 * Event UI Messages
 *
 * Locale-aware labels for event-related components — status badges,
 * section headings, CTA fallbacks, and navigation labels.
 * These are platform UI strings, not tenant content.
 *
 * FUTURE: replace with next-intl `getTranslations` once the messages/
 * directory is the authoritative source for all UI strings.
 */

export interface EventMessages {
  statusLive:           string
  statusUpcoming:       string
  viewEventDetails:     string
  backToEvents:         string
  backToLive:           string
  scheduleHeading:      string
  galleryHeading:       string
  relatedEventsHeading: string
  watchFallback:        string
  /** ADR-016 Phase B — events list page (/events) fixed fallback empty state */
  noEventsYetHeading:   string
  /** ADR-016 Phase B — events list page (/events) fixed fallback empty state */
  noEventsYetBody:      string
  /** Fallback label for the registration button when the event sets none. */
  registerFallback:     string
  /** Heading above the price list on the event detail page. */
  pricesHeading:        string
  /** Compact lowest price on cards — `{price}` is the formatted amount. */
  priceFrom:            string
  /** Prefix before the host names: "Hosted by Anna, Marco". */
  hostedBy:             string
}

const MESSAGES: Record<string, EventMessages> = {
  en: {
    statusLive:           'Live',
    statusUpcoming:       'Upcoming',
    viewEventDetails:     'View Event Details',
    backToEvents:         'Back to Events',
    backToLive:           'Back to Live',
    scheduleHeading:      'Schedule',
    galleryHeading:       'Gallery',
    relatedEventsHeading: 'Related Events',
    watchFallback:        'Watch',
    noEventsYetHeading:   'No events yet.',
    noEventsYetBody:      'Check back soon.',
    registerFallback:     'Sign up',
    pricesHeading:        'Prices',
    priceFrom:            'from {price}',
    hostedBy:             'Hosted by',
  },
  it: {
    statusLive:           'In diretta',
    statusUpcoming:       'Prossimamente',
    viewEventDetails:     'Dettagli evento',
    backToEvents:         'Torna agli eventi',
    backToLive:           'Torna al live',
    scheduleHeading:      'Programma',
    galleryHeading:       'Galleria',
    relatedEventsHeading: 'Altri eventi',
    watchFallback:        'Guarda',
    noEventsYetHeading:   'Nessun evento al momento.',
    noEventsYetBody:      'Torna presto per aggiornamenti.',
    registerFallback:     'Iscriviti',
    pricesHeading:        'Prezzi',
    priceFrom:            'da {price}',
    hostedBy:             'Con',
  },
  de: {
    statusLive:           'Live',
    statusUpcoming:       'Demnächst',
    viewEventDetails:     'Event-Details anzeigen',
    backToEvents:         'Zurück zu Events',
    backToLive:           'Zurück zu Live',
    scheduleHeading:      'Programm',
    galleryHeading:       'Galerie',
    relatedEventsHeading: 'Weitere Events',
    watchFallback:        'Ansehen',
    noEventsYetHeading:   'Noch keine Events.',
    noEventsYetBody:      'Schau bald wieder vorbei.',
    registerFallback:     'Anmelden',
    pricesHeading:        'Preise',
    priceFrom:            'ab {price}',
    hostedBy:             'Mit',
  },
  fr: {
    statusLive:           'En direct',
    statusUpcoming:       'À venir',
    viewEventDetails:     'Voir les détails',
    backToEvents:         'Retour aux événements',
    backToLive:           'Retour au live',
    scheduleHeading:      'Programme',
    galleryHeading:       'Galerie',
    relatedEventsHeading: 'Autres événements',
    watchFallback:        'Regarder',
    noEventsYetHeading:   'Aucun événement pour le moment.',
    noEventsYetBody:      'Revenez bientôt.',
    registerFallback:     "S'inscrire",
    pricesHeading:        'Tarifs',
    priceFrom:            'à partir de {price}',
    hostedBy:             'Animé par',
  },
  es: {
    statusLive:           'En directo',
    statusUpcoming:       'Próximamente',
    viewEventDetails:     'Ver detalles del evento',
    backToEvents:         'Volver a eventos',
    backToLive:           'Volver al directo',
    scheduleHeading:      'Programa',
    galleryHeading:       'Galería',
    relatedEventsHeading: 'Otros eventos',
    watchFallback:        'Ver',
    noEventsYetHeading:   'Todavía no hay eventos.',
    noEventsYetBody:      'Vuelve pronto.',
    registerFallback:     'Inscríbete',
    pricesHeading:        'Precios',
    priceFrom:            'desde {price}',
    hostedBy:             'Con',
  },
  pt: {
    statusLive:           'Em direto',
    statusUpcoming:       'Brevemente',
    viewEventDetails:     'Ver detalhes do evento',
    backToEvents:         'Voltar aos eventos',
    backToLive:           'Voltar ao direto',
    scheduleHeading:      'Programa',
    galleryHeading:       'Galeria',
    relatedEventsHeading: 'Outros eventos',
    watchFallback:        'Ver',
    noEventsYetHeading:   'Ainda não há eventos.',
    noEventsYetBody:      'Volte em breve.',
    registerFallback:     'Inscrever-me',
    pricesHeading:        'Preços',
    priceFrom:            'a partir de {price}',
    hostedBy:             'Com',
  },
  nl: {
    statusLive:           'Live',
    statusUpcoming:       'Binnenkort',
    viewEventDetails:     'Evenementdetails bekijken',
    backToEvents:         'Terug naar evenementen',
    backToLive:           'Terug naar live',
    scheduleHeading:      'Programma',
    galleryHeading:       'Galerij',
    relatedEventsHeading: 'Andere evenementen',
    watchFallback:        'Bekijken',
    noEventsYetHeading:   'Nog geen evenementen.',
    noEventsYetBody:      'Kom binnenkort terug.',
    registerFallback:     'Aanmelden',
    pricesHeading:        'Prijzen',
    priceFrom:            'vanaf {price}',
    hostedBy:             'Met',
  },
}

export function getEventMessages(locale: string): EventMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}

export const EVENT_MESSAGES_FOR_TEST = MESSAGES
