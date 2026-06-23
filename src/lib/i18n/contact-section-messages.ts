/**
 * ContactSection UI Messages
 *
 * Locale-aware labels for the ContactSection chrome — address/phone/email
 * headings, map title, directions link, etc. These are platform UI strings,
 * not tenant content, so they live in locale dictionaries rather than Sanity.
 *
 * FUTURE: replace with next-intl `getTranslations` once the messages/
 * directory is the authoritative source for all UI strings.
 */

export interface ContactSectionMessages {
  addressLabel: string
  phoneLabel: string
  emailLabel: string
  directionsLabel: string
  mapTitle: string
  openInMapsLabel: string
}

const MESSAGES: Record<string, ContactSectionMessages> = {
  en: {
    addressLabel:    'Address',
    phoneLabel:      'Phone',
    emailLabel:      'Email',
    directionsLabel: 'How to get here',
    mapTitle:        'Location map',
    openInMapsLabel: 'Open in Google Maps',
  },
  it: {
    addressLabel:    'Indirizzo',
    phoneLabel:      'Telefono',
    emailLabel:      'Email',
    directionsLabel: 'Come arrivare',
    mapTitle:        'Mappa dello studio',
    openInMapsLabel: 'Apri in Google Maps',
  },
  de: {
    addressLabel:    'Adresse',
    phoneLabel:      'Telefon',
    emailLabel:      'E-Mail',
    directionsLabel: 'So kommen Sie zu uns',
    mapTitle:        'Standortkarte',
    openInMapsLabel: 'In Google Maps öffnen',
  },
}

export function getContactSectionMessages(locale: string): ContactSectionMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
