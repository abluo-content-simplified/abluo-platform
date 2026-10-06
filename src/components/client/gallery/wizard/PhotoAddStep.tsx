'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { mediaApi, thumbOf, type MediaScope } from '@/components/client/media/media-api'
import { MediaLibraryPicker } from '@/components/client/media/MediaLibraryPicker'
import type { AddedPhoto } from '@/components/client/media/AddPhotos'
import { BatchSheet } from '@/components/client/media/BatchSheet'
import type { CardChange } from '@/components/client/media/PhotoCard'
import { dropIndex, moveByKey, moveItem } from '@/lib/client/gallery-order'
import {
  ACCEPTED_TYPES,
  nextToStart,
  prepareForUpload,
  queueProgress,
  queueReducer,
  uploadEstimateMs,
  type QueueAction,
  type QueueItem,
} from '@/lib/client/gallery-upload-queue'
import { formatBytes } from '@/lib/client/upload-plan'

export type { AddedPhoto }

export type TileItem = { key: string; assetId: string; thumbUrl: string | null; name?: string; alt: Record<string, string>; missing?: boolean }

/** One upload batch: files picked together (or one camera session) — "Name and tag all" follows when 2+ land. */
type Batch = { ids: string[]; done: Map<string, { assetId: string; url: string }>; settled: Set<string>; open: boolean }

// Phone or computer: capability, not user agent (as the blog CoverStep).
const COARSE = '(pointer: coarse)'
function subscribeDevice(onChange: () => void) {
  const m = window.matchMedia(COARSE)
  m.addEventListener('change', onChange)
  return () => m.removeEventListener('change', onChange)
}
function isTouchDevice() {
  return window.matchMedia(COARSE).matches && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
}
function useTouchDevice(): boolean | null {
  return useSyncExternalStore<boolean | null>(subscribeDevice, isTouchDevice, () => null)
}

/** Finished rows stay this long ("✓ Optimised …") before they go. */
const DONE_LINGER_MS = 4000

/**
 * "Add photos" — the blog CoverStep's choice cards (v1.0.45). Touch devices
 * (pointer: coarse — phones and tablets): Take a photo · Photo library ·
 * Media Library (gallery only); after each shot, "Take another" or "Done".
 * Computers: Upload from your computer (also a drop zone) · Media Library.
 * MANY photos at once, each with its upload story (Uploading → Compressing →
 * ✓ Optimised). When two or more photos land from one pick (or one camera
 * session), "Name and tag all" offers a base name and tags for all of them
 * (skippable). Below, the compact grid of the photos added so far: tap to
 * describe, × to remove, drag ⋮⋮ to reorder (arrow keys on it). No side
 * effects on mount.
 */
