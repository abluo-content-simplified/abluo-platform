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
  fr: {
    addressLabel:    'Adresse',
    phoneLabel:      'Téléphone',
    emailLabel:      'E-mail',
    directionsLabel: 'Comment nous trouver',
    mapTitle:        'Carte de localisation',
    openInMapsLabel: 'Ouvrir dans Google Maps',
  },
  es: {
    addressLabel:    'Dirección',
    phoneLabel:      'Teléfono',
    emailLabel:      'Email',
    directionsLabel: 'Cómo llegar',
    mapTitle:        'Mapa de ubicación',
    openInMapsLabel: 'Abrir en Google Maps',
  },
  pt: {
    addressLabel:    'Morada',
    phoneLabel:      'Telefone',
    emailLabel:      'Email',
    directionsLabel: 'Como chegar',
    mapTitle:        'Mapa de localização',
    openInMapsLabel: 'Abrir no Google Maps',
  },
  nl: {
    addressLabel:    'Adres',
    phoneLabel:      'Telefoon',
    emailLabel:      'E-mail',
    directionsLabel: 'Zo kom je hier',
    mapTitle:        'Locatiekaart',
    openInMapsLabel: 'Openen in Google Maps',
  },
}

export function getContactSectionMessages(locale: string): ContactSectionMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
