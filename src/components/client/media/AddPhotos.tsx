'use client'

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { FocalPoint } from '@/components/client/media/FocalPointPicker'
import { mediaApi, thumbOf, type MediaScope } from '@/components/client/media/media-api'
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

/** A photo that was just uploaded or picked from the Media Library. */
export type AddedPhoto = {
  assetId: string
  url: string
  thumbUrl: string | null
  /** The photo's name (from the file name on upload; '' for camera names). */
  name?: string
  alt: Record<string, string>
  focal: FocalPoint | null
  /** The asset's tags (empty for a fresh upload). */
  tags?: string[]
}

export type AddPhotosProps = {
  projectSlug: string
  /** Which actions to use: the Gallery module's, or the Media screen's. */
  scope: MediaScope
  /** Called once per finished upload, in completion order. */
  onUploaded: (photo: AddedPhoto) => void
  /** Shows the "Media Library" choice; the parent opens its picker. */
  onOpenLibrary?: () => void
  /** How many more photos fit (gallery limit); undefined = no limit. */
  room?: number
  disabled?: boolean
}

// Phone or computer — capability, evaluated after mount (no hydration mismatch).
const COARSE = '(pointer: coarse)'
const subscribe = (cb: () => void) => {
  const m = window.matchMedia(COARSE)
  m.addEventListener('change', cb)
  return () => m.removeEventListener('change', cb)
}
export const useTouchDevice = () =>
  useSyncExternalStore<boolean | null>(
    subscribe,
    () => window.matchMedia(COARSE).matches && ('ontouchstart' in window || navigator.maxTouchPoints > 0),
    () => null
  )

/** Finished rows stay this long ("Optimised ✓ …") before they go. */
const DONE_LINGER_MS = 4000

/**
 * Add photos — the blog Cover step's choices, for many photos at once.
 * Phone: Take a photo (camera) · From this phone (multiple) · Media Library.
 * Computer: Upload or drag (multiple, the whole block is a drop zone) · Media Library.
 * Each file tells its story — Uploading → Compressing → Optimised ✓ (TinyPNG,
 * "2.4 MB → 610 KB") — and its row goes away once done. The browser only
 * pre-resizes when a photo would not fit the upload (planUpload).
 * No side effects on mount (safe to keep mounted while hidden).
 */
