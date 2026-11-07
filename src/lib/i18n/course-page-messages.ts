/**
 * Course page + course listing section UI messages (Courses module, ADR-045 D5).
 *
 * Platform chrome for the course's own page and the Course List section: labels,
 * not tenant content (titles, descriptions, teachers and places come from
 * Sanity / scheduling). Locale dictionary for the page's CONTENT language, same
 * pattern as timetable-messages.ts. Weekday, month and language names come from
 * Intl; repeat wording ("Every Thursday") from describeClassRepeat. German
 * addresses the visitor formally (website text).
 */

export interface CoursePageMessages {
  /** Heading of the list of weekly classes. */
  when: string
  /** The course has no class that still runs. */
  noClasses: string
  teacherLabel: string
  teachersLabel: string
  placeLabel: string
  languagesLabel: string
  /** Where an online-only class happens. */
  online: string
  /** A class held in the room and online. */
  hybrid: string
  /** "Next class: Thursday 12 November". */
  nextClass: (date: string) => string
  /** A class that starts later: "Starts on 12 January". */
  startsOn: (date: string) => string
  /** A class that ends: "Until 18 December". */
  until: (date: string) => string
  /** Link to the published timetable page that shows the course. */
  seeTimetable: string
  openInMaps: string
  /** Screen-reader hint appended to links that open in a new tab. */
  opensInNewTab: string
  /** Link on a course card (Course List section) that leads to the course page. */
  viewCourse: string
}

const MESSAGES: Record<string, CoursePageMessages> = {
  en: {
    when: 'When',
    noClasses: 'No classes are planned at the moment.',
    teacherLabel: 'Teacher',
    teachersLabel: 'Teachers',
    placeLabel: 'Place',
    languagesLabel: 'Languages',
    online: 'Online',
    hybrid: 'In person and online',
    nextClass: (d) => `Next class: ${d}`,
    startsOn: (d) => `Starts on ${d}`,
    until: (d) => `Until ${d}`,
    seeTimetable: 'See the full timetable',
    openInMaps: 'Open in maps',
    opensInNewTab: 'opens in a new tab',
    viewCourse: 'About this course',
  },
  it: {
    when: 'Quando',
    noClasses: 'Al momento non ci sono lezioni in programma.',
    teacherLabel: 'Insegnante',
    teachersLabel: 'Insegnanti',
    placeLabel: 'Luogo',
    languagesLabel: 'Lingue',
    online: 'Online',
    hybrid: 'In presenza e online',
    nextClass: (d) => `Prossima lezione: ${d}`,
    startsOn: (d) => `Inizia il ${d}`,
    until: (d) => `Fino al ${d}`,
    seeTimetable: 'Vedi l’orario completo',
    openInMaps: 'Apri nelle mappe',
    opensInNewTab: 'si apre in una nuova scheda',
    viewCourse: 'Scopri il corso',
  },
  de: {
    when: 'Wann',
    noClasses: 'Derzeit sind keine Termine geplant.',
    teacherLabel: 'Lehrkraft',
    teachersLabel: 'Lehrende',
    placeLabel: 'Ort',
    languagesLabel: 'Sprachen',
    online: 'Online',
    hybrid: 'Vor Ort und online',
    nextClass: (d) => `Nächster Termin: ${d}`,
    startsOn: (d) => `Beginnt am ${d}`,
    until: (d) => `Bis ${d}`,
    seeTimetable: 'Zum vollständigen Stundenplan',
    openInMaps: 'In Karten öffnen',
    opensInNewTab: 'öffnet in einem neuen Tab',
    viewCourse: 'Mehr zum Kurs',
  },
  fr: {
    when: 'Quand',
    noClasses: 'Aucun cours n’est prévu pour le moment.',
    teacherLabel: 'Enseignant',
    teachersLabel: 'Enseignants',
    placeLabel: 'Lieu',
    languagesLabel: 'Langues',
    online: 'En ligne',
    hybrid: 'Sur place et en ligne',
    nextClass: (d) => `Prochain cours : ${d}`,
    startsOn: (d) => `À partir du ${d}`,
    until: (d) => `Jusqu’au ${d}`,
    seeTimetable: 'Voir tout l’horaire',
    openInMaps: 'Ouvrir dans les cartes',
    opensInNewTab: 's’ouvre dans un nouvel onglet',
    viewCourse: 'Découvrir le cours',
  },
  es: {
    when: 'Cuándo',
    noClasses: 'Por ahora no hay clases previstas.',
    teacherLabel: 'Profesor',
    teachersLabel: 'Profesores',
    placeLabel: 'Lugar',
    languagesLabel: 'Idiomas',
    online: 'En línea',
    hybrid: 'Presencial y en línea',
    nextClass: (d) => `Próxima clase: ${d}`,
    startsOn: (d) => `Empieza el ${d}`,
    until: (d) => `Hasta el ${d}`,
    seeTimetable: 'Ver el horario completo',
    openInMaps: 'Abrir en mapas',
    opensInNewTab: 'se abre en una pestaña nueva',
    viewCourse: 'Ver el curso',
  },
  pt: {
    when: 'Quando',
    noClasses: 'De momento não há aulas previstas.',
    teacherLabel: 'Professor',
    teachersLabel: 'Professores',
    placeLabel: 'Local',
    languagesLabel: 'Idiomas',
    online: 'Online',
    hybrid: 'Presencial e online',
    nextClass: (d) => `Próxima aula: ${d}`,
    startsOn: (d) => `Começa a ${d}`,
    until: (d) => `Até ${d}`,
    seeTimetable: 'Ver o horário completo',
    openInMaps: 'Abrir nos mapas',
    opensInNewTab: 'abre num novo separador',
    viewCourse: 'Ver o curso',
  },
  nl: {
    when: 'Wanneer',
    noClasses: 'Er zijn op dit moment geen lessen gepland.',
    teacherLabel: 'Docent',
    teachersLabel: 'Docenten',
    placeLabel: 'Locatie',
    languagesLabel: 'Talen',
    online: 'Online',
    hybrid: 'Ter plaatse en online',
    nextClass: (d) => `Volgende les: ${d}`,
    startsOn: (d) => `Begint op ${d}`,
    until: (d) => `Tot ${d}`,
    seeTimetable: 'Bekijk het volledige rooster',
    openInMaps: 'Openen in kaarten',
    opensInNewTab: 'opent in een nieuw tabblad',
    viewCourse: 'Meer over deze cursus',
  },
}

export function getCoursePageMessages(locale: string | undefined): CoursePageMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export const COURSE_PAGE_MESSAGES_FOR_TEST = MESSAGES
