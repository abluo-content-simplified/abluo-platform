/**
 * VideoSection UI Messages
 *
 * Locale-aware, non-content chrome strings for the VideoSection player —
 * the iframe/video `title` attribute used when the section has no editorial
 * title (screen readers and browser tab previews still need a label). These
 * are platform UI strings, not tenant content, so they live in a locale
 * dictionary rather than Sanity — same pattern as
 * `src/lib/i18n/contact-section-messages.ts`.
 *
 * FUTURE: replace with next-intl `getTranslations` once the messages/
 * directory is the authoritative source for all UI strings.
 */

export interface VideoSectionMessages {
  /** Fallback accessible label when the section has no editorial title. */
  defaultPlayerLabel: string
}

const MESSAGES: Record<string, VideoSectionMessages> = {
  en: {
    defaultPlayerLabel: 'Video player',
  },
  it: {
    defaultPlayerLabel: 'Video player',
  },
  de: {
    defaultPlayerLabel: 'Videoplayer',
  },
  fr: {
    defaultPlayerLabel: 'Lecteur vidéo',
  },
  es: {
    defaultPlayerLabel: 'Reproductor de vídeo',
  },
  pt: {
    defaultPlayerLabel: 'Leitor de vídeo',
  },
  nl: {
    defaultPlayerLabel: 'Videospeler',
  },
}

export function getVideoSectionMessages(locale: string): VideoSectionMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
