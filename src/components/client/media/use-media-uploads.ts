'use client'

/**
 * The upload queue behind Add Photos and the gallery wizard's Add step
 * (ADR-035): one implementation for both.
 *
 * Each picked file gets an instant local preview, is prepared in the browser
 * (planUpload), and is sent with `background=1`: the server answers as soon as
 * the Media Library record exists. The row then shows "Optimising…" while the
 * server runs the policy, TinyPNG and the Sanity upload, and this hook polls
 * the record until it is ready (→ `onLanded`) or failed (→ Retry).
 *
 * Lives in the component that uses it for now; ADR-035 slice 2 lifts it to the
 * dashboard layout so uploads survive moving between screens.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { AddedPhoto } from '@/components/client/media/AddPhotos'
import { mediaApi, thumbOf, type MediaScope } from '@/components/client/media/media-api'
import {
  nextToStart,
  prepareForUpload,
  processingAssetIds,
  queueReducer,
  type QueueAction,
  type QueueItem,
} from '@/lib/client/gallery-upload-queue'
import { formatBytes } from '@/lib/client/upload-plan'

/** Finished rows stay this long ("✓ Optimised …") before they go. */
const DONE_LINGER_MS = 4000
/** How often in-flight records are checked. */
const POLL_MS = 1500
/** A record still processing after this is reported as failed (Retry sends it again). */
const PROCESSING_GIVE_UP_MS = 2 * 60 * 1000

type Landed = { assetId: string; url: string; name: string; optimized: boolean; bytesBefore: number | null; bytesAfter: number | null }

export type UseMediaUploads = {
  queue: QueueItem[]
  /** Queue files the caller has already accepted; returns their queue ids. */
  enqueue: (files: File[]) => string[]
  retry: (id: string) => void
  dismiss: (id: string) => void
}

