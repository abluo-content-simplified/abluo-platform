/**
 * ThemeSwitcher UI Messages
 *
 * Locale-aware labels for the ThemeSwitcher component — aria labels,
 * drawer section heading, and theme option display names.
 *
 * FUTURE: replace with next-intl `useTranslations` once the messages/
 * directory is the authoritative source for all UI strings.
 */

export interface ThemeSwitcherMessages {
  /** aria-label on the header/footer toggle button */
  ariaLabel: string
  /** Section heading shown above theme options in the drawer */
  appearanceLabel: string
  /** Display name for each theme option */
  themes: {
    light: string
    dark: string
    system: string
  }
}

const MESSAGES: Record<string, ThemeSwitcherMessages> = {
  en: {
    ariaLabel:       'Colour scheme',
    appearanceLabel: 'Appearance',
    themes: {
      light:  'Light',
      dark:   'Dark',
      system: 'System',
    },
  },
  it: {
    ariaLabel:       'Schema colori',
    appearanceLabel: 'Aspetto',
    themes: {
      light:  'Chiaro',
      dark:   'Scuro',
      system: 'Sistema',
    },
  },
  de: {
    ariaLabel:       'Farbschema',
    appearanceLabel: 'Erscheinungsbild',
    themes: {
      light:  'Hell',
      dark:   'Dunkel',
      system: 'System',
    },
  },
}

export function getThemeSwitcherMessages(locale: string): ThemeSwitcherMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}

export const defaultThemeSwitcherMessages: ThemeSwitcherMessages = MESSAGES.en
