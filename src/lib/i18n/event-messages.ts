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
  },
}

export function getEventMessages(locale: string): EventMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
