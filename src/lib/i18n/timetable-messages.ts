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
  /** Tag on an event (workshop) shown beside the classes. */
  workshop: string
  /** Heading of the printed list of the month's events. */
  workshops: string
  /** Footnote under the timetable / sheet when a shown teacher is a volunteer (starts with the asterisk). */
  volunteerNote: string
  /** Screen-reader text after a volunteer teacher's name (the asterisk is decorative). */
  volunteerSr: string
  /** Printed line under the title: "Holidays: 2 November"; receives the dates already joined. */
  holidays: (dates: string) => string
  /** Language filter: its label and the "no filter" choice. */
  languageFilter: string
  allLanguages: string
  /** Singular label of the teacher block in the class panel (one teacher). */
  teacherLabel: string
  /** Status badges on a class card. */
  substituteBadge: string
  timeChangedBadge: string
  movedBadge: string
  /** Small line under a substitute: "instead of Anna". */
  insteadOf: (names: string) => string
  /** Small line under a changed time: "was 18:00–19:00". */
  wasTime: (time: string) => string
  /** Schedule updates (changes to the regular timetable). */
  scheduleUpdates: string
  scheduleChangesThisWeek: (n: number) => string
  /** Phone updates row when the week has no changes. */
  noScheduleChanges: string
  changeSubstitute: (names: string) => string
  changeNewTime: (time: string) => string
  changeMovedTo: (place: string) => string
  /** Filters: the phone button / sheet title, the extra filters and their "no filter" choices. */
  filters: string
  teacherFilter: string
  allTeachers: string
  locationFilter: string
  allLocations: string
  courseFilter: string
  allCourses: string
  resetFilters: string
  /** Closes the filters sheet. */
  done: string
  /** Phone agenda: the date picker's name, the agenda's and the week strip's accessible names. */
  jumpToDate: string
  /** "2 classes" next to a day heading. */
  classesCount: (n: number) => string
  /** Status pill for a substitute: "Teacher change". */
  teacherChange: string
  /** "Melissa Watkins replaces Sabrina Messal". */
  replaces: (who: string, whom: string) => string
  /** "Hatha Yoga at 12:30". */
  courseAt: (course: string, time: string) => string
  /** Previous / next week on the phone strip. */
  previousWeekShort: string
  showAllChanges: (n: number) => string
  showFewerChanges: string
  nextWeekShort: string
  agendaLabel: string
  weekStripLabel: string
  /** Print view: the dialog's name, its print button and hint. */
  printPreview: string
  printNow: string
  printHint: string
  /** Print view: the active filters line ("Filtered: Language: English · Teacher: Anna"). */
  filteredBy: (list: string) => string
  /** One active filter: "Language: English". */
  filterValue: (label: string, value: string) => string
  /** Print view footer. */
  generatedOn: (date: string, time: string) => string
  printWeek: string
  /** Print month: days of a next / previous month whose classes are not published yet. */
  notAvailableYet: (month: string) => string
  /** Print key: what an underlined teacher, time or place means. */
  legendChanged: string
  pageOf: (page: number, total: number) => string
  /** A session given in other languages than its class. */
  changeLanguage: (languages: string) => string
  /** A section continued on the next printed page. */
  continued: string
  timeLabel: string
  courseLabel: string
  /** No class of the printed month matches the filters. */
  noClassesThisMonth: string
  /** Class panel: link to the course's own page (Courses module, ADR-045 D5). */
  aboutCourse: string
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
    workshop: 'Workshop',
    workshops: 'Workshops',
    volunteerNote: '* volunteer teacher',
    volunteerSr: 'volunteer teacher',
    holidays: (d) => `Holidays: ${d}`,
    languageFilter: 'Language',
    allLanguages: 'All languages',
    teacherLabel: 'Teacher',
    substituteBadge: 'Substitute',
    timeChangedBadge: 'Time changed',
    movedBadge: 'Moved',
    insteadOf: (n) => `instead of ${n}`,
    wasTime: (t) => `was ${t}`,
    scheduleUpdates: 'Schedule updates',
    scheduleChangesThisWeek: (n) => n === 1 ? '1 schedule change this week' : `${n} schedule changes this week`,
    noScheduleChanges: 'No changes this week',
    changeSubstitute: (n) => `Substitute: ${n}`,
    changeNewTime: (t) => `New time ${t}`,
    changeMovedTo: (p) => `Moved to ${p}`,
    filters: 'Filters',
    teacherFilter: 'Teacher',
    allTeachers: 'All teachers',
    locationFilter: 'Location',
    allLocations: 'All locations',
    courseFilter: 'Class',
    allCourses: 'All classes',
    resetFilters: 'Clear filters',
    done: 'Done',
    jumpToDate: 'Go to date',
    classesCount: (n) => n === 1 ? '1 class' : `${n} classes`,
    teacherChange: 'Teacher change',
    replaces: (a, b) => `${a} replaces ${b}`,
    courseAt: (c, t) => `${c} at ${t}`,
    previousWeekShort: 'Previous week',
    showAllChanges: (n) => `Show all ${n} changes`,
    showFewerChanges: 'Show fewer',
    nextWeekShort: 'Next week',
    agendaLabel: 'Timetable agenda',
    weekStripLabel: 'Days of the week',
    printPreview: 'Print preview',
    printNow: 'Print',
    printHint: 'Choose “Save as PDF” in the print dialog to keep a copy.',
    filteredBy: (l) => `Filtered: ${l}`,
    filterValue: (l, v) => `${l}: ${v}`,
    generatedOn: (d, t) => `Schedule generated on ${d} at ${t}`,
    printWeek: 'Print week',
    notAvailableYet: (m) => `The ${m} schedule is not available yet.`,
    legendChanged: 'changed',
    pageOf: (p, t) => `Page ${p} of ${t}`,
    changeLanguage: (l) => `In ${l}`,
    continued: 'continued',
    timeLabel: 'Time',
    courseLabel: 'Class',
    noClassesThisMonth: 'No classes this month.',
    aboutCourse: 'About this course',
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
    workshop: 'Workshop',
    workshops: 'Workshop',
    volunteerNote: '* insegnante volontario',
    volunteerSr: 'insegnante volontario',
    holidays: (d) => `Festività: ${d}`,
    languageFilter: 'Lingua',
    allLanguages: 'Tutte le lingue',
    teacherLabel: 'Insegnante',
    substituteBadge: 'Sostituzione',
    timeChangedBadge: 'Orario modificato',
    movedBadge: 'Spostata',
    insteadOf: (n) => `al posto di ${n}`,
    wasTime: (t) => `prima ${t}`,
    scheduleUpdates: 'Variazioni di orario',
    scheduleChangesThisWeek: (n) => n === 1 ? '1 variazione questa settimana' : `${n} variazioni questa settimana`,
    noScheduleChanges: 'Nessuna variazione questa settimana',
    changeSubstitute: (n) => `Sostituzione: ${n}`,
    changeNewTime: (t) => `Nuovo orario ${t}`,
    changeMovedTo: (p) => `Spostata in ${p}`,
    filters: 'Filtri',
    teacherFilter: 'Insegnante',
    allTeachers: 'Tutti gli insegnanti',
    locationFilter: 'Luogo',
    allLocations: 'Tutti i luoghi',
    courseFilter: 'Corso',
    allCourses: 'Tutti i corsi',
    resetFilters: 'Azzera i filtri',
    done: 'Fatto',
    jumpToDate: 'Vai alla data',
    classesCount: (n) => n === 1 ? '1 lezione' : `${n} lezioni`,
    teacherChange: 'Cambio insegnante',
    replaces: (a, b) => `${a} sostituisce ${b}`,
    courseAt: (c, t) => `${c} alle ${t}`,
    previousWeekShort: 'Settimana precedente',
    showAllChanges: (n) => `Mostra tutte le ${n} variazioni`,
    showFewerChanges: 'Mostra meno',
    nextWeekShort: 'Settimana successiva',
    agendaLabel: 'Agenda dell’orario',
    weekStripLabel: 'Giorni della settimana',
    printPreview: 'Anteprima di stampa',
    printNow: 'Stampa',
    printHint: 'Scegli “Salva come PDF” nella finestra di stampa per conservarne una copia.',
    filteredBy: (l) => `Filtri: ${l}`,
    filterValue: (l, v) => `${l}: ${v}`,
    generatedOn: (d, t) => `Orario generato il ${d} alle ${t}`,
    printWeek: 'Stampa settimana',
    notAvailableYet: (m) => `L’orario del mese di ${m} non è ancora disponibile.`,
    legendChanged: 'modificato',
    pageOf: (p, t) => `Pagina ${p} di ${t}`,
    changeLanguage: (l) => `In ${l}`,
    continued: 'continua',
    timeLabel: 'Orario',
    courseLabel: 'Corso',
    noClassesThisMonth: 'Nessun corso questo mese.',
    aboutCourse: 'Scopri il corso',
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
    workshop: 'Workshop',
    workshops: 'Workshops',
    volunteerNote: '* ehrenamtliche Lehrkraft',
    volunteerSr: 'ehrenamtliche Lehrkraft',
    holidays: (d) => `Feiertage: ${d}`,
    languageFilter: 'Sprache',
    allLanguages: 'Alle Sprachen',
    teacherLabel: 'Lehrkraft',
    substituteBadge: 'Vertretung',
    timeChangedBadge: 'Zeit geändert',
    movedBadge: 'Verlegt',
    insteadOf: (n) => `statt ${n}`,
    wasTime: (t) => `vorher ${t}`,
    scheduleUpdates: 'Änderungen im Stundenplan',
    scheduleChangesThisWeek: (n) => n === 1 ? '1 Änderung diese Woche' : `${n} Änderungen diese Woche`,
    noScheduleChanges: 'Keine Änderungen diese Woche',
    changeSubstitute: (n) => `Vertretung: ${n}`,
    changeNewTime: (t) => `Neue Zeit ${t}`,
    changeMovedTo: (p) => `Verlegt nach ${p}`,
    filters: 'Filter',
    teacherFilter: 'Lehrkraft',
    allTeachers: 'Alle Lehrenden',
    locationFilter: 'Ort',
    allLocations: 'Alle Orte',
    courseFilter: 'Kurs',
    allCourses: 'Alle Kurse',
    resetFilters: 'Filter zurücksetzen',
    done: 'Fertig',
    jumpToDate: 'Zum Datum springen',
    classesCount: (n) => n === 1 ? '1 Kurs' : `${n} Kurse`,
    teacherChange: 'Lehrerwechsel',
    replaces: (a, b) => `${a} vertritt ${b}`,
    courseAt: (c, t) => `${c} um ${t}`,
    previousWeekShort: 'Vorherige Woche',
    showAllChanges: (n) => `Alle ${n} Änderungen anzeigen`,
    showFewerChanges: 'Weniger anzeigen',
    nextWeekShort: 'Nächste Woche',
    agendaLabel: 'Agenda des Stundenplans',
    weekStripLabel: 'Wochentage',
    printPreview: 'Druckvorschau',
    printNow: 'Drucken',
    printHint: 'Wählen Sie im Druckdialog „Als PDF sichern“, um eine Kopie zu behalten.',
    filteredBy: (l) => `Gefiltert: ${l}`,
    filterValue: (l, v) => `${l}: ${v}`,
    generatedOn: (d, t) => `Stundenplan erstellt am ${d} um ${t}`,
    printWeek: 'Woche drucken',
    notAvailableYet: (m) => `Der Stundenplan für ${m} ist noch nicht verfügbar.`,
    legendChanged: 'geändert',
    pageOf: (p, t) => `Seite ${p} von ${t}`,
    changeLanguage: (l) => `Auf ${l}`,
    continued: 'Fortsetzung',
    timeLabel: 'Zeit',
    courseLabel: 'Kurs',
    noClassesThisMonth: 'Keine Kurse in diesem Monat.',
    aboutCourse: 'Mehr zum Kurs',
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
    workshop: 'Atelier',
    workshops: 'Ateliers',
    volunteerNote: '* professeur bénévole',
    volunteerSr: 'professeur bénévole',
    holidays: (d) => `Jours fériés : ${d}`,
    languageFilter: 'Langue',
    allLanguages: 'Toutes les langues',
    teacherLabel: 'Enseignant',
    substituteBadge: 'Remplacement',
    timeChangedBadge: 'Horaire modifié',
    movedBadge: 'Déplacé',
    insteadOf: (n) => `à la place de ${n}`,
    wasTime: (t) => `avant ${t}`,
    scheduleUpdates: 'Changements d’horaires',
    scheduleChangesThisWeek: (n) => n === 1 ? '1 changement cette semaine' : `${n} changements cette semaine`,
    noScheduleChanges: 'Aucun changement cette semaine',
    changeSubstitute: (n) => `Remplacement : ${n}`,
    changeNewTime: (t) => `Nouvel horaire ${t}`,
    changeMovedTo: (p) => `Déplacé en ${p}`,
    filters: 'Filtres',
    teacherFilter: 'Enseignant',
    allTeachers: 'Tous les enseignants',
    locationFilter: 'Lieu',
    allLocations: 'Tous les lieux',
    courseFilter: 'Cours',
    allCourses: 'Tous les cours',
    resetFilters: 'Effacer les filtres',
    done: 'Terminé',
    jumpToDate: 'Aller à la date',
    classesCount: (n) => n === 1 ? '1 cours' : `${n} cours`,
    teacherChange: 'Changement de professeur',
    replaces: (a, b) => `${a} remplace ${b}`,
    courseAt: (c, t) => `${c} à ${t}`,
    previousWeekShort: 'Semaine précédente',
    showAllChanges: (n) => `Afficher les ${n} changements`,
    showFewerChanges: 'Afficher moins',
    nextWeekShort: 'Semaine suivante',
    agendaLabel: 'Agenda de l’horaire',
    weekStripLabel: 'Jours de la semaine',
    printPreview: 'Aperçu avant impression',
    printNow: 'Imprimer',
    printHint: 'Choisissez « Enregistrer au format PDF » dans la fenêtre d’impression pour en garder une copie.',
    filteredBy: (l) => `Filtres : ${l}`,
    filterValue: (l, v) => `${l} : ${v}`,
    generatedOn: (d, t) => `Horaire généré le ${d} à ${t}`,
    printWeek: 'Imprimer la semaine',
    notAvailableYet: (m) => `L’horaire du mois de ${m} n’est pas encore disponible.`,
    legendChanged: 'modifié',
    pageOf: (p, t) => `Page ${p} sur ${t}`,
    changeLanguage: (l) => `En ${l}`,
    continued: 'suite',
    timeLabel: 'Heure',
    courseLabel: 'Cours',
    noClassesThisMonth: 'Aucun cours ce mois-ci.',
    aboutCourse: 'Découvrir le cours',
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
    workshop: 'Taller',
    workshops: 'Talleres',
    volunteerNote: '* profesor voluntario',
    volunteerSr: 'profesor voluntario',
    holidays: (d) => `Festivos: ${d}`,
    languageFilter: 'Idioma',
    allLanguages: 'Todos los idiomas',
    teacherLabel: 'Profesor',
    substituteBadge: 'Sustitución',
    timeChangedBadge: 'Horario cambiado',
    movedBadge: 'Trasladada',
    insteadOf: (n) => `en lugar de ${n}`,
    wasTime: (t) => `antes ${t}`,
    scheduleUpdates: 'Cambios de horario',
    scheduleChangesThisWeek: (n) => n === 1 ? '1 cambio esta semana' : `${n} cambios esta semana`,
    noScheduleChanges: 'Sin cambios esta semana',
    changeSubstitute: (n) => `Sustitución: ${n}`,
    changeNewTime: (t) => `Nuevo horario ${t}`,
    changeMovedTo: (p) => `Trasladada a ${p}`,
    filters: 'Filtros',
    teacherFilter: 'Profesor',
    allTeachers: 'Todos los profesores',
    locationFilter: 'Lugar',
    allLocations: 'Todos los lugares',
    courseFilter: 'Clase',
    allCourses: 'Todas las clases',
    resetFilters: 'Quitar filtros',
    done: 'Hecho',
    jumpToDate: 'Ir a la fecha',
    classesCount: (n) => n === 1 ? '1 clase' : `${n} clases`,
    teacherChange: 'Cambio de profesor',
    replaces: (a, b) => `${a} sustituye a ${b}`,
    courseAt: (c, t) => `${c} a las ${t}`,
    previousWeekShort: 'Semana anterior',
    showAllChanges: (n) => `Ver los ${n} cambios`,
    showFewerChanges: 'Ver menos',
    nextWeekShort: 'Semana siguiente',
    agendaLabel: 'Agenda del horario',
    weekStripLabel: 'Días de la semana',
    printPreview: 'Vista previa de impresión',
    printNow: 'Imprimir',
    printHint: 'Elige «Guardar como PDF» en el cuadro de impresión para conservar una copia.',
    filteredBy: (l) => `Filtros: ${l}`,
    filterValue: (l, v) => `${l}: ${v}`,
    generatedOn: (d, t) => `Horario generado el ${d} a las ${t}`,
    printWeek: 'Imprimir semana',
    notAvailableYet: (m) => `El horario de ${m} aún no está disponible.`,
    legendChanged: 'cambiado',
    pageOf: (p, t) => `Página ${p} de ${t}`,
    changeLanguage: (l) => `En ${l}`,
    continued: 'continuación',
    timeLabel: 'Hora',
    courseLabel: 'Clase',
    noClassesThisMonth: 'No hay clases este mes.',
    aboutCourse: 'Ver el curso',
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
    workshop: 'Workshop',
    workshops: 'Workshops',
    volunteerNote: '* professor voluntário',
    volunteerSr: 'professor voluntário',
    holidays: (d) => `Feriados: ${d}`,
    languageFilter: 'Idioma',
    allLanguages: 'Todos os idiomas',
    teacherLabel: 'Professor',
    substituteBadge: 'Substituição',
    timeChangedBadge: 'Horário alterado',
    movedBadge: 'Mudada',
    insteadOf: (n) => `em vez de ${n}`,
    wasTime: (t) => `antes ${t}`,
    scheduleUpdates: 'Alterações de horário',
    scheduleChangesThisWeek: (n) => n === 1 ? '1 alteração esta semana' : `${n} alterações esta semana`,
    noScheduleChanges: 'Sem alterações esta semana',
    changeSubstitute: (n) => `Substituição: ${n}`,
    changeNewTime: (t) => `Novo horário ${t}`,
    changeMovedTo: (p) => `Mudada para ${p}`,
    filters: 'Filtros',
    teacherFilter: 'Professor',
    allTeachers: 'Todos os professores',
    locationFilter: 'Local',
    allLocations: 'Todos os locais',
    courseFilter: 'Aula',
    allCourses: 'Todas as aulas',
    resetFilters: 'Limpar filtros',
    done: 'Concluído',
    jumpToDate: 'Ir para a data',
    classesCount: (n) => n === 1 ? '1 aula' : `${n} aulas`,
    teacherChange: 'Troca de professor',
    replaces: (a, b) => `${a} substitui ${b}`,
    courseAt: (c, t) => `${c} às ${t}`,
    previousWeekShort: 'Semana anterior',
    showAllChanges: (n) => `Ver as ${n} alterações`,
    showFewerChanges: 'Ver menos',
    nextWeekShort: 'Semana seguinte',
    agendaLabel: 'Agenda do horário',
    weekStripLabel: 'Dias da semana',
    printPreview: 'Pré-visualização de impressão',
    printNow: 'Imprimir',
    printHint: 'Escolha “Guardar como PDF” na janela de impressão para guardar uma cópia.',
    filteredBy: (l) => `Filtros: ${l}`,
    filterValue: (l, v) => `${l}: ${v}`,
    generatedOn: (d, t) => `Horário gerado em ${d} às ${t}`,
    printWeek: 'Imprimir semana',
    notAvailableYet: (m) => `O horário de ${m} ainda não está disponível.`,
    legendChanged: 'alterado',
    pageOf: (p, t) => `Página ${p} de ${t}`,
    changeLanguage: (l) => `Em ${l}`,
    continued: 'continuação',
    timeLabel: 'Hora',
    courseLabel: 'Aula',
    noClassesThisMonth: 'Sem aulas este mês.',
    aboutCourse: 'Ver o curso',
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
    workshop: 'Workshop',
    workshops: 'Workshops',
    volunteerNote: '* vrijwillige leraar',
    volunteerSr: 'vrijwillige leraar',
    holidays: (d) => `Feestdagen: ${d}`,
    languageFilter: 'Taal',
    allLanguages: 'Alle talen',
    teacherLabel: 'Docent',
    substituteBadge: 'Vervanging',
    timeChangedBadge: 'Tijd gewijzigd',
    movedBadge: 'Verplaatst',
    insteadOf: (n) => `in plaats van ${n}`,
    wasTime: (t) => `eerder ${t}`,
    scheduleUpdates: 'Roosterwijzigingen',
    scheduleChangesThisWeek: (n) => n === 1 ? '1 wijziging deze week' : `${n} wijzigingen deze week`,
    noScheduleChanges: 'Geen wijzigingen deze week',
    changeSubstitute: (n) => `Vervanging: ${n}`,
    changeNewTime: (t) => `Nieuwe tijd ${t}`,
    changeMovedTo: (p) => `Verplaatst naar ${p}`,
    filters: 'Filters',
    teacherFilter: 'Docent',
    allTeachers: 'Alle docenten',
    locationFilter: 'Locatie',
    allLocations: 'Alle locaties',
    courseFilter: 'Les',
    allCourses: 'Alle lessen',
    resetFilters: 'Filters wissen',
    done: 'Klaar',
    jumpToDate: 'Ga naar datum',
    classesCount: (n) => n === 1 ? '1 les' : `${n} lessen`,
    teacherChange: 'Andere docent',
    replaces: (a, b) => `${a} vervangt ${b}`,
    courseAt: (c, t) => `${c} om ${t}`,
    previousWeekShort: 'Vorige week',
    showAllChanges: (n) => `Alle ${n} wijzigingen tonen`,
    showFewerChanges: 'Minder tonen',
    nextWeekShort: 'Volgende week',
    agendaLabel: 'Agenda van het rooster',
    weekStripLabel: 'Dagen van de week',
    printPreview: 'Afdrukvoorbeeld',
    printNow: 'Afdrukken',
    printHint: 'Kies ‘Opslaan als PDF’ in het afdrukvenster om een kopie te bewaren.',
    filteredBy: (l) => `Filters: ${l}`,
    filterValue: (l, v) => `${l}: ${v}`,
    generatedOn: (d, t) => `Rooster gemaakt op ${d} om ${t}`,
    printWeek: 'Week afdrukken',
    notAvailableYet: (m) => `Het rooster voor ${m} is nog niet beschikbaar.`,
    legendChanged: 'gewijzigd',
    pageOf: (p, t) => `Pagina ${p} van ${t}`,
    changeLanguage: (l) => `In het ${l}`,
    continued: 'vervolg',
    timeLabel: 'Tijd',
    courseLabel: 'Les',
    noClassesThisMonth: 'Geen lessen deze maand.',
    aboutCourse: 'Meer over deze cursus',
  },
}

export function getTimetableMessages(locale: string | undefined): TimetableMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export const TIMETABLE_MESSAGES_FOR_TEST = MESSAGES
