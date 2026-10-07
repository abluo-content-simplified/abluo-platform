'use client'

import { useTranslations } from 'next-intl'
import type { GalleryListItem } from '@/lib/api/gallery-drafts'
import type { GalleryStatus } from '@/lib/api/gallery-status'
import type { FilterableGallery, GalleryState } from '@/lib/client/galleries-filter'
import { Pill, type PillTone } from '@/components/client/ui/list/cells'

/** One row of the Galleries list (table, cards, phone cards). */
export type GalleryRow = FilterableGallery & {
  /** Up to five square thumbnails, the lead (main image, else first photo) first. */
  thumbs: string[]
  /** "Used on" places, already worded ("Home", "2 posts" …); empty = not used. */
  places: string[]
  /** The gallery's own page; null when this person can't open it (no write permission). */
  href: string | null
}

const TONE: Record<GalleryState, PillTone> = { live: 'success', changes: 'highlight', draft: 'outline' }

/** The gallery's state as a pill: Published · Unpublished changes · Not published yet. */
export function GalleryStatePill({ state }: { state: GalleryState }) {
  const t = useTranslations('clientDashboard.gallery.list.state')
  return (
    <Pill tone={TONE[state]} icon={state === 'live' ? <span aria-hidden="true" className="size-1.5 rounded-full bg-success" /> : undefined}>
      {t(state)}
    </Pill>
  )
}

/**
 * Where a gallery is shown, as short places: page titles (draft pages marked),
 * then "N posts" / "N draft posts". From the status read when there is one,
 * else from the list's own usage (published pages and posts).
 */
export function useGalleryPlaces() {
  const t = useTranslations('clientDashboard.gallery.status')
  return (g: Pick<GalleryListItem, 'usedIn'>, status: GalleryStatus | undefined): string[] => {
    if (status) {
      const { pages, posts } = status.usedOn
      return [
        ...pages.map((p) => (p.published ? p.title || t('untitledPage') : t('draftPage', { title: p.title || t('untitledPage') }))),
        ...(posts.published > 0 ? [t('posts', { count: posts.published })] : []),
        ...(posts.draft > 0 ? [t('draftPosts', { count: posts.draft })] : []),
      ]
    }
    const pages = g.usedIn.filter((u) => u.kind === 'page').map((u) => u.title || t('untitledPage'))
    const posts = g.usedIn.filter((u) => u.kind === 'post').length
    return [...pages, ...(posts ? [t('posts', { count: posts })] : [])]
  }
}

export function svg(d: string, size = 20, width = 2) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

export const GALLERY_ICONS = {
  plus: svg('M12 5v14M5 12h14', 18, 2.2),
  list: svg('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', 20, 2.2),
  grid: svg('M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', 20, 1.8),
  trash: svg('M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'),
  tag: svg('M3 12V4h8l10 10-8 8zM7.5 8.5h.01'),
  x: svg('M6 6l12 12M18 6L6 18'),
  back: svg('M15 6l-6 6 6 6', 18, 2.2),
  eye: svg('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', 18, 2),
  pencil: svg('M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4', 18, 2),
  star: svg('M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z', 14, 2),
}
