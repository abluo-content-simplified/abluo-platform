'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { GalleryStatus } from '@/lib/api/gallery-status'

/**
 * Two lines about a gallery: where it is shown, and what still needs
 * attention (photos, missing descriptions, missing translations). Parts that
 * are zero are left out. Used on the gallery list cards and the overview.
 */
export function GalleryStatusLines({ status, className = '' }: { status: GalleryStatus | null | undefined; className?: string }) {
  const t = useTranslations('clientDashboard.gallery.status')
  const ui = useLocale()
  if (!status) return null

  const { pages, posts } = status.usedOn
  const places = [
    ...pages.map((p) => (p.published ? p.title || t('untitledPage') : t('draftPage', { title: p.title || t('untitledPage') }))),
    ...(posts.published > 0 ? [t('posts', { count: posts.published })] : []),
    ...(posts.draft > 0 ? [t('draftPosts', { count: posts.draft })] : []),
  ]
  const language = (code: string) => {
    try {
      return new Intl.DisplayNames([ui], { type: 'language' }).of(code) ?? code
    } catch {
      return code
    }
  }
  const facts = [
    t('photos', { count: status.photos }),
    ...(status.missingDescription > 0 ? [t('needDescription', { count: status.missingDescription })] : []),
    ...Object.entries(status.missingTranslation)
      .filter(([, n]) => n > 0)
      .map(([code, n]) => t('missingTranslation', { language: language(code), count: n })),
  ]

  return (
    <span className={`flex flex-col items-start gap-1 ${className}`}>
      <span className="text-[0.9375rem] leading-6 text-muted-foreground">
        {places.length ? t('shownOn', { places: places.join(' · ') }) : t('notUsed')}
      </span>
      <span className="text-[0.9375rem] leading-6 text-muted-foreground">{facts.join(' · ')}</span>
    </span>
  )
}
