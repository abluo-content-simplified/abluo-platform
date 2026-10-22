'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { Button } from '@/components/app/ui/Button'
import { Pill } from '@/components/app/ui/list/cells'
import { SidePanel } from '@/components/app/ui/SidePanel'
import { PhotoCard, type CardChange, type CardPhoto } from '@/components/client/media/PhotoCard'
import type { MediaLibraryScope } from '@/components/client/media/media-api'
import type { TagCount } from '@/lib/tags/internal-tags'
import type { MediaLibraryItem, MediaUsage } from '@/lib/api/media-library'
import { mediaUsageHref, type MediaLinks } from '@/lib/client/media-links'

type Site = { defaultLocale: string; locales: string[] }

const toCard = (i: MediaLibraryItem): CardPhoto => ({
  assetId: i.assetId,
  rev: i.rev,
  url: i.url,
  name: i.name,
  alt: i.alt,
  caption: i.caption,
  tags: i.tags,
  focal: i.focal,
})

/** One photo: the photo card plus "Used in …". Full screen on a phone, a panel on a computer. */
export function PhotoSheet({
  projectSlug,
  scope = 'media',
  links,
  site,
  item,
  tagSuggestions,
  tagCounts,
  onChange,
  onSaving,
  onClose,
  remove,
}: {
  projectSlug: string
  /** Which actions save the photo (the client's Media Library, or the admin's). */
  scope?: MediaLibraryScope
  /** Where "Used in" links go. */
  links: MediaLinks
  site: Site
  item: MediaLibraryItem
  tagSuggestions: readonly string[]
  /** The same with usage counts (most-used chips). */
  tagCounts?: readonly TagCount[]
  onChange: (c: CardChange) => void
  onSaving: (job: Promise<unknown>) => void
  onClose: () => void
  /** A delete button under "Used in" (admin; the client dashboard has no delete yet). */
  remove?: { label: string; onPress: () => void } | null
}) {
  const t = useTranslations('clientDashboard.media')
  // The card is mounted once per photo: it keeps its own copy while open.
  const [photo] = useState(() => toCard(item))

  return (
    <SidePanel open title={item.name?.trim() || t('sheet.title')} closeLabel={t('sheet.close')} onClose={onClose}>
      <div className="flex flex-col gap-6">
        <PhotoCard
          key={photo.assetId}
          projectSlug={projectSlug}
          scope={scope}
          site={{ defaultLocale: site.defaultLocale, languages: site.locales }}
          photo={photo}
          tagSuggestions={tagSuggestions}
          tagCounts={tagCounts}
          onChange={onChange}
          onSaving={onSaving}
        />
        <UsedIn usedIn={item.usedIn} projectSlug={projectSlug} links={links} />
        {remove ? (
          <div className="border-t border-border-subtle pt-4">
            <Button variant="destructive" onClick={remove.onPress}>
              {remove.label}
            </Button>
          </div>
        ) : null}
      </div>
    </SidePanel>
  )
}

function UsedIn({ usedIn, projectSlug, links }: { usedIn: MediaUsage[]; projectSlug: string; links: MediaLinks }) {
  const t = useTranslations('clientDashboard.media.usedIn')
  return (
    <section aria-labelledby="media-used-in" className="flex flex-col gap-2 border-t border-border-subtle pt-4">
      <h3 id="media-used-in" className="text-[0.9375rem] font-semibold text-foreground">
        {t('title')}
      </h3>
      {usedIn.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('none')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {usedIn.map((u) => (
            <li key={`${u.kind}-${u.id}`} className="flex items-start gap-2 text-sm text-foreground">
              <span className="shrink-0">
                <Pill tone="muted">{t(`kind.${u.kind}`)}</Pill>
              </span>
              <UsageLink href={mediaUsageHref(links, projectSlug, u)}>{u.title || t('untitled')}</UsageLink>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function UsageLink({ href, children }: { href: string | null; children: string }) {
  return href ? (
    <Link href={href} className="underline underline-offset-4">
      {children}
    </Link>
  ) : (
    <span>{children}</span>
  )
}

function svg(d: string, size = 20) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

/** The Media screen's icons (stroke, currentColor). */
export const MEDIA_ICONS = {
  x: svg('M6 6l12 12M18 6L6 18'),
  plus: svg('M12 5v14M5 12h14', 18),
  tick: svg('M5 12l5 5L20 7', 14),
  grid: svg('M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', 18),
  list: svg('M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01', 18),
  tag: svg('M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01'),
  rename: svg('M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'),
  describe: svg('M4 6h16M4 10h16M4 14h10M4 18h7'),
  focal: svg('M12 3v4M12 17v4M3 12h4M17 12h4M12 12h.01', 16),
}
