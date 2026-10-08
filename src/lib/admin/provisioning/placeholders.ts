/**
 * Placeholder copy for a new project's start page — website CONTENT (stored
 * in Sanity, one value per supported language), not interface text. Shown on
 * the preview URL only (a new project is never live), and replaced in Studio
 * before launch. One entry per platform locale; a test keeps it complete.
 */
import type { SupportedLocale } from '@/lib/i18n/locales'

export type StartPageCopy = {
  pageTitle: string
  heroSubheadline: string
  textTitle: string
  textBody: string
}

export const START_PAGE_COPY: Record<SupportedLocale, StartPageCopy> = {
  en: {
    pageTitle: 'Home',
    heroSubheadline: 'Your new website is on its way.',
    textTitle: 'Welcome',
    textBody: 'This text is a placeholder. Replace it with your own words before the site goes live.',
  },
  it: {
    pageTitle: 'Home',
    heroSubheadline: 'Il tuo nuovo sito è in arrivo.',
    textTitle: 'Benvenuti',
    textBody: 'Questo testo è provvisorio. Sostituiscilo con le tue parole prima che il sito sia online.',
  },
  de: {
    pageTitle: 'Startseite',
    heroSubheadline: 'Ihre neue Website ist auf dem Weg.',
    textTitle: 'Willkommen',
    textBody: 'Dieser Text ist ein Platzhalter. Ersetzen Sie ihn durch Ihre eigenen Worte, bevor die Website online geht.',
  },
  fr: {
    pageTitle: 'Accueil',
    heroSubheadline: 'Votre nouveau site arrive bientôt.',
    textTitle: 'Bienvenue',
    textBody: 'Ce texte est provisoire. Remplacez-le par vos propres mots avant la mise en ligne du site.',
  },
  es: {
    pageTitle: 'Inicio',
    heroSubheadline: 'Tu nuevo sitio web está en camino.',
    textTitle: 'Bienvenidos',
    textBody: 'Este texto es provisional. Sustitúyelo por tus propias palabras antes de publicar el sitio.',
  },
  pt: {
    pageTitle: 'Início',
    heroSubheadline: 'O seu novo site está a caminho.',
    textTitle: 'Bem-vindo',
    textBody: 'Este texto é provisório. Substitua-o pelas suas próprias palavras antes de o site ficar online.',
  },
  nl: {
    pageTitle: 'Home',
    heroSubheadline: 'Uw nieuwe website is onderweg.',
    textTitle: 'Welkom',
    textBody: 'Deze tekst is een tijdelijke aanduiding. Vervang hem door uw eigen woorden voordat de site live gaat.',
  },
}
