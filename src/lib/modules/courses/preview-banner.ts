/**
 * The banner of the private course preview (website side). Tiny on purpose:
 * the preview opens in the site's content language, and any language without
 * a line here falls back to English.
 */
export const COURSE_PREVIEW_BANNER: Record<string, { title: string; body: string }> = {
  en: { title: 'Preview — not on the website yet', body: 'This is how the timetable will look with this course in it. Only people with this private link can see it, for a short time.' },
  it: { title: 'Anteprima — non ancora sul sito', body: 'Così apparirà il calendario con questo corso. Solo chi ha questo link privato può vederla, per poco tempo.' },
  de: { title: 'Vorschau — noch nicht auf der Website', body: 'So sieht der Stundenplan mit diesem Kurs aus. Nur wer diesen privaten Link hat, kann ihn sehen, und nur kurz.' },
}

export const coursePreviewBanner = (locale: string) => COURSE_PREVIEW_BANNER[locale] ?? COURSE_PREVIEW_BANNER.en