export function PhotoAddStep({
  projectSlug,
  scope,
  title,
  helper,
  defaultLocale,
  items,
  onAdd,
  onChange,
  onOpen,
  onPhotosChanged,
  room,
  library = true,
}: {
  projectSlug: string
  scope: MediaScope
  title: string
  helper: string
  defaultLocale: string
  items: TileItem[]
  /** Each finished upload (one photo) or library pick (several), in order. */
  onAdd: (photos: AddedPhoto[]) => void
  /** Reordered or one removed; omit for a list that can't change (media). */
  onChange?: (items: TileItem[]) => void
  onOpen: (key: string) => void
  /** "Name and tag all" saved: the photos' new names, tags and revisions. */
  onPhotosChanged?: (changes: CardChange[]) => void
  /** How many more photos fit; undefined = no limit. */
  room?: number
  /** Offer "Media Library" (the gallery does; adding TO the library doesn't). */
  library?: boolean
}) {
  const t = useTranslations('clientDashboard.photoWizard.add')
  const ts = useTranslations('clientDashboard.media.add')
  const ui = useLocale()
  const touch = useTouchDevice()
  const cameraRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLInputElement>(null)
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  // ── Upload queue ──────────────────────────────────────────────────────────
  const [queue, setQueue] = useState<QueueItem[]>([])
  const qRef = useRef<QueueItem[]>([])
  const files = useRef(new Map<string, File>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const roomRef = useRef(room)
  useEffect(() => {
    roomRef.current = room
  }, [room])
  useEffect(() => {
    const all = timers.current
    return () => all.forEach(clearTimeout)
  }, [])
  const apply = useCallback((action: QueueAction) => {
    qRef.current = queueReducer(qRef.current, action)
    setQueue(qRef.current)
  }, [])
  const later = (fn: () => void, ms: number) => {
    const id = setTimeout(() => {
      timers.current.delete(id)
      fn()
    }, ms)
    timers.current.add(id)
  }
  // ── Batches → "Name and tag all" ─────────────────────────────────────────
  const batchOf = useRef(new Map<string, Batch>())
  const cameraBatch = useRef<Batch | null>(null)
  const [cameraTaken, setCameraTaken] = useState(0)
  const [nameAll, setNameAll] = useState<{ assetIds: string[]; thumbs: string[] }[]>([])
  const finish = useCallback((b: Batch) => {
    if (b.open || b.settled.size < b.ids.length) return
    const landed = b.ids.map((i) => b.done.get(i)).filter((x): x is { assetId: string; url: string } => Boolean(x))
    b.ids = [] // never offered twice
    if (landed.length < 2) return
    setNameAll((q) => [...q, { assetIds: landed.map((u) => u.assetId), thumbs: landed.map((u) => thumbOf(u.url, 112) ?? '').filter(Boolean) }])
  }, [])
  const settle = useCallback(
    (id: string, got: { assetId: string; url: string } | null) => {
      const b = batchOf.current.get(id)
      if (!b) return
      batchOf.current.delete(id)
      b.settled.add(id)
      if (got) b.done.set(id, got)
      finish(b)
    },
    [finish]
  )
  const endCamera = () => {
    const b = cameraBatch.current
    cameraBatch.current = null
    setCameraTaken(0)
    if (!b) return
    b.open = false
    finish(b)
  }

  const pumpRef = useRef<() => void>(() => undefined)
  const run = useCallback(
    async (id: string) => {
      const file = files.current.get(id)
      let got: { assetId: string; url: string } | null = null
      try {
        if (!file) throw new Error('gone')
        const prepared = await prepareForUpload(file)
        if (!prepared) return apply({ type: 'fail', id, error: 'unsupported_type' })
        apply({ type: 'status', id, status: 'uploading' })
        later(() => {
          if (qRef.current.find((q) => q.id === id)?.status === 'uploading') apply({ type: 'status', id, status: 'compressing' })
        }, uploadEstimateMs(prepared.size))
        const form = new FormData()
        form.set('projectSlug', projectSlug)
        form.set('file', prepared)
        const r = await mediaApi(scope).upload(form)
        if (!r.ok) return apply({ type: 'fail', id, error: r.error })
        apply({ type: 'done', id, result: { assetId: r.assetId, url: r.url, optimized: r.optimized, bytesBefore: r.bytesBefore, bytesAfter: r.bytesAfter } })
        files.current.delete(id)
        later(() => apply({ type: 'remove', id }), DONE_LINGER_MS)
        got = { assetId: r.assetId, url: r.url }
        onAdd([{ assetId: r.assetId, url: r.url, thumbUrl: thumbOf(r.url), name: r.name ?? '', alt: {}, focal: null, tags: [] }])
      } catch {
        apply({ type: 'fail', id, error: 'failed' })
      } finally {
        settle(id, got)
        pumpRef.current()
      }
    },
    [apply, projectSlug, scope, onAdd, settle]
  )
  const pump = useCallback(() => {
    for (const id of nextToStart(qRef.current)) {
      apply({ type: 'status', id, status: 'preparing' })
      void run(id)
    }
  }, [apply, run])
  useEffect(() => {
    pumpRef.current = pump
  }, [pump])

  const addFiles = (list: FileList | File[] | null | undefined, fromCamera = false) => {
    const picked = Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (!picked.length) return
    setNotice(null)
    const inFlight = qRef.current.filter((q) => q.status !== 'done' && q.status !== 'error').length
    const free = roomRef.current === undefined ? picked.length : Math.max(0, roomRef.current - inFlight)
    if (picked.length > free) setNotice(ts('full'))
    const accepted = picked.slice(0, free).map((file) => {
      const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`
      files.current.set(id, file)
      return { id, name: file.name, size: file.size }
    })
    if (accepted.length) {
      let b: Batch
      if (fromCamera) {
        b = cameraBatch.current ?? { ids: [], done: new Map(), settled: new Set(), open: true }
        cameraBatch.current = b
        setCameraTaken((n) => n + accepted.length)
      } else {
        b = { ids: [], done: new Map(), settled: new Set(), open: false }
      }
      for (const a of accepted) {
        b.ids.push(a.id)
        batchOf.current.set(a.id, b)
      }
    }
    apply({ type: 'add', items: accepted })
    pumpRef.current()
  }

  const story = (q: QueueItem): string => {
    switch (q.status) {
      case 'waiting':
        return ts('story.waiting')
      case 'preparing':
      case 'uploading':
        return ts('story.uploading')
      case 'compressing':
        return ts('story.compressing')
      case 'done':
        return q.result?.optimized
          ? ts('story.optimised', { before: formatBytes(q.size, ui), after: formatBytes(q.result.bytesAfter, ui) })
          : ts('story.uploaded')
      case 'error': {
        const known = ['unsupported_type', 'too_large', 'rate_limited', 'forbidden']
        return ts(`story.errors.${known.includes(q.error ?? '') ? q.error : 'generic'}`)
      }
    }
  }

  // ── Drag and drop (computers), as CoverStep ──────────────────────────────
  const full = room !== undefined && room <= 0
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const dragProps =
    touch === false && !full
      ? {
          onDragEnter: (e: DragEvent) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            dragDepth.current += 1
            setDragging(true)
          },
          onDragOver: (e: DragEvent) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          },
          onDragLeave: () => {
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (!dragDepth.current) setDragging(false)
          },
          onDrop: (e: DragEvent) => {
            e.preventDefault()
            dragDepth.current = 0
            setDragging(false)
            addFiles(e.dataTransfer.files)
          },
        }
      : {}

  // ── Reorder by dragging the grip ─────────────────────────────────────────
  const [preview, setPreview] = useState<TileItem[] | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const tileRefs = useRef(new Map<string, HTMLLIElement>())
  const shown = preview ?? items
  const endDrag = () => {
    if (preview && onChange && preview.map((i) => i.key).join() !== items.map((i) => i.key).join()) onChange(preview)
    setPreview(null)
    setDragKey(null)
  }

  return (
    <section
      aria-labelledby="photos-step-title"
      className={`relative -m-2 flex flex-col rounded-3xl p-2 transition-colors ${dragging ? 'bg-selected-tint ring-2 ring-ring' : ''}`}
      {...dragProps}
    >
      <h1 id="photos-step-title" className="text-[1.875rem] leading-9 font-semibold tracking-tight text-foreground">
        {title}
      </h1>
      <p className="mt-3 text-[1.0625rem] leading-7 text-muted-foreground">{helper}</p>

      <input
        ref={cameraRef}
        type="file"
        accept={ACCEPTED_TYPES}
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          addFiles(e.target.files, true)
          e.target.value = ''
        }}
      />
      {/* Touch: the photo library (no capture, so the OS offers its own picker); computers: the file dialog. */}
      <input
        ref={pickerRef}
        type="file"
        accept={touch ? 'image/*' : ACCEPTED_TYPES}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {dragging && (
        <p className="pointer-events-none mt-4 text-center text-[0.9375rem] font-medium text-foreground" aria-live="polite">
          {t('dropHere')}
        </p>
      )}

      {touch && cameraTaken > 0 ? (
        // After each shot: keep shooting, or stop (then "Name and tag all" when 2+ landed).
        <div role="group" aria-label={t('camera.label')} className="mt-8 rounded-2xl border border-border bg-background p-4">
          <p className="flex items-start gap-2 text-[0.9375rem] font-medium text-foreground" aria-live="polite">
            <span className="mt-0.5 shrink-0 text-success">{ICONS.check}</span>
            {t('camera.taken', { count: cameraTaken })}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              disabled={full}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-action px-4 text-[0.9375rem] font-semibold text-action-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
            >
              {ICONS.cameraSmall}
              {t('camera.another')}
            </button>
            <button
              type="button"
              onClick={endCamera}
              className="inline-flex min-h-12 items-center justify-center rounded-full border border-border bg-background px-4 text-[0.9375rem] font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('camera.done')}
            </button>
          </div>
        </div>
      ) : (
      <div role="group" aria-label={t('choices.label')} className="mt-8 grid grid-cols-2 gap-3">
        {touch === null ? (
          <>
            <div className="invisible min-h-28" aria-hidden="true" />
            <div className="invisible min-h-28" aria-hidden="true" />
          </>
        ) : touch ? (
          <>
            <Choice icon={ICONS.camera} onPress={() => cameraRef.current?.click()} disabled={full}>
              {t('choices.camera')}
            </Choice>
            <Choice icon={ICONS.phone} onPress={() => pickerRef.current?.click()} disabled={full}>
              {t('choices.photoLibrary')}
            </Choice>
          </>
        ) : (
          <Choice icon={ICONS.upload} onPress={() => pickerRef.current?.click()} disabled={full} wide hint={t('choices.computerHint')}>
            {t('choices.computer')}
          </Choice>
        )}
        {library ? (
          <Choice icon={ICONS.library} onPress={() => setLibraryOpen(true)} disabled={full} span={touch === true}>
            {t('choices.library')}
          </Choice>
        ) : null}
      </div>
      )}
      <p className="mt-4 flex gap-2 text-sm leading-6 text-muted-foreground">
        <span className="mt-0.5 shrink-0">{ICONS.leaf}</span>
        {t('note')}
      </p>

      {notice ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      {queue.length > 0 && (
        <ul className="mt-4 flex flex-col gap-3" aria-live="polite">
          {queue.map((q) => (
            <li key={q.id} className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{q.name}</p>
                {q.status !== 'done' && q.status !== 'error' && (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div className="h-full animate-pulse rounded-full bg-action transition-all" style={{ width: `${queueProgress(q) * 100}%` }} />
                  </div>
                )}
                <p className={`mt-1 text-xs ${q.status === 'error' ? 'text-destructive' : q.status === 'done' ? 'text-success' : 'text-muted-foreground'}`}>
                  {q.status === 'done' && <span aria-hidden="true">✓ </span>}
                  {story(q)}
                </p>
              </div>
              {q.status === 'error' && (
                <span className="flex shrink-0 gap-1">
                  <Pill
                    onPress={() => {
                      apply({ type: 'retry', id: q.id })
                      pumpRef.current()
                    }}
                  >
                    {ts('retry')}
                  </Pill>
                  <Pill onPress={() => apply({ type: 'remove', id: q.id })}>{ts('dismiss')}</Pill>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {shown.length > 0 && (
        <>
          <div className="mt-8 flex items-start justify-between gap-3">
            <p className="text-sm text-muted-foreground">{t('count', { count: items.length })}</p>
            {onChange && items.length > 1 ? <p className="text-right text-xs text-muted-foreground">{t('reorderHint')}</p> : null}
          </div>
          <ul className="mt-3 grid grid-cols-3 gap-2">
            {shown.map((item, i) => {
              const needsAlt = !item.missing && !(item.alt[defaultLocale] ?? '').trim()
              const name = item.name?.trim() || item.alt[defaultLocale] || t('photoN', { n: i + 1 })
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
                    aria-label={t('describePhoto', { name })}
                    className="block size-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
                  >
                    {item.thumbUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- Sanity CDN thumbnail
                      <img src={item.thumbUrl} alt="" width="240" height="240" loading="lazy" draggable={false} className="size-full object-cover" />
                    ) : (
                      <span className="flex size-full items-start justify-center p-2 text-center text-xs text-muted-foreground">{t('missing')}</span>
                    )}
                  </button>
                  {needsAlt && (
                    <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-full bg-background px-2 py-0.5 text-xs font-medium text-foreground">
                      {t('needsDescription')}
                    </span>
                  )}
                  {onChange ? (
                    <>
                      <button
                        type="button"
                        aria-label={t('dragHandle', { name })}
                        aria-roledescription={t('dragRole')}
                        className="absolute top-0 left-0 inline-flex size-11 cursor-grab touch-none items-center justify-center text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
                        onPointerDown={(e) => {
                          e.currentTarget.setPointerCapture(e.pointerId)
                          setDragKey(item.key)
                          setPreview(items)
                        }}
                        onPointerMove={(e) => {
                          if (!dragKey || !preview) return
                          const rects = preview.map(
                            (it) => tileRefs.current.get(it.key)?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 }
                          )
                          const to = dropIndex(rects, e.clientX, e.clientY)
                          const from = preview.findIndex((it) => it.key === dragKey)
                          if (to >= 0 && from >= 0 && to !== from) setPreview(moveItem(preview, from, to))
                        }}
                        onPointerUp={endDrag}
                        onPointerCancel={() => {
                          setPreview(null)
                          setDragKey(null)
                        }}
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
                  ) : null}
                </li>
              )
            })}
          </ul>
        </>
      )}

      {nameAll.length > 0 && (
        <BatchSheet
          key={nameAll[0].assetIds.join()}
          projectSlug={projectSlug}
          scope={scope}
          mode="all"
          assetIds={nameAll[0].assetIds}
          thumbs={nameAll[0].thumbs}
          onClose={() => setNameAll((q) => q.slice(1))}
          onDone={(changes) => {
            if (changes.length) onPhotosChanged?.(changes)
            setNameAll((q) => q.slice(1))
          }}
        />
      )}

      {libraryOpen && (
        <MediaLibraryPicker
          projectSlug={projectSlug}
          scope={scope}
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

/** The blog CoverStep's choice card (v1.0.45). */
function Choice({
  children,
  icon,
  onPress,
  disabled,
  hint,
  wide,
  span,
}: {
  children: ReactNode
  icon: ReactNode
  onPress?: () => void
  disabled?: boolean
  hint?: string
  /** The computer's drop zone: full row, dashed. */
  wide?: boolean
  /** Full row (the third choice on touch devices). */
  span?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={`flex min-h-28 flex-col items-start justify-between gap-3 rounded-2xl border p-4 text-left text-[0.9375rem] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed ${
        wide ? 'col-span-2 border-dashed' : span ? 'col-span-2' : ''
      } border-border bg-background text-foreground enabled:hover:bg-hover disabled:opacity-60`}
    >
      <span className="flex w-full items-start justify-between gap-2">{icon}</span>
      <span>
        {children}
        {hint && <span className="mt-0.5 block text-sm font-normal text-muted-foreground">{hint}</span>}
      </span>
    </button>
  )
}

function Pill({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-[0.9375rem] font-medium text-foreground transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </button>
  )
}

function svg(d: string, size = 18) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  camera: svg('M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 24),
  phone: svg('M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2', 24),
  upload: svg('M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3', 24),
  library: svg('M4 4h16v16H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 24),
  leaf: svg('M5 19c0-8 5-13 14-14-1 9-6 14-14 14zM5 19l7-7', 16),
  grip: svg('M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01', 16),
  x: svg('M7 7l10 10M17 7L7 17', 14),
  check: svg('M5 12l5 5L20 7', 18),
  cameraSmall: svg('M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', 18),
}
