'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { getPersonPhotoFocalAction } from '@/app/[locale]/(client)/[tenant]/people/editor-actions'
import { updateMediaPhotoAction } from '@/app/[locale]/(client)/[tenant]/media/actions'
import { FocalPointPicker, type FocalPoint } from '@/components/app/ui/FocalPointPicker'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { Skeleton } from '@/components/app/ui/Skeleton'

type SaveState = 'idle' | 'saving' | 'saved' | 'failed'

/**
 * The person photo's focus point (ADR-022 §4a): the same hotspot the Media
 * Library and galleries set, saved on the Media Library ASSET — so it holds
 * everywhere the photo is used. The point is read when the photo is shown
 * (`onFocal` hands it to the editor so the thumbnail and the round avatar react
 * at once) and saved when the dot is released or blurred, through the Media
 * screen's own action (Media permission, checked on the server).
 */
export function PersonEditorPhotoFocus({
  projectSlug,
  assetId,
  name,
  focal,
  onFocal,
  editable,
  show,
}: {
  projectSlug: string
  assetId: string
  /** The person's name, for the photo's accessible description. */
  name: string
  focal: FocalPoint | null
  onFocal: (point: FocalPoint | null) => void
  /** Only people who may manage media can move the point; the rest see the photo as it is. */
  editable: boolean
  /** The picker is open. The point is read either way, so the thumbnail and the round avatar already show it. */
  show: boolean
}) {
  const t = useTranslations('clientDashboard.persons.editor.profile.focal')
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
    void getPersonPhotoFocalAction({ projectSlug, assetId })
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
    // onFocal is the editor's setter (stable); the photo is what matters.
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
  if (failed) return <Notice tone="error">{t('loadFailed')}</Notice>
  if (!photo) return <Skeleton className="h-48 w-full" />

  return (
    <Panel className="space-y-3">
      <FocalPointPicker
        url={photo.url}
        alt={name}
        point={focal}
        onChange={(p) => {
          if (!editable) return
          latest.current = p
          dirty.current = true
          onFocal(p)
        }}
        onCommit={commit}
        status={save === 'idle' ? '' : t(`status.${save}`)}
        statusError={save === 'failed'}
        compact
        labels={{
          title: t('title'),
          helper: editable ? t('helper') : t('readOnly'),
          keys: t('keys'),
          label: t('label'),
          valueText: (x, y) => t('valueText', { x, y }),
          previews: t('previews'),
          preview: { wide: t('preview.wide'), card: t('preview.card'), square: t('preview.square'), tall: t('preview.tall') },
        }}
      />
      <p className="text-sm leading-5 text-muted-foreground">{t('scope')}</p>
    </Panel>
  )
}
