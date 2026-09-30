/**
 * Locations section UI messages.
 *
 * Platform chrome for LocationsSection — the "Open in Google Maps" link and
 * its new-tab hint. Not tenant content (names, addresses and access notes are
 * content in siteConfig.locations), so it lives in a locale dictionary — same
 * pattern as team-section-messages.ts.
 */

export interface LocationsSectionMessages {
  /** Visible label of a location's Google Maps link. */
  openInMaps: string
  /** Screen-reader hint appended to links that open in a new tab. */
  opensInNewTab: string
}

const MESSAGES: Record<string, LocationsSectionMessages> = {
  en: { openInMaps: 'Open in Google Maps',    opensInNewTab: 'opens in a new tab' },
  it: { openInMaps: 'Apri in Google Maps',    opensInNewTab: 'si apre in una nuova scheda' },
  de: { openInMaps: 'In Google Maps öffnen',  opensInNewTab: 'öffnet in einem neuen Tab' },
  fr: { openInMaps: 'Ouvrir dans Google Maps', opensInNewTab: "s'ouvre dans un nouvel onglet" },
  es: { openInMaps: 'Abrir en Google Maps',   opensInNewTab: 'se abre en una pestaña nueva' },
  pt: { openInMaps: 'Abrir no Google Maps',   opensInNewTab: 'abre num novo separador' },
  nl: { openInMaps: 'Openen in Google Maps',  opensInNewTab: 'opent in een nieuw tabblad' },
}

export function getLocationsSectionMessages(locale: string | undefined): LocationsSectionMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export const LOCATIONS_SECTION_MESSAGES_FOR_TEST = MESSAGES
