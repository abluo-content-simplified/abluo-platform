'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { GalleryViewItem } from '@/lib/gallery/view'
import type { GalleryLayout, TileShape } from '@/lib/gallery/layout'
import { parsePhotoHash, photoHash } from '@/lib/gallery/deeplink'
import { formatGalleryMessage, type GalleryMessages } from '@/lib/i18n/gallery-messages'
import { GalleryLayoutView } from './GalleryLayouts'
import { Lightbox } from './Lightbox'

// ── GalleryView ───────────────────────────────────────────────────────────────
// The interactive half of a gallery placement (section or blog post): optional
// tabs, the chosen layout, and the shared lightbox with its deep link.
// Everything it renders arrives pre-resolved from the server (view.ts).

export interface GalleryViewTab {
  id: string
  label: string
  items: GalleryViewItem[]
}

export interface GalleryViewProps {
  tabs: GalleryViewTab[]
  /** Every photo of the placement once, in order — what deep-link numbers count. */
  allItems: GalleryViewItem[]
  layout: GalleryLayout
  columns: number
  shape: TileShape
  spacing: 'tight' | 'normal' | 'loose'
  showCaptions: boolean
  lightbox: boolean
  hashPrefix: string
  messages: GalleryMessages
  /** Seconds — entrance animations (durationSlow) and the lightbox (durationBase). */
  duration: number
  lightboxDuration: number
  ease: unknown
}

type LightboxState = { items: GalleryViewItem[]; index: number } | null

const isImage = (i: GalleryViewItem) => !i.isVideo && !!i.fullSrc

export function GalleryView(props: GalleryViewProps) {
  const { tabs, allItems, messages: m, hashPrefix } = props
  const [activeId, setActiveId] = useState(tabs[0]?.id)
  const [box, setBox] = useState<LightboxState>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const baseId = useId()

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]
  const allImages = useMemo(() => allItems.filter(isImage), [allItems])

  // Deep link: the address names the photo's place in the combined set.
  const writeHash = useCallback(
    (item: GalleryViewItem | null) => {
      if (typeof window === 'undefined') return
      const base = window.location.pathname + window.location.search
      if (!item) {
        if (parsePhotoHash(window.location.hash, hashPrefix) !== null) window.history.replaceState(window.history.state, '', base)
        return
      }
      const n = allImages.findIndex((i) => i.assetId === item.assetId)
      if (n >= 0) window.history.replaceState(window.history.state, '', base + photoHash(hashPrefix, n))
    },
    [allImages, hashPrefix]
  )

  const openFromHash = useCallback(() => {
    if (!props.lightbox) return
    const n = parsePhotoHash(window.location.hash, hashPrefix)
    if (n === null || n >= allImages.length) return
    // A shared link opens on the combined set, and shows the All tab behind it.
    if (tabs.some((t) => t.id === 'all')) setActiveId('all')
    setBox({ items: allImages, index: n })
  }, [allImages, hashPrefix, props.lightbox, tabs])

  useEffect(() => {
    // A shared link is read after the first paint, not during it: the gallery
    // renders normally, then opens on the linked photo.
    const frame = window.requestAnimationFrame(openFromHash)
    window.addEventListener('hashchange', openFromHash)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('hashchange', openFromHash)
    }
  }, [openFromHash])

  const images = useMemo(() => active?.items.filter(isImage) ?? [], [active])

  const openHandler = (item: GalleryViewItem) => {
    if (!props.lightbox || !isImage(item)) return undefined
    return () => {
      const index = images.findIndex((i) => i.key === item.key)
      if (index < 0) return
      setBox({ items: images, index })
      writeHash(item)
    }
  }

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const next =
      e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
    setActiveId(tabs[next].id)
    tabRefs.current[next]?.focus()
  }

  if (!active || active.items.length === 0) return null

  const showTabs = tabs.length > 1
  const panelId = `${baseId}-panel`

  return (
    <div>
      {showTabs && (
        <div role="tablist" aria-label={m.tabsLabel} className="mb-8 flex flex-wrap gap-2">
          {tabs.map((tab, i) => {
            const selected = tab.id === active.id
            return (
              <button
                key={tab.id}
                ref={(el) => {
                  tabRefs.current[i] = el
                }}
                id={`${baseId}-tab-${i}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveId(tab.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className="rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
                style={{
                  backgroundColor: selected ? 'var(--color-primary)' : 'color-mix(in oklch, var(--color-text-primary) 6%, transparent)',
                  color: selected ? 'var(--color-primary-foreground, var(--color-background))' : 'var(--color-text-secondary)',
                  outlineColor: 'var(--color-primary)',
                }}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      )}

      <div
        id={panelId}
        role={showTabs ? 'tabpanel' : undefined}
        aria-labelledby={showTabs ? `${baseId}-tab-${tabs.indexOf(active)}` : undefined}
      >
        <GalleryLayoutView
          // Remount on tab change so the entrance animation replays and the
          // carousel starts from the beginning.
          key={active.id}
          items={active.items}
          layout={props.layout}
          columns={props.columns}
          shape={props.shape}
          spacing={props.spacing}
          showCaptions={props.showCaptions}
          openHandler={openHandler}
          openLabel={(i) => formatGalleryMessage(m.openPhoto, { n: i + 1, total: active.items.length })}
          videoLabel={m.video}
          scrollBackLabel={m.scrollBack}
          scrollForwardLabel={m.scrollForward}
          duration={props.duration}
          ease={props.ease}
        />
      </div>

      {props.lightbox && (
        <Lightbox
          items={box?.items ?? []}
          index={box ? box.index : null}
          onIndexChange={(index) => {
            setBox((b) => (b ? { ...b, index } : b))
            if (box) writeHash(box.items[index] ?? null)
          }}
          onClose={() => {
            setBox(null)
            writeHash(null)
          }}
          labels={{
            dialog: m.viewerLabel,
            close: m.close,
            previous: m.previous,
            next: m.next,
            counter: (n, total) => formatGalleryMessage(m.counter, { n, total }),
          }}
          duration={props.lightboxDuration}
          ease={props.ease}
        />
      )}
    </div>
  )
}
