/**
 * Abluo credit line in the website footer — "Made with a little help from abluo."
 *
 * The logo is drawn between `before` and `after`, so a language can place it
 * mid-sentence. "abluo" itself is the product name and is never translated.
 * Unknown locales fall back to English.
 */

export interface AbluoCreditMessages {
  before: string
  after: string
}

const MESSAGES: Record<string, AbluoCreditMessages> = {
  en: { before: 'Made with a little help from', after: '' },
  it: { before: 'Realizzato con un piccolo aiuto di', after: '' },
  de: { before: 'Gemacht mit ein wenig Hilfe von', after: '' },
}

export function getAbluoCreditMessages(locale: string): AbluoCreditMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
