/**
 * Timetable section UI messages (courses module, build spec §5).
 *
 * Platform chrome for TimetableSection — view names, navigation, status words,
 * the printed sheet's phrases. Not tenant content (course titles, teacher
 * names, places and notes come from Sanity / scheduling), so it lives in a
 * locale dictionary for the page's CONTENT language — same pattern as
 * locations-section-messages.ts. Weekday and month names are NOT here: they
 * come from Intl for the page locale. Language codes are named with
 * Intl.DisplayNames in aria labels.
 */

export interface TimetableMessages {
  /** Heading of the printed sheet when the section has no title. */
  timetable: string
  viewWeek: string
  viewMonth: string
  /** Accessible name of the Week / Month switch. */
  viewSwitch: string
  today: string
  previousWeek: string
  nextWeek: string
  previousMonth: string
  nextMonth: string
  /** Accessible name of the previous / next controls' group. */
  navigation: string
  /** A day or week with no classes. */
  noClasses: string
  /** The whole timetable has nothing to show. */
  emptyTimetable: string
  loading: string
  loadError: string
  /** Status word on a cancelled class. */
  cancelled: string
  /** A day inside a holiday. */
  closed: string
  /** Badge: the class is held in the room and online. */
  hybrid: string
  /** Badge / print row: the class is online only. */
  online: string
  /** Print row for classes with no place. */
  otherPlace: string
  printMonth: string
  /** "with Sabrina" in lists; receives the teacher names already joined. */
  withTeachers: (names: string) => string
  /** Printed exception: "sub Sabrina" (date is prefixed by the sheet). */
  substitute: (names: string) => string
  /** Printed exception: the class does not take place. */
  noClass: string
  /** Printed exception: the class is held online / in the room only. */
  noHybrid: string
  onlineOnly: string
  /** Printed exception: the class is held at a different time. */
  atTime: (time: string) => string
  /** Printed header: "last class 17/12" and "first class 7/1/2027". */
  lastClass: (date: string) => string
  firstClass: (date: string) => string
  /** Printed header when the closure has no class around it. */
  closedFromTo: (from: string, to: string) => string
  onlineRooms: string
  meetingId: string
  passcode: string
  joinLink: string
  /** Screen-reader hint on a link that opens in a new tab. */
  opensInNewTab: string
  /** Class details panel (website): close button, the button that opens it, section labels. */
  close: string
  /** Accessible name of the button that opens a class's details; receives "Course, date, time". */
  openDetails: (what: string) => string
  teachersLabel: string
  placeLabel: string
  languagesLabel: string
  openInMaps: string
  /** Heading of the optional printed page that describes the courses. */
  aboutCourses: string
}

