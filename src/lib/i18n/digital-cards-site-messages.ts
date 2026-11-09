/**
 * Digital Cards — website messages (ADR-049). Platform chrome of the public
 * /link pages: the standard labels of links without a label of their own, the
 * Save contact button, the small "More about …" link and the screen-reader
 * headings. Tenant content (names, labels, descriptions) comes from Sanity.
 *
 * Same dictionary pattern as people-messages.ts / testimonials-messages.ts:
 * every platform locale, English fallback, `{name}` placeholders filled by
 * formatDigitalCardSiteMessage(). (Dashboard strings live in
 * digital-cards-messages.ts — a different file, a different audience.)
 */

export interface DigitalCardSiteMessages {
  /** Standard link labels, used when a link has no label of its own (D8). */
  linkUrl: string
  linkPage: string
  linkForm: string
  linkBooking: string
  linkWhatsapp: string
  linkPhone: string
  linkEmail: string
  linkFile: string
  /** Visible names of the contact rows. */
  phone: string
  email: string
  whatsapp: string
  /** The vCard download button. */
  saveContact: string
  /** Person card → the person's profile page. `{name}` = first name. */
  moreAbout: string
  /** Opens the location in a maps app. */
  directions: string
  /** Screen-reader headings of the card's parts. */
  linksHeading: string
  contactHeading: string
  socialsHeading: string
  locationsHeading: string
  legalHeading: string
  /** Appended (screen readers) to links that open in a new tab. */
  opensInNewTab: string
  /** A contact row before its value is assembled (spam protection needs JavaScript). */
  needsScript: string
  /** Share preview fallback: `{name}` = the site name. */
  ogFallbackTitle: string
}

