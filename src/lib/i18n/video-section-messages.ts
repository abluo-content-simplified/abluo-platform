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
  /** Click-to-load placeholder (ADR-021) — button. */
  showVideo: string
  /** Placeholder notice; `vendor` is a proper noun from the embed registry. */
  videoConsentNotice: (vendor: string) => string
  /** Placeholder "remember" checkbox. */
  videoAlwaysAllow: (vendor: string) => string
}

const MESSAGES: Record<string, VideoSectionMessages> = {
  en: {
    defaultPlayerLabel: 'Video player',
    showVideo: 'Show video',
    videoConsentNotice: (v) => `The video is provided by ${v}, which may set cookies. It loads only if you ask for it.`,
    videoAlwaysAllow: (v) => `Always allow ${v}`,
  },
  it: {
    defaultPlayerLabel: 'Video player',
    showVideo: 'Mostra video',
    videoConsentNotice: (v) => `Il video è fornito da ${v}, che potrebbe impostare dei cookie. Si carica solo se lo richiedi.`,
    videoAlwaysAllow: (v) => `Consenti sempre ${v}`,
  },
  de: {
    defaultPlayerLabel: 'Videoplayer',
    showVideo: 'Video anzeigen',
    videoConsentNotice: (v) => `Das Video wird von ${v} bereitgestellt, das Cookies setzen kann. Es wird nur auf Ihren Wunsch geladen.`,
    videoAlwaysAllow: (v) => `${v} immer erlauben`,
  },
  fr: {
    defaultPlayerLabel: 'Lecteur vidéo',
    showVideo: 'Afficher la vidéo',
    videoConsentNotice: (v) => `La vidéo est fournie par ${v}, qui peut déposer des cookies. Elle ne se charge que si vous le demandez.`,
    videoAlwaysAllow: (v) => `Toujours autoriser ${v}`,
  },
  es: {
    defaultPlayerLabel: 'Reproductor de vídeo',
    showVideo: 'Mostrar vídeo',
    videoConsentNotice: (v) => `El vídeo lo proporciona ${v}, que puede instalar cookies. Solo se carga si lo solicitas.`,
    videoAlwaysAllow: (v) => `Permitir siempre ${v}`,
  },
  pt: {
    defaultPlayerLabel: 'Leitor de vídeo',
    showVideo: 'Mostrar vídeo',
    videoConsentNotice: (v) => `O vídeo é fornecido por ${v}, que pode definir cookies. Só é carregado se o pedir.`,
    videoAlwaysAllow: (v) => `Permitir sempre ${v}`,
  },
  nl: {
    defaultPlayerLabel: 'Videospeler',
    showVideo: 'Video tonen',
    videoConsentNotice: (v) => `De video wordt geleverd door ${v}, dat cookies kan plaatsen. Hij wordt alleen geladen als u daarom vraagt.`,
    videoAlwaysAllow: (v) => `${v} altijd toestaan`,
  },
}

export function getVideoSectionMessages(locale: string): VideoSectionMessages {
  return MESSAGES[locale] ?? MESSAGES.en
}