const MESSAGES: Record<string, TimetableMessages> = {
  en: {
    timetable: 'Timetable',
    viewWeek: 'Week',
    viewMonth: 'Month',
    viewSwitch: 'Timetable view',
    today: 'Today',
    previousWeek: 'Previous week',
    nextWeek: 'Next week',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    navigation: 'Change period',
    noClasses: 'No classes',
    emptyTimetable: 'No classes to show yet.',
    loading: 'Loading…',
    loadError: 'The timetable could not be loaded. Please try again.',
    cancelled: 'Cancelled',
    closed: 'Closed',
    hybrid: 'Hybrid',
    online: 'Online',
    otherPlace: 'Other',
    printMonth: 'Print month',
    withTeachers: (names) => `with ${names}`,
    substitute: (names) => `sub ${names}`,
    noClass: 'no class',
    noHybrid: 'no hybrid',
    onlineOnly: 'online only',
    atTime: (time) => `at ${time}`,
    lastClass: (date) => `last class ${date}`,
    firstClass: (date) => `first class ${date}`,
    closedFromTo: (from, to) => `no classes ${from} – ${to}`,
    onlineRooms: 'Online rooms',
    meetingId: 'Meeting ID',
    passcode: 'Passcode',
    joinLink: 'Join',
    opensInNewTab: 'opens in a new tab',
    close: 'Close',
    openDetails: (w) => `Details: ${w}`,
    teachersLabel: 'Teachers',
    placeLabel: 'Place',
    languagesLabel: 'Languages',
    openInMaps: 'Open in maps',
    aboutCourses: 'About the courses',
  },
  it: {
    timetable: 'Orario',
    viewWeek: 'Settimana',
    viewMonth: 'Mese',
    viewSwitch: 'Vista dell’orario',
    today: 'Oggi',
    previousWeek: 'Settimana precedente',
    nextWeek: 'Settimana successiva',
    previousMonth: 'Mese precedente',
    nextMonth: 'Mese successivo',
    navigation: 'Cambia periodo',
    noClasses: 'Nessuna lezione',
    emptyTimetable: 'Nessuna lezione da mostrare per ora.',
    loading: 'Caricamento…',
    loadError: 'Impossibile caricare l’orario. Riprova.',
    cancelled: 'Annullata',
    closed: 'Chiuso',
    hybrid: 'Ibrida',
    online: 'Online',
    otherPlace: 'Altro',
    printMonth: 'Stampa il mese',
    withTeachers: (names) => `con ${names}`,
    substitute: (names) => `sostituisce ${names}`,
    noClass: 'nessuna lezione',
    noHybrid: 'non ibrida',
    onlineOnly: 'solo online',
    atTime: (time) => `alle ${time}`,
    lastClass: (date) => `ultima lezione ${date}`,
    firstClass: (date) => `prima lezione ${date}`,
    closedFromTo: (from, to) => `nessuna lezione ${from} – ${to}`,
    onlineRooms: 'Sale online',
    meetingId: 'ID riunione',
    passcode: 'Codice di accesso',
    joinLink: 'Partecipa',
    opensInNewTab: 'si apre in una nuova scheda',
    close: 'Chiudi',
    openDetails: (w) => `Dettagli: ${w}`,
    teachersLabel: 'Insegnanti',
    placeLabel: 'Luogo',
    languagesLabel: 'Lingue',
    openInMaps: 'Apri nelle mappe',
    aboutCourses: 'Informazioni sui corsi',
  },
  de: {
    timetable: 'Stundenplan',
    viewWeek: 'Woche',
    viewMonth: 'Monat',
    viewSwitch: 'Ansicht des Stundenplans',
    today: 'Heute',
    previousWeek: 'Vorherige Woche',
    nextWeek: 'Nächste Woche',
    previousMonth: 'Vorheriger Monat',
    nextMonth: 'Nächster Monat',
    navigation: 'Zeitraum wechseln',
    noClasses: 'Keine Kurse',
    emptyTimetable: 'Noch keine Kurse vorhanden.',
    loading: 'Wird geladen…',
    loadError: 'Der Stundenplan konnte nicht geladen werden. Bitte versuchen Sie es erneut.',
    cancelled: 'Abgesagt',
    closed: 'Geschlossen',
    hybrid: 'Hybrid',
    online: 'Online',
    otherPlace: 'Sonstige',
    printMonth: 'Monat drucken',
    withTeachers: (names) => `mit ${names}`,
    substitute: (names) => `Vertretung ${names}`,
    noClass: 'kein Kurs',
    noHybrid: 'nicht hybrid',
    onlineOnly: 'nur online',
    atTime: (time) => `um ${time}`,
    lastClass: (date) => `letzter Kurs ${date}`,
    firstClass: (date) => `erster Kurs ${date}`,
    closedFromTo: (from, to) => `keine Kurse ${from} – ${to}`,
    onlineRooms: 'Online-Räume',
    meetingId: 'Meeting-ID',
    passcode: 'Zugangscode',
    joinLink: 'Beitreten',
    opensInNewTab: 'öffnet in einem neuen Tab',
    close: 'Schließen',
    openDetails: (w) => `Details: ${w}`,
    teachersLabel: 'Lehrende',
    placeLabel: 'Ort',
    languagesLabel: 'Sprachen',
    openInMaps: 'In Karten öffnen',
    aboutCourses: 'Über die Kurse',
  },
  fr: {
    timetable: 'Horaires',
    viewWeek: 'Semaine',
    viewMonth: 'Mois',
    viewSwitch: 'Vue des horaires',
    today: 'Aujourd’hui',
    previousWeek: 'Semaine précédente',
    nextWeek: 'Semaine suivante',
    previousMonth: 'Mois précédent',
    nextMonth: 'Mois suivant',
    navigation: 'Changer de période',
    noClasses: 'Pas de cours',
    emptyTimetable: 'Aucun cours à afficher pour le moment.',
    loading: 'Chargement…',
    loadError: 'Les horaires n’ont pas pu être chargés. Veuillez réessayer.',
    cancelled: 'Annulé',
    closed: 'Fermé',
    hybrid: 'Hybride',
    online: 'En ligne',
    otherPlace: 'Autre',
    printMonth: 'Imprimer le mois',
    withTeachers: (names) => `avec ${names}`,
    substitute: (names) => `remplacement ${names}`,
    noClass: 'pas de cours',
    noHybrid: 'pas d’hybride',
    onlineOnly: 'en ligne uniquement',
    atTime: (time) => `à ${time}`,
    lastClass: (date) => `dernier cours ${date}`,
    firstClass: (date) => `premier cours ${date}`,
    closedFromTo: (from, to) => `pas de cours ${from} – ${to}`,
    onlineRooms: 'Salles en ligne',
    meetingId: 'ID de réunion',
    passcode: 'Code d’accès',
    joinLink: 'Rejoindre',
    opensInNewTab: 's’ouvre dans un nouvel onglet',
    close: 'Fermer',
    openDetails: (w) => `Détails : ${w}`,
    teachersLabel: 'Enseignants',
    placeLabel: 'Lieu',
    languagesLabel: 'Langues',
    openInMaps: 'Ouvrir dans les cartes',
    aboutCourses: 'À propos des cours',
  },
  es: {
    timetable: 'Horario',
    viewWeek: 'Semana',
    viewMonth: 'Mes',
    viewSwitch: 'Vista del horario',
    today: 'Hoy',
    previousWeek: 'Semana anterior',
    nextWeek: 'Semana siguiente',
    previousMonth: 'Mes anterior',
    nextMonth: 'Mes siguiente',
    navigation: 'Cambiar de periodo',
    noClasses: 'Sin clases',
    emptyTimetable: 'Todavía no hay clases que mostrar.',
    loading: 'Cargando…',
    loadError: 'No se pudo cargar el horario. Inténtalo de nuevo.',
    cancelled: 'Cancelada',
    closed: 'Cerrado',
    hybrid: 'Híbrida',
    online: 'En línea',
    otherPlace: 'Otro',
    printMonth: 'Imprimir el mes',
    withTeachers: (names) => `con ${names}`,
    substitute: (names) => `sustituye ${names}`,
    noClass: 'sin clase',
    noHybrid: 'no híbrida',
    onlineOnly: 'solo en línea',
    atTime: (time) => `a las ${time}`,
    lastClass: (date) => `última clase ${date}`,
    firstClass: (date) => `primera clase ${date}`,
    closedFromTo: (from, to) => `sin clases ${from} – ${to}`,
    onlineRooms: 'Salas en línea',
    meetingId: 'ID de reunión',
    passcode: 'Código de acceso',
    joinLink: 'Unirse',
    opensInNewTab: 'se abre en una pestaña nueva',
    close: 'Cerrar',
    openDetails: (w) => `Detalles: ${w}`,
    teachersLabel: 'Profesores',
    placeLabel: 'Lugar',
    languagesLabel: 'Idiomas',
    openInMaps: 'Abrir en mapas',
    aboutCourses: 'Sobre los cursos',
  },
  pt: {
    timetable: 'Horário',
    viewWeek: 'Semana',
    viewMonth: 'Mês',
    viewSwitch: 'Vista do horário',
    today: 'Hoje',
    previousWeek: 'Semana anterior',
    nextWeek: 'Semana seguinte',
    previousMonth: 'Mês anterior',
    nextMonth: 'Mês seguinte',
    navigation: 'Mudar de período',
    noClasses: 'Sem aulas',
    emptyTimetable: 'Ainda não há aulas para mostrar.',
    loading: 'A carregar…',
    loadError: 'Não foi possível carregar o horário. Tente novamente.',
    cancelled: 'Cancelada',
    closed: 'Encerrado',
    hybrid: 'Híbrida',
    online: 'Online',
    otherPlace: 'Outro',
    printMonth: 'Imprimir o mês',
    withTeachers: (names) => `com ${names}`,
    substitute: (names) => `substitui ${names}`,
    noClass: 'sem aula',
    noHybrid: 'não híbrida',
    onlineOnly: 'só online',
    atTime: (time) => `às ${time}`,
    lastClass: (date) => `última aula ${date}`,
    firstClass: (date) => `primeira aula ${date}`,
    closedFromTo: (from, to) => `sem aulas ${from} – ${to}`,
    onlineRooms: 'Salas online',
    meetingId: 'ID da reunião',
    passcode: 'Código de acesso',
    joinLink: 'Entrar',
    opensInNewTab: 'abre num novo separador',
    close: 'Fechar',
    openDetails: (w) => `Detalhes: ${w}`,
    teachersLabel: 'Professores',
    placeLabel: 'Local',
    languagesLabel: 'Idiomas',
    openInMaps: 'Abrir nos mapas',
    aboutCourses: 'Sobre os cursos',
  },
  nl: {
    timetable: 'Lesrooster',
    viewWeek: 'Week',
    viewMonth: 'Maand',
    viewSwitch: 'Weergave van het lesrooster',
    today: 'Vandaag',
    previousWeek: 'Vorige week',
    nextWeek: 'Volgende week',
    previousMonth: 'Vorige maand',
    nextMonth: 'Volgende maand',
    navigation: 'Periode wijzigen',
    noClasses: 'Geen lessen',
    emptyTimetable: 'Er zijn nog geen lessen om te tonen.',
    loading: 'Laden…',
    loadError: 'Het lesrooster kon niet worden geladen. Probeer het opnieuw.',
    cancelled: 'Geannuleerd',
    closed: 'Gesloten',
    hybrid: 'Hybride',
    online: 'Online',
    otherPlace: 'Overig',
    printMonth: 'Maand afdrukken',
    withTeachers: (names) => `met ${names}`,
    substitute: (names) => `vervanging ${names}`,
    noClass: 'geen les',
    noHybrid: 'niet hybride',
    onlineOnly: 'alleen online',
    atTime: (time) => `om ${time}`,
    lastClass: (date) => `laatste les ${date}`,
    firstClass: (date) => `eerste les ${date}`,
    closedFromTo: (from, to) => `geen lessen ${from} – ${to}`,
    onlineRooms: 'Online ruimtes',
    meetingId: 'Vergader-ID',
    passcode: 'Toegangscode',
    joinLink: 'Deelnemen',
    opensInNewTab: 'opent in een nieuw tabblad',
    close: 'Sluiten',
    openDetails: (w) => `Details: ${w}`,
    teachersLabel: 'Docenten',
    placeLabel: 'Locatie',
    languagesLabel: 'Talen',
    openInMaps: 'Openen in kaarten',
    aboutCourses: 'Over de cursussen',
  },
}

export function getTimetableMessages(locale: string | undefined): TimetableMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export const TIMETABLE_MESSAGES_FOR_TEST = MESSAGES
