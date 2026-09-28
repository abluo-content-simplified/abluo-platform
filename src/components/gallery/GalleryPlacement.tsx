import type { DesignSystem, Gallery } from '@/lib/sanity/types'
import { buildTabs, combineGroups, toGroups } from '@/lib/gallery/compose'
import { toViewItems } from '@/lib/gallery/view'
import { hashPrefix } from '@/lib/gallery/deeplink'
import { normalizeLayout, normalizeShape } from '@/lib/gallery/layout'
import { formatGalleryMessage, getGalleryMessages } from '@/lib/i18n/gallery-messages'
import { buildImageGallerySchema } from '@/lib/gallery/jsonld'
import { GalleryView } from './GalleryView'

// ── GalleryPlacement (server) ─────────────────────────────────────────────────
// Turns one placement — a Photo Gallery section or a blog post's gallery — into
// the serialisable props GalleryView renders. Shared by both surfaces so they
// can never drift apart (ADR-022 §5, §6).

export interface GalleryPlacementProps {
  galleries: Gallery[]
  layout?: string | null
  columns?: number | null
  imageRatio?: string | null
  spacing?: 'tight' | 'normal' | 'loose' | null
  showCaptions?: boolean | null
  lightbox?: boolean | null
  display?: 'combined' | 'tabs' | null
  showAllTab?: boolean | null
  anchorId?: string | null
  /** Name for the ImageGallery structured data (section headline, gallery title). */
  structuredDataName?: string | null
  locale: string
  designSystem: DesignSystem | null
}

export function GalleryPlacement(p: GalleryPlacementProps) {
  const messages = getGalleryMessages(p.locale)
  const groups = toGroups(p.galleries)
  const tabs = buildTabs(groups, {
    display: p.display,
    showAllTab: p.showAllTab,
    allLabel: messages.allTab,
    fallbackLabel: (i) => formatGalleryMessage(messages.untitledGallery, { n: i + 1 }),
  })
  const allItems = toViewItems(combineGroups(groups))
  if (allItems.length === 0) return null

  const m = p.designSystem?.motion
  const duration = m?.durationSlow !== undefined ? m.durationSlow / 1000 : 0.35
  const lightboxDuration = m?.durationBase !== undefined ? m.durationBase / 1000 : 0.25

  const schema = buildImageGallerySchema({
    name: p.structuredDataName ?? (p.galleries.length === 1 ? p.galleries[0].title : null),
    locale: p.locale,
    items: allItems,
  })

  return (
    <>
      {schema && (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, '\\u003c') }} />
      )}
      <GalleryView
      tabs={tabs.map((t) => ({ id: t.id, label: t.label, items: toViewItems(t.items) }))}
      allItems={allItems}
      layout={normalizeLayout(p.layout)}
      columns={p.columns ?? 3}
      shape={normalizeShape(p.imageRatio)}
      spacing={p.spacing ?? 'normal'}
      showCaptions={p.showCaptions ?? false}
      lightbox={p.lightbox !== false}
      hashPrefix={hashPrefix(p.anchorId)}
      messages={messages}
      duration={duration}
      lightboxDuration={lightboxDuration}
      ease={m?.easingDecelerate}
      />
    </>
  )
}
