'use client'

/**
 * The upload queue behind Add Photos and the gallery wizard's Add step
 * (ADR-035): one implementation for both, backed by the dashboard's upload
 * store (UploadsProvider) so uploads survive leaving the screen. Outside a
 * provider the hook keeps a store of its own (same behaviour, screen-bound).
 *
 * Each picked file gets an instant local preview, is prepared in the browser
 * (planUpload) and sent with `background=1`; the row then shows "Optimising…"
 * until the record is ready (→ `onLanded`) or failed (→ Retry).
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { AddedPhoto } from '@/components/client/media/AddPhotos'
import { thumbOf, type MediaScope } from '@/components/client/media/media-api'
import { createUploadStore, useUploadStore } from '@/components/client/media/UploadsProvider'
import type { QueueItem } from '@/lib/client/gallery-upload-queue'
import type { LandedPhoto } from '@/lib/client/upload-store'
import { formatBytes } from '@/lib/client/upload-plan'

export type UseMediaUploads = {
  queue: QueueItem[]
  /** Queue files the caller has already accepted; returns their queue ids. */
  enqueue: (files: File[]) => string[]
  retry: (id: string) => void
  dismiss: (id: string) => void
  /** Not finished yet (sending or optimising) — e.g. to hold Publish. */
  inFlight: number
}

const toAdded = (r: LandedPhoto): AddedPhoto => ({ assetId: r.assetId, url: r.url, thumbUrl: thumbOf(r.url), name: r.name, alt: {}, focal: null, tags: [] })

export function useMediaUploads({
  projectSlug,
  scope,
  owner: ownerProp,
  onLanded,
  onSettled,
}: {
  projectSlug: string
  scope: MediaScope
  /** Who receives the finished photos (default: this component). Stable keys let a screen pick up its uploads again after a remount. */
  owner?: string
  /** One finished photo, in completion order. */
  onLanded: (photo: AddedPhoto, queueId: string) => void
  /** Every file's end: the photo, or null when it failed. */
  onSettled?: (queueId: string, landed: { assetId: string; url: string } | null) => void
}): UseMediaUploads {
  const shared = useUploadStore()
  const [own] = useState(() => (shared ? null : createUploadStore()))
  const store = shared ?? own!
  useEffect(() => (own ? () => own.dispose() : undefined), [own])

  const instance = useId()
  const owner = ownerProp ?? `screen:${instance}`
  const callbacks = useRef({ onLanded, onSettled })
  useEffect(() => {
    callbacks.current = { onLanded, onSettled }
  }, [onLanded, onSettled])
  useEffect(
    () =>
      store.listen(owner, {
        onLanded: (photo, id) => callbacks.current.onLanded(toAdded(photo), id),
        onSettled: (id, landed) => callbacks.current.onSettled?.(id, landed ? { assetId: landed.assetId, url: landed.url } : null),
      }),
    [store, owner]
  )

  const all = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const queue = useMemo(() => all.filter((i) => store.ownerOf(i.id) === owner), [all, store, owner])
  const inFlight = queue.filter((i) => i.status !== 'done' && i.status !== 'error').length

  return {
    queue,
    inFlight,
    enqueue: (files) => store.enqueue(files, { owner, projectSlug, scope }),
    retry: (id) => store.retry(id),
    dismiss: (id) => store.dismiss(id),
  }
}

/** The one-line story under each row: Uploading… · Optimising… · ✓ Optimised · 2.4 MB → 610 KB. */
export function useUploadStory(): (q: QueueItem) => string {
  const t = useTranslations('clientDashboard.media.add')
  const ui = useLocale()
  return (q) => {
    switch (q.status) {
      case 'waiting':
        return t('story.waiting')
      case 'preparing':
      case 'uploading':
        return t('story.uploading')
      case 'processing':
        return t('story.processing')
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
}

/**
 * A long-lived screen's claim on its uploads (ADR-035 slice 2) — e.g. the
 * Catalogue item wizard. Photos that finish after the Add Photos block is
 * gone (the person moved on) still reach `onLanded`; `inFlight` lets the
 * screen hold Publish until they are ready. Pass the same `owner` to the
 * Add Photos block.
 */
export function useUploadOwner(owner: string, onLanded: (photo: AddedPhoto) => void): { inFlight: number } {
  const store = useUploadStore()
  const latest = useRef(onLanded)
  useEffect(() => {
    latest.current = onLanded
  }, [onLanded])
  useEffect(() => (store ? store.listen(owner, { onLanded: (photo) => latest.current(toAdded(photo)) }, 'fallback') : undefined), [store, owner])
  const subscribe = store?.subscribe ?? noopSubscribe
  const items = useSyncExternalStore(subscribe, store?.getSnapshot ?? emptySnapshot, store?.getSnapshot ?? emptySnapshot)
  const inFlight = store ? items.filter((i) => i.status !== 'done' && i.status !== 'error' && store.ownerOf(i.id) === owner).length : 0
  return { inFlight }
}

const EMPTY: QueueItem[] = []
const emptySnapshot = () => EMPTY
const noopSubscribe = () => () => undefined