const MESSAGES: Record<string, DigitalCardSiteMessages> = {
  en: {
    linkUrl: 'Website', linkPage: 'Open page', linkForm: 'Get in touch', linkBooking: 'Book now',
    linkWhatsapp: 'WhatsApp', linkPhone: 'Call', linkEmail: 'Send an email', linkFile: 'Download',
    phone: 'Phone', email: 'Email', whatsapp: 'WhatsApp',
    saveContact: 'Save contact', moreAbout: 'More about {name}', directions: 'Directions',
    linksHeading: 'Links', contactHeading: 'Contact', socialsHeading: 'Social profiles', locationsHeading: 'Locations',
    legalHeading: 'Legal information', opensInNewTab: 'opens in a new tab',
    needsScript: 'Turn on JavaScript to see this contact', ogFallbackTitle: '{name} — digital card',
  },
  it: {
    linkUrl: 'Sito web', linkPage: 'Apri la pagina', linkForm: 'Scrivici', linkBooking: 'Prenota',
    linkWhatsapp: 'WhatsApp', linkPhone: 'Chiama', linkEmail: "Invia un'email", linkFile: 'Scarica',
    phone: 'Telefono', email: 'Email', whatsapp: 'WhatsApp',
    saveContact: 'Salva contatto', moreAbout: 'Scopri di più su {name}', directions: 'Indicazioni',
    linksHeading: 'Link', contactHeading: 'Contatti', socialsHeading: 'Profili social', locationsHeading: 'Sedi',
    legalHeading: 'Note legali', opensInNewTab: 'si apre in una nuova scheda',
    needsScript: 'Attiva JavaScript per vedere questo contatto', ogFallbackTitle: '{name} — biglietto digitale',
  },
  de: {
    linkUrl: 'Website', linkPage: 'Seite öffnen', linkForm: 'Kontakt aufnehmen', linkBooking: 'Jetzt buchen',
    linkWhatsapp: 'WhatsApp', linkPhone: 'Anrufen', linkEmail: 'E-Mail schreiben', linkFile: 'Herunterladen',
    phone: 'Telefon', email: 'E-Mail', whatsapp: 'WhatsApp',
    saveContact: 'Kontakt speichern', moreAbout: 'Mehr über {name}', directions: 'Route',
    linksHeading: 'Links', contactHeading: 'Kontakt', socialsHeading: 'Soziale Profile', locationsHeading: 'Standorte',
    legalHeading: 'Rechtliches', opensInNewTab: 'öffnet in einem neuen Tab',
    needsScript: 'JavaScript einschalten, um diesen Kontakt zu sehen', ogFallbackTitle: '{name} — digitale Karte',
  },
  fr: {
    linkUrl: 'Site web', linkPage: 'Ouvrir la page', linkForm: 'Nous écrire', linkBooking: 'Réserver',
    linkWhatsapp: 'WhatsApp', linkPhone: 'Appeler', linkEmail: 'Envoyer un e-mail', linkFile: 'Télécharger',
    phone: 'Téléphone', email: 'E-mail', whatsapp: 'WhatsApp',
    saveContact: 'Enregistrer le contact', moreAbout: 'En savoir plus sur {name}', directions: 'Itinéraire',
    linksHeading: 'Liens', contactHeading: 'Contact', socialsHeading: 'Réseaux sociaux', locationsHeading: 'Adresses',
    legalHeading: 'Informations légales', opensInNewTab: "s'ouvre dans un nouvel onglet",
    needsScript: 'Activez JavaScript pour voir ce contact', ogFallbackTitle: '{name} — carte digitale',
  },
  es: {
    linkUrl: 'Sitio web', linkPage: 'Abrir la página', linkForm: 'Escríbenos', linkBooking: 'Reservar',
    linkWhatsapp: 'WhatsApp', linkPhone: 'Llamar', linkEmail: 'Enviar un correo', linkFile: 'Descargar',
    phone: 'Teléfono', email: 'Correo', whatsapp: 'WhatsApp',
    saveContact: 'Guardar contacto', moreAbout: 'Más sobre {name}', directions: 'Cómo llegar',
    linksHeading: 'Enlaces', contactHeading: 'Contacto', socialsHeading: 'Redes sociales', locationsHeading: 'Direcciones',
    legalHeading: 'Información legal', opensInNewTab: 'se abre en una pestaña nueva',
    needsScript: 'Activa JavaScript para ver este contacto', ogFallbackTitle: '{name} — tarjeta digital',
  },
  pt: {
    linkUrl: 'Site', linkPage: 'Abrir a página', linkForm: 'Fale connosco', linkBooking: 'Reservar',
    linkWhatsapp: 'WhatsApp', linkPhone: 'Ligar', linkEmail: 'Enviar um e-mail', linkFile: 'Descarregar',
    phone: 'Telefone', email: 'E-mail', whatsapp: 'WhatsApp',
    saveContact: 'Guardar contacto', moreAbout: 'Mais sobre {name}', directions: 'Direções',
    linksHeading: 'Ligações', contactHeading: 'Contacto', socialsHeading: 'Redes sociais', locationsHeading: 'Moradas',
    legalHeading: 'Informação legal', opensInNewTab: 'abre num novo separador',
    needsScript: 'Ative o JavaScript para ver este contacto', ogFallbackTitle: '{name} — cartão digital',
  },
  nl: {
    linkUrl: 'Website', linkPage: 'Pagina openen', linkForm: 'Neem contact op', linkBooking: 'Nu boeken',
    linkWhatsapp: 'WhatsApp', linkPhone: 'Bellen', linkEmail: 'E-mail sturen', linkFile: 'Downloaden',
    phone: 'Telefoon', email: 'E-mail', whatsapp: 'WhatsApp',
    saveContact: 'Contact opslaan', moreAbout: 'Meer over {name}', directions: 'Route',
    linksHeading: 'Links', contactHeading: 'Contact', socialsHeading: 'Sociale profielen', locationsHeading: 'Locaties',
    legalHeading: 'Juridische informatie', opensInNewTab: 'opent in een nieuw tabblad',
    needsScript: 'Zet JavaScript aan om dit contact te zien', ogFallbackTitle: '{name} — digitale kaart',
  },
}

export function getDigitalCardSiteMessages(locale: string | null | undefined): DigitalCardSiteMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

/** Fills `{key}` placeholders. */
export function formatDigitalCardSiteMessage(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m))
}

export const DIGITAL_CARD_SITE_MESSAGES_FOR_TEST = MESSAGES
