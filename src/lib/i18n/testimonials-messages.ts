/**
 * Testimonials website messages (ADR-048 D5, D6).
 *
 * Platform chrome for the testimonials section — button names, screen-reader
 * labels, the language notes and the disclosure line. Not tenant content, so a
 * locale dictionary rather than Sanity (same pattern as faq-messages.ts and
 * gallery-messages.ts). One entry per platform locale; the completeness test
 * fails when a locale or a key is missing.
 *
 * Placeholders ({name}, {rating}, {n}, {total}, {language}, {source}, {age})
 * are filled by `formatTestimonialMessage`.
 *
 * Language names ({language}) come from Intl.DisplayNames in the visitor's
 * language, so the sentences are worded to stay grammatical with a bare
 * language name ("Original auf Französisch", "uit het Frans").
 */

export interface TestimonialMessages {
  /** Button on a card that opens the full testimonial. */
  readMore: string
  /** Accessible name of that button: "Read more — testimonial by {name}". */
  readMoreAbout: string
  /** Accessible name of the window when the testimonial has no name. */
  dialogFallback: string
  close: string
  previous: string
  next: string
  /** Name line of an anonymous testimonial. */
  anonymous: string
  /** "{rating} out of 5 stars" — the stars' accessible name. */
  ratingLabel: string
  /** "{age} years old". */
  ageYears: string
  /** Language note: machine-translated text; {language} = the original language. */
  translatedFrom: string
  /** Language note: no text in the page language; {language} = the language shown. */
  inLanguage: string
  /** The disclosure line under the section. */
  disclosure: string
  /** Accessible name of the carousel region. */
  carouselLabel: string
  /** Accessible name of a slide: "{n} of {total}". */
  slideLabel: string
  /** Source attribution: "on {source}". */
  onSource: string
}

const MESSAGES: Record<string, TestimonialMessages> = {
  en: {
    readMore: 'Read more',
    readMoreAbout: 'Read more: testimonial by {name}',
    dialogFallback: 'Testimonial',
    close: 'Close',
    previous: 'Previous testimonials',
    next: 'Next testimonials',
    anonymous: 'Anonymous',
    ratingLabel: '{rating} out of 5 stars',
    ageYears: '{age} years old',
    translatedFrom: 'Translated from {language}',
    inLanguage: '(in {language})',
    disclosure: 'Selected testimonials, published with permission.',
    carouselLabel: 'Testimonials',
    slideLabel: '{n} of {total}',
    onSource: 'on {source}',
  },
  it: {
    readMore: 'Leggi tutto',
    readMoreAbout: 'Leggi tutto: testimonianza di {name}',
    dialogFallback: 'Testimonianza',
    close: 'Chiudi',
    previous: 'Testimonianze precedenti',
    next: 'Testimonianze successive',
    anonymous: 'Anonimo',
    ratingLabel: '{rating} stelle su 5',
    ageYears: '{age} anni',
    translatedFrom: 'Tradotto · originale in {language}',
    inLanguage: '(in {language})',
    disclosure: 'Testimonianze selezionate, pubblicate con il consenso degli autori.',
    carouselLabel: 'Testimonianze',
    slideLabel: '{n} di {total}',
    onSource: 'su {source}',
  },
  de: {
    readMore: 'Weiterlesen',
    readMoreAbout: 'Weiterlesen: Erfahrungsbericht von {name}',
    dialogFallback: 'Erfahrungsbericht',
    close: 'Schließen',
    previous: 'Vorherige Erfahrungsberichte',
    next: 'Nächste Erfahrungsberichte',
    anonymous: 'Anonym',
    ratingLabel: '{rating} von 5 Sternen',
    ageYears: '{age} Jahre',
    translatedFrom: 'Übersetzt · Original auf {language}',
    inLanguage: '(auf {language})',
    disclosure: 'Ausgewählte Erfahrungsberichte, mit Einverständnis veröffentlicht.',
    carouselLabel: 'Erfahrungsberichte',
    slideLabel: '{n} von {total}',
    onSource: 'auf {source}',
  },
  fr: {
    readMore: 'Lire la suite',
    readMoreAbout: 'Lire la suite : témoignage de {name}',
    dialogFallback: 'Témoignage',
    close: 'Fermer',
    previous: 'Témoignages précédents',
    next: 'Témoignages suivants',
    anonymous: 'Anonyme',
    ratingLabel: '{rating} étoiles sur 5',
    ageYears: '{age} ans',
    translatedFrom: 'Traduit · original en {language}',
    inLanguage: '(en {language})',
    disclosure: 'Témoignages sélectionnés, publiés avec l’accord de leurs auteurs.',
    carouselLabel: 'Témoignages',
    slideLabel: '{n} sur {total}',
    onSource: 'sur {source}',
  },
  es: {
    readMore: 'Leer más',
    readMoreAbout: 'Leer más: testimonio de {name}',
    dialogFallback: 'Testimonio',
    close: 'Cerrar',
    previous: 'Testimonios anteriores',
    next: 'Testimonios siguientes',
    anonymous: 'Anónimo',
    ratingLabel: '{rating} de 5 estrellas',
    ageYears: '{age} años',
    translatedFrom: 'Traducido · original en {language}',
    inLanguage: '(en {language})',
    disclosure: 'Testimonios seleccionados, publicados con permiso.',
    carouselLabel: 'Testimonios',
    slideLabel: '{n} de {total}',
    onSource: 'en {source}',
  },
  pt: {
    readMore: 'Ler mais',
    readMoreAbout: 'Ler mais: testemunho de {name}',
    dialogFallback: 'Testemunho',
    close: 'Fechar',
    previous: 'Testemunhos anteriores',
    next: 'Testemunhos seguintes',
    anonymous: 'Anónimo',
    ratingLabel: '{rating} de 5 estrelas',
    ageYears: '{age} anos',
    translatedFrom: 'Traduzido · original em {language}',
    inLanguage: '(em {language})',
    disclosure: 'Testemunhos selecionados, publicados com autorização.',
    carouselLabel: 'Testemunhos',
    slideLabel: '{n} de {total}',
    onSource: 'no {source}',
  },
  nl: {
    readMore: 'Lees meer',
    readMoreAbout: 'Lees meer: getuigenis van {name}',
    dialogFallback: 'Getuigenis',
    close: 'Sluiten',
    previous: 'Vorige getuigenissen',
    next: 'Volgende getuigenissen',
    anonymous: 'Anoniem',
    ratingLabel: '{rating} van de 5 sterren',
    ageYears: '{age} jaar',
    translatedFrom: 'Vertaald · origineel in het {language}',
    inLanguage: '(in het {language})',
    disclosure: 'Geselecteerde getuigenissen, met toestemming gepubliceerd.',
    carouselLabel: 'Getuigenissen',
    slideLabel: '{n} van {total}',
    onSource: 'op {source}',
  },
}

export function getTestimonialMessages(locale: string | undefined): TestimonialMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

/** Fills {placeholders}; an unknown placeholder is left as written. */
export function formatTestimonialMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m))
}

/** Exposed for the completeness test. */
export const TESTIMONIAL_MESSAGES_FOR_TEST = MESSAGES
