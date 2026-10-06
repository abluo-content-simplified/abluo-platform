/**
 * Gallery preview: put the DRAFT gallery where a page shows the published one.
 * Pure — the preview route fetches the page and the draft, this swaps them.
 * Covers both section shapes: `gallery` (one) and `galleries` (composed).
 */
type WithId = { _id?: string | null } & Record<string, unknown>
type SectionLike = { gallery?: WithId | null; galleries?: (WithId | null)[] | null } & Record<string, unknown>

export function substituteGallery<S extends SectionLike>(
  sections: S[] | null | undefined,
  galleryId: string,
  draft: WithId
): S[] {
  const replacement = { ...draft, _id: galleryId }
  const swap = (g: WithId | null | undefined) =>
    g && (g._id === galleryId || g._id === `drafts.${galleryId}`) ? replacement : g
  return (sections ?? []).map((section) => {
    const next: SectionLike = { ...section }
    if (section.gallery !== undefined) next.gallery = swap(section.gallery) ?? null
    if (Array.isArray(section.galleries)) next.galleries = section.galleries.map((g) => swap(g) ?? null)
    return next as S
  })
}

/** The Photo Gallery section used to preview a gallery that is not on any page yet (defaults of the section type). */
export function standaloneGallerySection(draft: WithId, galleryId: string) {
  return {
    _type: 'photoGallerySection' as const,
    _key: 'gallery-preview',
    background: 'usePagePattern' as const,
    headline: typeof draft.title === 'string' ? draft.title : undefined,
    description: typeof draft.description === 'string' ? draft.description : undefined,
    gallery: { ...draft, _id: galleryId },
    galleryDisplay: 'combined' as const,
    showAllTab: true,
    layout: 'grid',
    columns: 3,
    imageRatio: 'square',
    spacing: 'normal',
    showCaptions: false,
    lightbox: true,
  }
}