export function AddPhotos({ projectSlug, scope, onUploaded, onOpenLibrary, room, disabled }: AddPhotosProps) {
  const t = useTranslations('clientDashboard.media.add')
  const ui = useLocale()
  const touch = useTouchDevice()
  const cameraRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)

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

  const pumpRef = useRef<() => void>(() => undefined)
  const run = useCallback(
    async (id: string) => {
      const file = files.current.get(id)
      try {
        if (!file) throw new Error('gone')
        const prepared = await prepareForUpload(file)
        if (!prepared) return apply({ type: 'fail', id, error: 'unsupported_type' })
        apply({ type: 'status', id, status: 'uploading' })
        // The server compresses right after it has the body; say so then.
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
        onUploaded({ assetId: r.assetId, url: r.url, thumbUrl: thumbOf(r.url), alt: {}, focal: null, tags: [] })
      } catch {
        apply({ type: 'fail', id, error: 'failed' })
      } finally {
        pumpRef.current()
      }
    },
    [apply, projectSlug, scope, onUploaded]
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

  const addFiles = (list: FileList | File[] | null | undefined) => {
    const picked = Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (!picked.length) return
    setNotice(null)
    const inFlight = qRef.current.filter((q) => q.status !== 'done' && q.status !== 'error').length
    const free = roomRef.current === undefined ? picked.length : Math.max(0, roomRef.current - inFlight)
    if (picked.length > free) setNotice(t('full'))
    const accepted = picked.slice(0, free).map((file) => {
      const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`
      files.current.set(id, file)
      return { id, name: file.name, size: file.size }
    })
    apply({ type: 'add', items: accepted })
    pumpRef.current()
  }

  const story = (q: QueueItem): string => {
    switch (q.status) {
      case 'waiting':
        return t('story.waiting')
      case 'preparing':
      case 'uploading':
        return t('story.uploading')
      case 'compressing':
        return t('story.compressing')
      case 'done':
        return q.result?.optimized
          ? t('story.optimised', { before: formatBytes(q.size, ui), after: formatBytes(q.result.bytesAfter, ui) })
          : t('story.uploaded')
      case 'error': {
        const known = ['unsupported_type', 'too_large', 'rate_limited', 'forbidden']
        return t(`story.errors.${known.includes(q.error ?? '') ? q.error : 'generic'}`)
      }
    }
  }

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
  const dropProps =
    touch === false && !disabled
      ? {
          onDragEnter: (e: DragEvent) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            dragDepth.current += 1
            setDragOver(true)
          },
          onDragOver: (e: DragEvent) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'copy'
          },
          onDragLeave: () => {
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (!dragDepth.current) setDragOver(false)
          },
          onDrop: (e: DragEvent) => {
            if (!hasFiles(e)) return
            e.preventDefault()
            dragDepth.current = 0
            setDragOver(false)
            addFiles(e.dataTransfer.files)
          },
        }
      : {}

  const full = room !== undefined && room <= 0
  const off = disabled || full

  return (
    <div {...dropProps} className={`rounded-2xl transition-colors ${dragOver ? 'bg-selected-tint ring-2 ring-ring' : ''}`}>
      <input
        ref={cameraRef}
        type="file"
        accept={ACCEPTED_TYPES}
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={pickerRef}
        type="file"
        accept={ACCEPTED_TYPES}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          addFiles(e.target.files)
          e.target.value = ''
        }}
      />

      <div role="group" aria-label={t('label')} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {touch === null ? (
          <div className="invisible col-span-2 min-h-24" aria-hidden="true" />
        ) : touch ? (
          <>
            <Choice icon={ICONS.camera} onPress={() => cameraRef.current?.click()} disabled={off}>
              {t('camera')}
            </Choice>
            <Choice icon={ICONS.phone} onPress={() => pickerRef.current?.click()} disabled={off}>
              {t('phone')}
            </Choice>
          </>
        ) : (
          <Choice icon={ICONS.upload} onPress={() => pickerRef.current?.click()} disabled={off} wide hint={dragOver ? t('dropHere') : t('computerHint')}>
            {t('computer')}
          </Choice>
        )}
        {onOpenLibrary && (
          <Choice icon={ICONS.library} onPress={onOpenLibrary} disabled={off}>
            {t('library')}
          </Choice>
        )}
      </div>

      {notice && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

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
                  <SmallButton
                    onPress={() => {
                      apply({ type: 'retry', id: q.id })
                      pumpRef.current()
                    }}
                  >
                    {t('retry')}
                  </SmallButton>
                  <SmallButton onPress={() => apply({ type: 'remove', id: q.id })}>{t('dismiss')}</SmallButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Choice({
  children,
  icon,
  onPress,
  disabled,
  hint,
  wide,
}: {
  children: ReactNode
  icon: ReactNode
  onPress?: () => void
  disabled?: boolean
  hint?: string
  wide?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={`flex min-h-24 flex-col items-start justify-start gap-3 rounded-2xl border border-border bg-background p-4 text-left text-[0.9375rem] font-medium text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none enabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60 ${
        wide ? 'col-span-1 border-dashed sm:col-span-2' : ''
      }`}
    >
      {icon}
      <span>
        {children}
        {hint && <span className="mt-0.5 block text-sm font-normal text-muted-foreground">{hint}</span>}
      </span>
    </button>
  )
}

function SmallButton({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="inline-flex min-h-11 items-center rounded-full border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </button>
  )
}

function svg(d: string, size = 24) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  )
}

const ICONS = {
  camera: svg('M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'),
  phone: svg('M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2'),
  upload: svg('M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3'),
  library: svg('M4 4h16v16H4zM4 15l4-4 4 4 3-3 5 5M15 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z'),
}
