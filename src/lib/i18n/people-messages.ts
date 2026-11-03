/**
 * People module — website UI messages (ADR-043 D7).
 *
 * Platform chrome for the profile page, contact list and cards: labels, not
 * tenant content (names, titles and bios come from Sanity). Locale dictionary,
 * same pattern as team-section-messages.ts. Languages are named with
 * Intl.DisplayNames, and "A, B and C" with Intl.ListFormat, so neither needs a
 * word here.
 */

export interface PeopleMessages {
  /** Link on a team card that leads to the person's own page. */
  viewProfile: string
  /** Heading: languages the person speaks. */
  languages: string
  /** Heading: qualifications. */
  qualifications: string
  /** Heading: how to reach the person. */
  contact: string
  /** "valid until 2027" after a qualification. */
  validUntil: string
  /** Visible label of an e-mail contact before the address is assembled. */
  email: string
  /** Visible label of a WhatsApp contact. */
  whatsapp: string
  /** Visible label of a phone contact without a label of its own. */
  phone: string
  /** Visible label of a website contact without a label of its own. */
  website: string
  instagram: string
  linkedin: string
  /** Screen-reader hint appended to links that open in a new tab. */
  opensInNewTab: string
  /** The e-mail address needs JavaScript to be shown (spam protection). */
  emailNeedsScript: string
}

const MESSAGES: Record<string, PeopleMessages> = {
  en: {
    viewProfile: 'View profile', languages: 'Languages', qualifications: 'Qualifications', contact: 'Contact',
    validUntil: 'valid until', email: 'Email', whatsapp: 'WhatsApp', phone: 'Phone', website: 'Website',
    instagram: 'Instagram', linkedin: 'LinkedIn', opensInNewTab: 'opens in a new tab',
    emailNeedsScript: 'Turn on JavaScript to see the email address',
  },
  it: {
    viewProfile: 'Vedi il profilo', languages: 'Lingue', qualifications: 'Titoli e qualifiche', contact: 'Contatti',
    validUntil: 'valido fino al', email: 'Email', whatsapp: 'WhatsApp', phone: 'Telefono', website: 'Sito web',
    instagram: 'Instagram', linkedin: 'LinkedIn', opensInNewTab: 'si apre in una nuova scheda',
    emailNeedsScript: "Attiva JavaScript per vedere l'indirizzo email",
  },
  de: {
    viewProfile: 'Profil ansehen', languages: 'Sprachen', qualifications: 'Qualifikationen', contact: 'Kontakt',
    validUntil: 'gültig bis', email: 'E-Mail', whatsapp: 'WhatsApp', phone: 'Telefon', website: 'Website',
    instagram: 'Instagram', linkedin: 'LinkedIn', opensInNewTab: 'öffnet in einem neuen Tab',
    emailNeedsScript: 'Aktiviere JavaScript, um die E-Mail-Adresse zu sehen',
  },
  fr: {
    viewProfile: 'Voir le profil', languages: 'Langues', qualifications: 'Qualifications', contact: 'Contact',
    validUntil: "valable jusqu'en", email: 'E-mail', whatsapp: 'WhatsApp', phone: 'Téléphone', website: 'Site web',
    instagram: 'Instagram', linkedin: 'LinkedIn', opensInNewTab: "s'ouvre dans un nouvel onglet",
    emailNeedsScript: "Activez JavaScript pour voir l'adresse e-mail",
  },
  es: {
    viewProfile: 'Ver perfil', languages: 'Idiomas', qualifications: 'Titulaciones', contact: 'Contacto',
    validUntil: 'válido hasta', email: 'Correo', whatsapp: 'WhatsApp', phone: 'Teléfono', website: 'Sitio web',
    instagram: 'Instagram', linkedin: 'LinkedIn', opensInNewTab: 'se abre en una pestaña nueva',
    emailNeedsScript: 'Activa JavaScript para ver el correo electrónico',
  },
  pt: {
    viewProfile: 'Ver perfil', languages: 'Idiomas', qualifications: 'Qualificações', contact: 'Contacto',
    validUntil: 'válido até', email: 'E-mail', whatsapp: 'WhatsApp', phone: 'Telefone', website: 'Site',
    instagram: 'Instagram', linkedin: 'LinkedIn', opensInNewTab: 'abre num novo separador',
    emailNeedsScript: 'Ative o JavaScript para ver o endereço de e-mail',
  },
  nl: {
    viewProfile: 'Bekijk profiel', languages: 'Talen', qualifications: 'Kwalificaties', contact: 'Contact',
    validUntil: 'geldig tot', email: 'E-mail', whatsapp: 'WhatsApp', phone: 'Telefoon', website: 'Website',
    instagram: 'Instagram', linkedin: 'LinkedIn', opensInNewTab: 'opent in een nieuw tabblad',
    emailNeedsScript: 'Zet JavaScript aan om het e-mailadres te zien',
  },
}

export function getPeopleMessages(locale: string | undefined): PeopleMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export const PEOPLE_MESSAGES_FOR_TEST = MESSAGES
