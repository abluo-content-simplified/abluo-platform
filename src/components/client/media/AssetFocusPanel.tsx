'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getMediaPhotoFocalAction, updateMediaPhotoAction } from '@/app/[locale]/(client)/[tenant]/media/actions'
import { FocalPointPicker, type FocalPoint, type FocalPointPickerLabels } from '@/components/app/ui/FocalPointPicker'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { Skeleton } from '@/components/app/ui/Skeleton'

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

export type AssetFocusPanelLabels = FocalPointPickerLabels & {
  /** The point could not be read. */
  loadFailed: string
  /** "Saving…" / "Saved" / "Not saved — move the point again". */
  status: Record<Exclude<SaveState, 'idle'>, string>
  /** One line under the picker: where the point applies. */
  scope: string
}

/**
 * The focus point of ONE Media Library photo (ADR-022 §4a), saved ON THE
 * ASSET — so it holds everywhere the photo is used (galleries, people, digital
 * cards…). Reads the photo's original URL and current point once per asset
 * (`onFocal` hands it to the screen so its own previews react at once) and
 * saves when the dot is released or blurred, through the Media screen's own
 * action (Media permission, checked on the server). Saves queue in order; a
 * move left unsaved is saved on unmount.
 *
 * Shared by the People editor (person photo) and the Digital Card editor
 * (background) — rule of two (CLAUDE.md, Component Lab).
 */
export function AssetFocusPanel({
  projectSlug,
  assetId,
  alt,
  focal,
  onFocal,
  editable,
  show,
  labels,
}: {
  projectSlug: string
  assetId: string
  /** The photo's accessible description inside the picker. */
  alt: string
  focal: FocalPoint | null
  onFocal: (point: FocalPoint | null) => void
  /** Only people who may manage media can move the point; the rest see the photo as it is. */
  editable: boolean
  /** The picker is open. The point is read either way, so the screen's previews already show it. */
  show: boolean
  labels: AssetFocusPanelLabels
}) {
  const [photo, setPhoto] = useState<{ url: string; rev: string } | null>(null)
  const [failed, setFailed] = useState(false)
  const [save, setSave] = useState<SaveState>('idle')
  const rev = useRef('')
  const latest = useRef<FocalPoint | null>(focal)
  const dirty = useRef(false)
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Read the asset's original URL and current point once per photo.
  useEffect(() => {
    let live = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- a new photo starts loading
    setPhoto(null)
    onFocal(null)
    setFailed(false)
    setSave('idle')
    dirty.current = false
    void getMediaPhotoFocalAction({ projectSlug, assetId })
      .then((r) => {
        if (!live) return
        if (!r.ok) return setFailed(true)
        rev.current = r.photo.rev
        latest.current = r.photo.focal
        setPhoto({ url: r.photo.url, rev: r.photo.rev })
        onFocal(r.photo.focal)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
    // onFocal is the screen's setter (stable); the photo is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug, assetId])

  const commit = useCallback(() => {
    if (!dirty.current || !latest.current) return
    dirty.current = false
    const point = latest.current
    setSave('saving')
    const job = async () => {
      const r = await updateMediaPhotoAction({ projectSlug, assetId, rev: rev.current || undefined, focal: point })
      if (!r.ok) {
        dirty.current = true // the next release tries again
        if (alive.current) setSave('failed')
        return
      }
      rev.current = r.rev
      if (alive.current) setSave(dirty.current ? 'saving' : 'saved')
    }
    queue.current = queue.current.then(job, job).catch(() => alive.current && setSave('failed'))
  }, [projectSlug, assetId])

  // Leaving with an unsaved move saves it.
  const commitRef = useRef(commit)
  useEffect(() => {
    commitRef.current = commit
  }, [commit])
  useEffect(() => () => commitRef.current(), [])

  if (!show) return null
  if (failed) return <Notice tone="error">{labels.loadFailed}</Notice>
  if (!photo) return <Skeleton className="h-48 w-full" />

  return (
    <Panel className="space-y-3">
      <FocalPointPicker
        url={photo.url}
        alt={alt}
        point={focal}
        onChange={(p) => {
          if (!editable) return
          latest.current = p
          dirty.current = true
          onFocal(p)
        }}
        onCommit={commit}
        status={save === 'idle' ? '' : labels.status[save]}
        statusError={save === 'failed'}
        compact
        labels={labels}
      />
      <p className="text-sm leading-5 text-muted-foreground">{labels.scope}</p>
    </Panel>
  )
}
