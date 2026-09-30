/**
 * Team section UI messages.
 *
 * Platform chrome for TeamSection — currently the label on a member's
 * personal-website link. Not tenant content, so it lives in a locale
 * dictionary (same pattern as gallery-messages.ts).
 */

export interface TeamSectionMessages {
  /** Visible label of a member's website link. */
  website: string
  /** Screen-reader hint appended to links that open in a new tab. */
  opensInNewTab: string
}

const MESSAGES: Record<string, TeamSectionMessages> = {
  en: { website: 'Website',   opensInNewTab: 'opens in a new tab' },
  it: { website: 'Sito web',  opensInNewTab: 'si apre in una nuova scheda' },
  de: { website: 'Website',   opensInNewTab: 'öffnet in einem neuen Tab' },
  fr: { website: 'Site web',  opensInNewTab: "s'ouvre dans un nouvel onglet" },
  es: { website: 'Sitio web', opensInNewTab: 'se abre en una pestaña nueva' },
  pt: { website: 'Site',      opensInNewTab: 'abre num novo separador' },
  nl: { website: 'Website',   opensInNewTab: 'opent in een nieuw tabblad' },
}

export function getTeamSectionMessages(locale: string | undefined): TeamSectionMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export const TEAM_SECTION_MESSAGES_FOR_TEST = MESSAGES
