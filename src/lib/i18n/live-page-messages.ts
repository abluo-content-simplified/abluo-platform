/**
 * Live Page UI Messages
 *
 * ADR-016 Phase B — fixed-page fallback strings for the /live route
 * (src/components/livener/live/LivePageContent.tsx). These are platform UI
 * chrome, not tenant content — mirrors the pattern established by
 * event-messages.ts (src/lib/i18n/event-messages.ts).
 *
 * Kept separate from the section-level `emptyStateHeading`/`emptyStateBody`
 * fields on liveLatestSection (admin-authored, localized in Sanity): those
 * apply only to the composable section, this dictionary applies to the fixed
 * /live page content that Phase C will eventually migrate into sections.
 */

export interface LivePageMessages {
  noLiveEventHeading:  string
  noLiveEventBody:     string
  pastLiveEventsHeading: string
}

const MESSAGES: Record<string, LivePageMessages> = {
  en: {
    noLiveEventHeading:    'No live event scheduled right now.',
    noLiveEventBody:       'Check back soon.',
    pastLiveEventsHeading: 'Past Live Events',
  },
  it: {
    noLiveEventHeading:    'Nessun evento live programmato al momento.',
    noLiveEventBody:       'Torna presto per aggiornamenti.',
    pastLiveEventsHeading: 'Eventi Live Passati',
  },
  de: {
    noLiveEventHeading:    'Derzeit ist kein Live-Event geplant.',
    noLiveEventBody:       'Schau bald wieder vorbei.',
    pastLiveEventsHeading: 'Vergangene Live-Events',
  },
  fr: {
    noLiveEventHeading:    'Aucun événement en direct prévu pour le moment.',
    noLiveEventBody:       'Revenez bientôt.',
    pastLiveEventsHeading: 'Événements en direct passés',
  },
  es: {
    noLiveEventHeading:    'No hay ningún evento en directo programado ahora mismo.',
    noLiveEventBody:       'Vuelve pronto.',
    pastLiveEventsHeading: 'Eventos en directo pasados',
  },
  pt: {
    noLiveEventHeading:    'Não há nenhum evento em direto agendado neste momento.',
    noLiveEventBody:       'Volte em breve.',
    pastLiveEventsHeading: 'Eventos em Direto Anteriores',
  },
  nl: {
    noLiveEventHeading:    'Er is op dit moment geen live-evenement gepland.',
    noLiveEventBody:       'Kom binnenkort terug.',
    pastLiveEventsHeading: 'Eerdere Live-evenementen',
  },
}

export function getLivePageMessages(locale: string): LivePageMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
