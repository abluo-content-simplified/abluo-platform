/**
 * Gallery UI messages (ADR-022).
 *
 * Platform chrome for gallery placements and the lightbox — tab labels, button
 * names, screen-reader labels. Not tenant content, so they live in a locale
 * dictionary rather than Sanity, the same pattern as video-section-messages.ts.
 *
 * `{n}` and `{total}` are placeholders filled by `formatGalleryMessage`.
 */

export interface GalleryMessages {
  /** First tab: every gallery of the placement together. */
  allTab: string
  /** Fallback tab label for a gallery with no public title: "Gallery {n}". */
  untitledGallery: string
  /** Accessible name of the tab list. */
  tabsLabel: string
  /** Accessible name of a tile: "Open photo {n} of {total}". */
  openPhoto: string
  /** Accessible name of the lightbox dialog. */
  viewerLabel: string
  close: string
  previous: string
  next: string
  /** Visible position counter: "{n} / {total}". */
  counter: string
  /** Carousel scroll buttons. */
  scrollBack: string
  scrollForward: string
  /** Label on a video item, which does not open in the lightbox. */
  video: string
}

const MESSAGES: Record<string, GalleryMessages> = {
  en: {
    allTab: 'All',
    untitledGallery: 'Gallery {n}',
    tabsLabel: 'Galleries',
    openPhoto: 'Open photo {n} of {total}',
    viewerLabel: 'Photo viewer',
    close: 'Close',
    previous: 'Previous photo',
    next: 'Next photo',
    counter: '{n} / {total}',
    scrollBack: 'Scroll back',
    scrollForward: 'Scroll forward',
    video: 'Video',
  },
  it: {
    allTab: 'Tutte',
    untitledGallery: 'Galleria {n}',
    tabsLabel: 'Gallerie',
    openPhoto: 'Apri la foto {n} di {total}',
    viewerLabel: 'Visualizzatore foto',
    close: 'Chiudi',
    previous: 'Foto precedente',
    next: 'Foto successiva',
    counter: '{n} / {total}',
    scrollBack: 'Scorri indietro',
    scrollForward: 'Scorri avanti',
    video: 'Video',
  },
  de: {
    allTab: 'Alle',
    untitledGallery: 'Galerie {n}',
    tabsLabel: 'Galerien',
    openPhoto: 'Foto {n} von {total} öffnen',
    viewerLabel: 'Fotoansicht',
    close: 'Schließen',
    previous: 'Vorheriges Foto',
    next: 'Nächstes Foto',
    counter: '{n} / {total}',
    scrollBack: 'Zurückblättern',
    scrollForward: 'Weiterblättern',
    video: 'Video',
  },
  fr: {
    allTab: 'Toutes',
    untitledGallery: 'Galerie {n}',
    tabsLabel: 'Galeries',
    openPhoto: 'Ouvrir la photo {n} sur {total}',
    viewerLabel: 'Visionneuse de photos',
    close: 'Fermer',
    previous: 'Photo précédente',
    next: 'Photo suivante',
    counter: '{n} / {total}',
    scrollBack: 'Défiler vers l’arrière',
    scrollForward: 'Défiler vers l’avant',
    video: 'Vidéo',
  },
  es: {
    allTab: 'Todas',
    untitledGallery: 'Galería {n}',
    tabsLabel: 'Galerías',
    openPhoto: 'Abrir la foto {n} de {total}',
    viewerLabel: 'Visor de fotos',
    close: 'Cerrar',
    previous: 'Foto anterior',
    next: 'Foto siguiente',
    counter: '{n} / {total}',
    scrollBack: 'Desplazar hacia atrás',
    scrollForward: 'Desplazar hacia adelante',
    video: 'Vídeo',
  },
  pt: {
    allTab: 'Todas',
    untitledGallery: 'Galeria {n}',
    tabsLabel: 'Galerias',
    openPhoto: 'Abrir a foto {n} de {total}',
    viewerLabel: 'Visualizador de fotos',
    close: 'Fechar',
    previous: 'Foto anterior',
    next: 'Foto seguinte',
    counter: '{n} / {total}',
    scrollBack: 'Recuar',
    scrollForward: 'Avançar',
    video: 'Vídeo',
  },
  nl: {
    allTab: 'Alle',
    untitledGallery: 'Galerij {n}',
    tabsLabel: 'Galerijen',
    openPhoto: 'Foto {n} van {total} openen',
    viewerLabel: 'Fotoviewer',
    close: 'Sluiten',
    previous: 'Vorige foto',
    next: 'Volgende foto',
    counter: '{n} / {total}',
    scrollBack: 'Terug scrollen',
    scrollForward: 'Verder scrollen',
    video: 'Video',
  },
}

export function getGalleryMessages(locale: string | undefined): GalleryMessages {
  return (locale && MESSAGES[locale]) || MESSAGES.en
}

export function formatGalleryMessage(template: string, values: { n?: number; total?: number }): string {
  return template
    .replace('{n}', values.n === undefined ? '' : String(values.n))
    .replace('{total}', values.total === undefined ? '' : String(values.total))
}

/** Exposed for the completeness test. */
export const GALLERY_MESSAGE_LOCALES = Object.keys(MESSAGES)
export const GALLERY_MESSAGES_FOR_TEST = MESSAGES
