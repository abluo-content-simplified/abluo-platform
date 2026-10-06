/**
 * The gallery wizard's step rules (Tom, gallery redo) — the blog wizard's
 * logic (src/lib/client/wizard-steps.ts) applied to a gallery. Pure, so the
 * order and the "can I go on?" rules are unit-tested:
 *   • name → photos → describe (one photo at a time) → languages (multilingual
 *     sites only) → preview; the preview's main button saves (publishes).
 *   • "review" is the overview an existing gallery opens on; Edit opens one
 *     step and "Done" comes back. "done" is a screen, never a step to resume.
 */

export type GalleryWizardStep = 'name' | 'photos' | 'describe' | 'languages' | 'preview' | 'review' | 'done'
export type GalleryFlowStep = Exclude<GalleryWizardStep, 'review' | 'done'>

type Photo = { alt: Record<string, string>; missing?: boolean }
export type GalleryContent = {
  title: Record<string, string>
  description: Record<string, string>
  items: readonly Photo[]
}

/** The first-pass steps for this site, in order. */
export function galleryWizardSteps(site: { languages: readonly string[] }): GalleryFlowStep[] {
  return site.languages.length > 1 ? ['name', 'photos', 'describe', 'languages', 'preview'] : ['name', 'photos', 'describe', 'preview']
}

/** Where the wizard opens: a new gallery at the start, an existing one on the overview. */
export function galleryStartStep(isNew: boolean): GalleryWizardStep {
  return isNew ? 'name' : 'review'
}

/** A photo still needs its description (alt) in the site's main language. Missing assets are skipped. */
export function photoNeedsAlt(photo: Photo, defaultLocale: string): boolean {
  return !photo.missing && !photo.alt?.[defaultLocale]?.trim()
}

/** Index of the first photo without a description, or -1. */
export function firstUndescribed(items: readonly Photo[], defaultLocale: string): number {
  return items.findIndex((p) => photoNeedsAlt(p, defaultLocale))
}

/** The minimum a step needs before "Next" / "Done" is enabled. */
export function canAdvanceGallery(step: GalleryWizardStep, g: GalleryContent, defaultLocale: string): boolean {
  if (step === 'name') return Boolean(g.title[defaultLocale]?.trim())
  if (step === 'photos') return g.items.length > 0
  // Descriptions can come later (Tom, wave B): describing never blocks Next.
  return true
}

/** What saving (publishing) needs: a title and at least one photo. Descriptions are never required. */
export function canSaveGallery(g: GalleryContent, defaultLocale: string): boolean {
  return (['name', 'photos'] as const).every((s) => canAdvanceGallery(s, g, defaultLocale))
}

/** Every (present) photo has a description in the main language. */
export function allDescribed(items: readonly Photo[], defaultLocale: string): boolean {
  return firstUndescribed(items, defaultLocale) === -1
}

/** A language is ready once the gallery has a title in it. */
export function galleryLanguageReady(g: Pick<GalleryContent, 'title'>, locale: string): boolean {
  return Boolean(g.title[locale]?.trim())
}

export type GallerySectionState = 'done' | 'missing' | 'optional'
export type GallerySection = { id: 'name' | 'photos' | 'describe' | 'languages'; state: GallerySectionState }

/** The overview's sections for this site, each with its state. */
export function gallerySections(g: GalleryContent, site: { languages: readonly string[]; defaultLocale: string }): GallerySection[] {
  const d = site.defaultLocale
  const out: GallerySection[] = [
    { id: 'name', state: canAdvanceGallery('name', g, d) ? 'done' : 'missing' },
    { id: 'photos', state: g.items.length ? 'done' : 'missing' },
    // Still to describe is a reminder, never a blocker.
    { id: 'describe', state: g.items.length && allDescribed(g.items, d) ? 'done' : 'optional' },
  ]
  if (site.languages.length > 1) {
    const others = site.languages.filter((l) => l !== d)
    out.push({ id: 'languages', state: others.every((l) => galleryLanguageReady(g, l)) ? 'done' : 'optional' })
  }
  return out
}

/** Keeps the describe position inside the photo list (photos can be removed meanwhile). */
export function clampIndex(index: number, length: number): number {
  return length <= 0 ? 0 : Math.min(Math.max(0, index), length - 1)
}
