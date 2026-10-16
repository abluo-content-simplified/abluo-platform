'use client'

import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { FocalPoint } from '@/components/client/media/FocalPointPicker'
import type { MediaScope } from '@/components/client/media/media-api'
import { UploadQueueList } from '@/components/client/media/UploadQueueList'
import { useMediaUploads } from '@/components/client/media/use-media-uploads'
import { ACCEPTED_TYPES } from '@/lib/client/gallery-upload-queue'

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
  /** Who receives finished photos (ADR-035: a wizard passes its own key so photos still land after this block is gone). */
  owner?: string
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

/**
 * Add photos — the blog Cover step's choices, for many photos at once.
 * Phone: Take a photo (camera) · From this phone (multiple) · Media Library.
 * Computer: Upload or drag (multiple, the whole block is a drop zone) · Media Library.
 * Each file tells its story — preview, Uploading → Optimising → Optimised ✓ (TinyPNG,
 * "2.4 MB → 610 KB") — and its row goes away once done. The browser only
 * pre-resizes when a photo would not fit the upload (planUpload).
 * No side effects on mount (safe to keep mounted while hidden).
 */
export function AddPhotos({ projectSlug, scope, onUploaded, onOpenLibrary, room, disabled, owner }: AddPhotosProps) {
  const t = useTranslations('clientDashboard.media.add')
  const touch = useTouchDevice()
  const cameraRef = useRef<HTMLInputElement>(null)
  const pickerRef = useRef<HTMLInputElement>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)

  const roomRef = useRef(room)
  useEffect(() => {
    roomRef.current = room
  }, [room])

  const uploads = useMediaUploads({ projectSlug, scope, owner, onLanded: (photo) => onUploaded(photo) })
  const inFlight = () => uploads.queue.filter((q) => q.status !== 'done' && q.status !== 'error').length

  const addFiles = (list: FileList | File[] | null | undefined) => {
    const picked = Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name))
    if (!picked.length) return
    setNotice(null)
    const free = roomRef.current === undefined ? picked.length : Math.max(0, roomRef.current - inFlight())
    if (picked.length > free) setNotice(t('full'))
    uploads.enqueue(picked.slice(0, free))
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

      <UploadQueueList uploads={uploads} />
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
