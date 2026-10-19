/**
 * FAQ placement messages (ADR-037 D5, D6).
 *
 * Platform chrome for FAQ placements — not tenant content, so a locale
 * dictionary rather than Sanity (same pattern as gallery-messages.ts). One key
 * per platform locale; the completeness test fails when a locale is missing.
 */

export interface FaqMessages {
  /** Heading of a post's FAQs when the editor left the title empty. */
  defaultHeading: string
}

const MESSAGES: Record<string, FaqMessages> = {
  en: { defaultHeading: 'Frequently Asked Questions' },
  it: { defaultHeading: 'Domande frequenti' },
  de: { defaultHeading: 'Häufig gestellte Fragen' },
  fr: { defaultHeading: 'Questions fréquentes' },
  es: { defaultHeading: 'Preguntas frecuentes' },
  pt: { defaultHeading: 'Perguntas frequentes' },
  nl: { defaultHeading: 'Veelgestelde vragen' },
}

export function getFaqMessages(locale: string | undefined): FaqMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

/** Exposed for the completeness test. */
export const FAQ_MESSAGES_FOR_TEST = MESSAGES
