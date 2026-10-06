'use client'

import { useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { AddPhotos, type AddedPhoto } from '@/components/client/media/AddPhotos'
import { MediaLibraryPicker } from '@/components/client/media/MediaLibraryPicker'
import { dropIndex, moveByKey, moveItem } from '@/lib/client/gallery-order'

export type { AddedPhoto }

/** What the grid needs from each gallery item (the editor's item type may carry more). */
export type PhotoGridItem = {
  key: string
  assetId: string
  url: string
  thumbUrl: string | null
  alt: Record<string, string>
  missing?: boolean
}

export type PhotoGridProps<T extends PhotoGridItem> = {
  projectSlug: string
  /** Site default language — a photo without a description in it gets a "needs a description" mark. */
  defaultLocale: string
  items: T[]
  /** Reordered or a photo removed — the shell saves it as the draft's `items`. */
  onChange: (items: T[]) => void
  /** New photos to append, in order — the shell gives them keys and saves. */
  onAdd: (photos: AddedPhoto[]) => void
  /** Open this photo (the gallery wizard jumps to its "Describe" card). */
  onOpen: (key: string) => void
  disabled?: boolean
  /** Server limit: 200 photos per gallery. */
  maxItems?: number
}

const MAX_ITEMS = 200

/**
 * The gallery's photos. On top, Add photos (camera / this phone / upload or
 * drag / Media Library — see AddPhotos) with a per-file upload story; below,
 * a compact grid showing every photo: tap to open it, × to remove it, drag
 * the grip to reorder (pointer events — mouse, touch, pen; arrow keys on the
 * grip). No side effects on mount and no autofocus: the wizard keeps this
 * mounted (hidden) so uploads in progress keep running.
 */
export function PhotoGrid<T extends PhotoGridItem>({
  projectSlug,
  defaultLocale,
  items,
  onChange,
  onAdd,
  onOpen,
  disabled,
  maxItems = MAX_ITEMS,
}: PhotoGridProps<T>) {
  const t = useTranslations('clientDashboard.gallery.photo.grid')
  const [libraryOpen, setLibraryOpen] = useState(false)

  // ── Reorder by dragging the grip ────────────────────────────────────────────
  const [preview, setPreview] = useState<T[] | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const tileRefs = useRef(new Map<string, HTMLLIElement>())
  const shown = preview ?? items

  const startDrag = (key: string) => {
    if (disabled) return
    setDragKey(key)
    setPreview(items)
  }
  const moveDrag = (x: number, y: number) => {
    if (!dragKey || !preview) return
    const rects = preview.map((it) => tileRefs.current.get(it.key)?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 })
    const to = dropIndex(rects, x, y)
    const from = preview.findIndex((it) => it.key === dragKey)
    if (to >= 0 && from >= 0 && to !== from) setPreview(moveItem(preview, from, to))
  }
  const endDrag = () => {
    if (preview && preview.map((i) => i.key).join() !== items.map((i) => i.key).join()) onChange(preview)
    setPreview(null)
    setDragKey(null)
  }
  const cancelDrag = () => {
    setPreview(null)
    setDragKey(null)
  }

  const room = Math.max(0, maxItems - items.length)

  return (
    <section aria-label={t('label')} className="flex flex-col gap-4">
      <AddPhotos
        projectSlug={projectSlug}
        scope="gallery"
        room={room}
        disabled={disabled}
        onUploaded={(photo) => onAdd([photo])}
        onOpenLibrary={() => setLibraryOpen(true)}
      />

      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground">{t('count', { count: items.length })}</p>
        {items.length > 1 && <p className="text-right text-xs text-muted-foreground">{t('reorderHint')}</p>}
      </div>

      {shown.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
          {shown.map((item, i) => {
            const needsAlt = !item.missing && !(item.alt[defaultLocale] ?? '').trim()
            const name = item.alt[defaultLocale] || t('photoN', { n: i + 1 })
            return (
              <li
                key={item.key}
                ref={(el) => {
                  if (el) tileRefs.current.set(item.key, el)
                  else tileRefs.current.delete(item.key)
                }}
                className={`relative aspect-square overflow-hidden rounded-xl border bg-muted ${
                  dragKey === item.key ? 'z-10 border-ring opacity-80 ring-2 ring-ring' : 'border-border'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onOpen(item.key)}
                  aria-label={t('editPhoto', { name })}
                  className="block size-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                >
                  {item.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail
                    <img src={item.thumbUrl} alt="" width="240" height="240" loading="lazy" draggable={false} className="size-full object-cover" />
                  ) : (
                    <span className="flex size-full items-center justify-center p-2 text-center text-xs text-muted-foreground">{t('missing')}</span>
                  )}
                </button>
                {needsAlt && (
                  <span
                    className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-background px-2 py-0.5 text-xs font-medium text-foreground"
                    title={t('needsDescription')}
                  >
                    {t('needsDescriptionShort')}
                  </span>
                )}
                {!disabled && (
                  <>
                    <button
                      type="button"
                      aria-label={t('dragHandle', { name })}
                      aria-roledescription={t('dragRole')}
                      className="absolute top-0 left-0 inline-flex size-11 cursor-grab touch-none items-center justify-center text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
                      onPointerDown={(e) => {
                        e.currentTarget.setPointerCapture(e.pointerId)
                        startDrag(item.key)
                      }}
                      onPointerMove={(e) => moveDrag(e.clientX, e.clientY)}
                      onPointerUp={endDrag}
                      onPointerCancel={cancelDrag}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                          e.preventDefault()
                          onChange(moveByKey(items, item.key, -1))
                        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                          e.preventDefault()
                          onChange(moveByKey(items, item.key, 1))
                        }
                      }}
                    >
                      <span className="flex size-7 items-center justify-center rounded-full bg-background/90">{ICONS.grip}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={t('removePhoto', { name })}
                      onClick={() => onChange(items.filter((it) => it.key !== item.key))}
                      className="absolute top-0 right-0 inline-flex size-11 items-center justify-center text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <span className="flex size-7 items-center justify-center rounded-full bg-background/90">{ICONS.x}</span>
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {libraryOpen && (
        <MediaLibraryPicker
          projectSlug={projectSlug}
          scope="gallery"
          defaultLocale={defaultLocale}
          exclude={items.map((i) => i.assetId)}
          room={room}
          onClose={() => setLibraryOpen(false)}
          onAdd={(photos) => {
            setLibraryOpen(false)
            if (photos.length) onAdd(photos)
          }}
        />
      )}
    </section>
  )
}

function svg(d: string, size = 16) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  grip: svg('M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01'),
  x: svg('M7 7l10 10M17 7L7 17'),
}
