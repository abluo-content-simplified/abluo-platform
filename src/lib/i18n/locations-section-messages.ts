/**
 * Locations section UI messages.
 *
 * Platform chrome for LocationsSection — the "Open in Google Maps" link, its
 * new-tab hint, and the click-to-load map placeholder (ADR-021). Not tenant content (names, addresses and access notes are
 * content in siteConfig.locations), so it lives in a locale dictionary — same
 * pattern as team-section-messages.ts.
 */

export interface LocationsSectionMessages {
  /** Visible label of a location's Google Maps link. */
  openInMaps: string
  /** Screen-reader hint appended to links that open in a new tab. */
  opensInNewTab: string
  /** Button on the map placeholder that loads the Google map. */
  showMap: string
  /** Placeholder text explaining why the map is not loaded yet (consent). */
  mapConsentNotice: string
  /** Checkbox under the button: remember the choice for this site. */
  mapAlwaysAllow: string
  /** Accessible iframe title; receives the location name. */
  mapTitle: (name: string) => string
}

const MESSAGES: Record<string, LocationsSectionMessages> = {
  en: {
    openInMaps: 'Open in Google Maps',
    opensInNewTab: 'opens in a new tab',
    showMap: 'Show map',
    mapConsentNotice: 'The map is provided by Google Maps, which may set cookies. It loads only if you ask for it.',
    mapAlwaysAllow: 'Always allow Google Maps',
    mapTitle: (name) => `Map: ${name}`,
  },
  it: {
    openInMaps: 'Apri in Google Maps',
    opensInNewTab: 'si apre in una nuova scheda',
    showMap: 'Mostra mappa',
    mapConsentNotice: 'La mappa è fornita da Google Maps, che potrebbe impostare dei cookie. Si carica solo se lo richiedi.',
    mapAlwaysAllow: 'Consenti sempre Google Maps',
    mapTitle: (name) => `Mappa: ${name}`,
  },
  de: {
    openInMaps: 'In Google Maps öffnen',
    opensInNewTab: 'öffnet in einem neuen Tab',
    showMap: 'Karte anzeigen',
    mapConsentNotice: 'Die Karte wird von Google Maps bereitgestellt, das Cookies setzen kann. Sie wird nur auf Ihren Wunsch geladen.',
    mapAlwaysAllow: 'Google Maps immer erlauben',
    mapTitle: (name) => `Karte: ${name}`,
  },
  fr: {
    openInMaps: 'Ouvrir dans Google Maps',
    opensInNewTab: "s'ouvre dans un nouvel onglet",
    showMap: 'Afficher la carte',
    mapConsentNotice: 'La carte est fournie par Google Maps, qui peut déposer des cookies. Elle ne se charge que si vous le demandez.',
    mapAlwaysAllow: 'Toujours autoriser Google Maps',
    mapTitle: (name) => `Carte : ${name}`,
  },
  es: {
    openInMaps: 'Abrir en Google Maps',
    opensInNewTab: 'se abre en una pestaña nueva',
    showMap: 'Mostrar mapa',
    mapConsentNotice: 'El mapa lo proporciona Google Maps, que puede instalar cookies. Solo se carga si lo solicitas.',
    mapAlwaysAllow: 'Permitir siempre Google Maps',
    mapTitle: (name) => `Mapa: ${name}`,
  },
  pt: {
    openInMaps: 'Abrir no Google Maps',
    opensInNewTab: 'abre num novo separador',
    showMap: 'Mostrar mapa',
    mapConsentNotice: 'O mapa é fornecido pelo Google Maps, que pode definir cookies. Só é carregado se o pedir.',
    mapAlwaysAllow: 'Permitir sempre o Google Maps',
    mapTitle: (name) => `Mapa: ${name}`,
  },
  nl: {
    openInMaps: 'Openen in Google Maps',
    opensInNewTab: 'opent in een nieuw tabblad',
    showMap: 'Kaart tonen',
    mapConsentNotice: 'De kaart wordt geleverd door Google Maps, dat cookies kan plaatsen. Ze wordt alleen geladen als u daarom vraagt.',
    mapAlwaysAllow: 'Google Maps altijd toestaan',
    mapTitle: (name) => `Kaart: ${name}`,
  },
}

export function getLocationsSectionMessages(locale: string | undefined): LocationsSectionMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export const LOCATIONS_SECTION_MESSAGES_FOR_TEST = MESSAGES