export function useMediaUploads({
  projectSlug,
  scope,
  onLanded,
  onSettled,
}: {
  projectSlug: string
  scope: MediaScope
  /** One finished photo, in completion order. */
  onLanded: (photo: AddedPhoto, queueId: string) => void
  /** Every file's end: the photo, or null when it failed. */
  onSettled?: (queueId: string, landed: { assetId: string; url: string } | null) => void
}): UseMediaUploads {
  const [queue, setQueue] = useState<QueueItem[]>([])
  const qRef = useRef<QueueItem[]>([])
  const files = useRef(new Map<string, File>())
  const previews = useRef(new Map<string, string>())
  const processingSince = useRef(new Map<string, number>())
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const callbacks = useRef({ onLanded, onSettled })
  useEffect(() => {
    callbacks.current = { onLanded, onSettled }
  }, [onLanded, onSettled])

  useEffect(() => {
    const all = timers.current
    const urls = previews.current
    return () => {
      all.forEach(clearTimeout)
      if (pollTimer.current) clearTimeout(pollTimer.current)
      urls.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [])

  const apply = useCallback((action: QueueAction) => {
    qRef.current = queueReducer(qRef.current, action)
    setQueue(qRef.current)
    if (action.type === 'remove') {
      const url = previews.current.get(action.id)
      if (url) URL.revokeObjectURL(url)
      previews.current.delete(action.id)
      files.current.delete(action.id)
    }
  }, [])
  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.current.delete(t)
      fn()
    }, ms)
    timers.current.add(t)
  }, [])

  const pumpRef = useRef<() => void>(() => undefined)
  const pollRef = useRef<() => void>(() => undefined)

  const land = useCallback(
    (id: string, r: Landed) => {
      processingSince.current.delete(id)
      apply({
        type: 'done',
        id,
        result: { assetId: r.assetId, url: r.url, optimized: r.optimized, bytesBefore: r.bytesBefore ?? 0, bytesAfter: r.bytesAfter ?? 0 },
      })
      files.current.delete(id)
      later(() => apply({ type: 'remove', id }), DONE_LINGER_MS)
      callbacks.current.onLanded({ assetId: r.assetId, url: r.url, thumbUrl: thumbOf(r.url), name: r.name, alt: {}, focal: null, tags: [] }, id)
      callbacks.current.onSettled?.(id, { assetId: r.assetId, url: r.url })
    },
    [apply, later]
  )
  const fail = useCallback(
    (id: string, error: string) => {
      processingSince.current.delete(id)
      apply({ type: 'fail', id, error })
      callbacks.current.onSettled?.(id, null)
    },
    [apply]
  )

  // ── Poll the records waiting on the server ──────────────────────────────
  const poll = useCallback(async () => {
    pollTimer.current = null
    const ids = processingAssetIds(qRef.current)
    if (!ids.length) return
    try {
      const r = await mediaApi(scope).status({ projectSlug, assetIds: ids })
      if (r.ok) {
        const byAsset = new Map(r.items.map((i) => [i.assetId, i]))
        for (const q of qRef.current) {
          if (q.status !== 'processing' || !q.assetId) continue
          const s = byAsset.get(q.assetId)
          if (s?.status === 'ready') land(q.id, s)
          else if (s?.status === 'failed') fail(q.id, 'failed')
          else if (Date.now() - (processingSince.current.get(q.id) ?? Date.now()) > PROCESSING_GIVE_UP_MS) fail(q.id, 'failed')
        }
      }
    } catch {
      // A missed poll is retried on the next tick.
    }
    pumpRef.current()
    if (processingAssetIds(qRef.current).length && !pollTimer.current) pollTimer.current = setTimeout(() => pollRef.current(), POLL_MS)
  }, [projectSlug, scope, land, fail])
  useEffect(() => {
    pollRef.current = () => void poll()
  }, [poll])
  const schedulePoll = useCallback(() => {
    if (!pollTimer.current) pollTimer.current = setTimeout(() => pollRef.current(), POLL_MS)
  }, [])

  // ── Send one file ───────────────────────────────────────────────────────
  const run = useCallback(
    async (id: string) => {
      const file = files.current.get(id)
      try {
        if (!file) throw new Error('gone')
        const prepared = await prepareForUpload(file)
        if (!prepared) return fail(id, 'unsupported_type')
        apply({ type: 'status', id, status: 'uploading' })
        const form = new FormData()
        form.set('projectSlug', projectSlug)
        form.set('file', prepared)
        form.set('background', '1')
        const r = await mediaApi(scope).upload(form)
        if (!r.ok) return fail(id, r.error)
        if (r.status === 'ready') return land(id, { ...r, name: r.name ?? '' })
        processingSince.current.set(id, Date.now())
        apply({ type: 'processing', id, assetId: r.assetId })
        schedulePoll()
      } catch {
        fail(id, 'failed')
      } finally {
        pumpRef.current()
      }
    },
    [apply, projectSlug, scope, land, fail, schedulePoll]
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

  const enqueue = useCallback(
    (list: File[]) => {
      const items = list.map((file) => {
        const id = `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`
        files.current.set(id, file)
        let preview: string | undefined
        try {
          preview = URL.createObjectURL(file)
          previews.current.set(id, preview)
        } catch {
          // No preview (old browser): the row shows its name only.
        }
        return { id, name: file.name, size: file.size, preview }
      })
      apply({ type: 'add', items })
      // The queue caps a batch: drop what didn't fit.
      const kept = new Set(qRef.current.map((q) => q.id))
      for (const i of items) {
        if (kept.has(i.id)) continue
        if (i.preview) URL.revokeObjectURL(i.preview)
        previews.current.delete(i.id)
        files.current.delete(i.id)
      }
      pumpRef.current()
      return items.filter((i) => kept.has(i.id)).map((i) => i.id)
    },
    [apply]
  )

  return {
    queue,
    enqueue,
    retry: (id) => {
      apply({ type: 'retry', id })
      pumpRef.current()
    },
    dismiss: (id) => apply({ type: 'remove', id }),
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
