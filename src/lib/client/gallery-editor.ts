/**
 * Pure helpers for the client-dashboard gallery screens (list + editor).
 * Shapes mirror `src/lib/api/gallery-drafts.ts` (server module — types only here).
 */
import type { GalleryPhoto, GalleryUsage } from '@/lib/api/gallery-drafts'
import { newItemKey } from '@/lib/client/gallery-order'

/** "Home, Il nostro studio" — pages first, then posts; empty when used nowhere. */
export function usagePlaces(usedIn: readonly GalleryUsage[] | null | undefined): string {
  const list = usedIn ?? []
  return [...list.filter((u) => u.kind === 'page'), ...list.filter((u) => u.kind === 'post')]
    .map((u) => u.title.trim())
    .filter(Boolean)
    .join(', ')
}

export function usagePages(usedIn: readonly GalleryUsage[] | null | undefined): GalleryUsage[] {
  return (usedIn ?? []).filter((u) => u.kind === 'page')
}

export function usagePosts(usedIn: readonly GalleryUsage[] | null | undefined): GalleryUsage[] {
  return (usedIn ?? []).filter((u) => u.kind === 'post')
}

/**
 * The `items` value patchGalleryDraft expects, in order: key and photo only.
 * The per-gallery title/caption overrides are gone from the dashboard (Tom,
 * gallery redo), so a save leaves every item on the photo's own texts.
 */
export function itemsPatch(items: readonly Pick<GalleryPhoto, 'key' | 'assetId'>[]): { key: string; assetId: string }[] {
  return items.map((i) => ({ key: i.key, assetId: i.assetId }))
}

/** New photos (upload / Media Library) → gallery items with fresh keys, appended in order. */
export function appendPhotos(
  items: readonly GalleryPhoto[],
  added: readonly { assetId: string; url: string; thumbUrl: string | null; name?: string; alt: Record<string, string>; focal: GalleryPhoto['focal'] }[],
  random: () => number = Math.random
): GalleryPhoto[] {
  const taken = new Set(items.map((i) => i.key))
  const fresh = added.map((a) => {
    const key = newItemKey(taken, random)
    taken.add(key)
    return {
      key,
      assetId: a.assetId,
      rev: '',
      url: a.url,
      thumbUrl: a.thumbUrl,
      name: a.name ?? '',
      alt: a.alt,
      title: {},
      caption: {},
      tags: [],
      focal: a.focal,
      titleOverride: null,
      captionOverride: null,
      missing: false,
    } satisfies GalleryPhoto
  })
  return [...items, ...fresh]
}

/** Photos still without a description in the site's main language (publish would refuse). */
export function photosMissingAlt(items: readonly Pick<GalleryPhoto, 'alt' | 'missing'>[], defaultLocale: string): number {
  return items.filter((i) => !i.missing && !i.alt?.[defaultLocale]?.trim()).length
}

/** Apply a saved photo (Media Library asset) to every item that shows it. */
export function applyPhotoSaved<T extends Pick<GalleryPhoto, 'assetId'>>(
  items: readonly T[],
  saved: Partial<GalleryPhoto> & { assetId: string }
): T[] {
  return items.map((i) => (i.assetId === saved.assetId ? { ...i, ...saved } : i))
}

/** Copy fresh server facts (rev, texts, focal) onto items the editor already holds, keeping order and overrides. */
export function refreshPhotoFacts(items: readonly GalleryPhoto[], server: readonly GalleryPhoto[]): GalleryPhoto[] {
  const byAsset = new Map(server.map((p) => [p.assetId, p]))
  return items.map((i) => {
    const s = byAsset.get(i.assetId)
    return s
      ? { ...i, rev: s.rev, url: s.url, thumbUrl: s.thumbUrl, name: s.name, alt: s.alt, title: s.title, caption: s.caption, tags: s.tags, focal: s.focal, missing: s.missing }
      : i
  })
}
