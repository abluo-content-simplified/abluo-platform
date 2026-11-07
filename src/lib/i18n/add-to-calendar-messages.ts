/**
 * "Add to calendar" messages (courses module, ADR-045 / ADR-038).
 * Platform chrome for the Timetable class panel and the words inside the calendar file
 * (event description labels). Same locales as timetable-messages.ts; anything else reads English.
 */

export interface AddToCalendarMessages {
  /** The button / menu title. */
  addToCalendar: string
  /** Menu entry: the .ics download (Apple Calendar, Outlook, others). */
  appleOutlook: string
  /** Menu entry: opens Google Calendar in a new tab. */
  googleCalendar: string
  /** Choice: only the chosen date. */
  thisDate: string
  /** Choice: the whole repeating class; receives the repeat in words ("Every Thursday"). */
  wholeClass: (repeat: string) => string
  /** Accessible hint on links that open a new tab. */
  opensInNewTab: string
  /** Accessible name of the choice group. */
  chooseWhat: string
  /** Event LOCATION for a class held only online. */
  online: string
  /** Event DESCRIPTION labels. */
  teachers: string
  languages: string
  /** "also online" suffix for a hybrid class's location. */
  alsoOnline: string
}

const MESSAGES: Record<string, AddToCalendarMessages> = {
  en: {
    addToCalendar: 'Add to calendar',
    appleOutlook: 'Apple / Outlook (.ics)',
    googleCalendar: 'Google Calendar',
    thisDate: 'This date only',
    wholeClass: (r) => `The whole class (${r.toLowerCase()})`,
    opensInNewTab: 'opens in a new tab',
    chooseWhat: 'What to add',
    online: 'Online',
    teachers: 'Teachers',
    languages: 'Languages',
    alsoOnline: 'also online',
  },
  it: {
    addToCalendar: 'Aggiungi al calendario',
    appleOutlook: 'Apple / Outlook (.ics)',
    googleCalendar: 'Google Calendar',
    thisDate: 'Solo questa data',
    wholeClass: (r) => `Tutto il corso (${r.toLowerCase()})`,
    opensInNewTab: 'si apre in una nuova scheda',
    chooseWhat: 'Cosa aggiungere',
    online: 'Online',
    teachers: 'Insegnanti',
    languages: 'Lingue',
    alsoOnline: 'anche online',
  },
  de: {
    addToCalendar: 'Zum Kalender hinzufügen',
    appleOutlook: 'Apple / Outlook (.ics)',
    googleCalendar: 'Google Kalender',
    thisDate: 'Nur dieser Termin',
    wholeClass: (r) => `Der ganze Kurs (${r})`,
    opensInNewTab: 'öffnet in einem neuen Tab',
    chooseWhat: 'Was hinzufügen',
    online: 'Online',
    teachers: 'Lehrende',
    languages: 'Sprachen',
    alsoOnline: 'auch online',
  },
  fr: {
    addToCalendar: 'Ajouter au calendrier',
    appleOutlook: 'Apple / Outlook (.ics)',
    googleCalendar: 'Google Agenda',
    thisDate: 'Cette date uniquement',
    wholeClass: (r) => `Tout le cours (${r.toLowerCase()})`,
    opensInNewTab: 's’ouvre dans un nouvel onglet',
    chooseWhat: 'Que faut-il ajouter',
    online: 'En ligne',
    teachers: 'Professeurs',
    languages: 'Langues',
    alsoOnline: 'aussi en ligne',
  },
  es: {
    addToCalendar: 'Añadir al calendario',
    appleOutlook: 'Apple / Outlook (.ics)',
    googleCalendar: 'Google Calendar',
    thisDate: 'Solo esta fecha',
    wholeClass: (r) => `Toda la clase (${r.toLowerCase()})`,
    opensInNewTab: 'se abre en una pestaña nueva',
    chooseWhat: 'Qué añadir',
    online: 'En línea',
    teachers: 'Profesores',
    languages: 'Idiomas',
    alsoOnline: 'también en línea',
  },
  pt: {
    addToCalendar: 'Adicionar ao calendário',
    appleOutlook: 'Apple / Outlook (.ics)',
    googleCalendar: 'Google Agenda',
    thisDate: 'Só esta data',
    wholeClass: (r) => `A aula toda (${r.toLowerCase()})`,
    opensInNewTab: 'abre num novo separador',
    chooseWhat: 'O que adicionar',
    online: 'Online',
    teachers: 'Professores',
    languages: 'Idiomas',
    alsoOnline: 'também online',
  },
  nl: {
    addToCalendar: 'Aan agenda toevoegen',
    appleOutlook: 'Apple / Outlook (.ics)',
    googleCalendar: 'Google Agenda',
    thisDate: 'Alleen deze datum',
    wholeClass: (r) => `De hele les (${r.toLowerCase()})`,
    opensInNewTab: 'opent in een nieuw tabblad',
    chooseWhat: 'Wat toevoegen',
    online: 'Online',
    teachers: 'Docenten',
    languages: 'Talen',
    alsoOnline: 'ook online',
  },
}

export function getAddToCalendarMessages(locale: string | undefined): AddToCalendarMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export const ADD_TO_CALENDAR_MESSAGES_FOR_TEST = MESSAGES
