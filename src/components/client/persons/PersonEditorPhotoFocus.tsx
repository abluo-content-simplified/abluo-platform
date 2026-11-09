'use client'

import { useTranslations } from 'next-intl'
import type { FocalPoint } from '@/components/app/ui/FocalPointPicker'
import { AssetFocusPanel } from '@/components/client/media/AssetFocusPanel'

/**
 * The person photo's focus point (ADR-022 §4a): the same hotspot the Media
 * Library and galleries set, saved on the Media Library ASSET — so it holds
 * everywhere the photo is used. The shared AssetFocusPanel does the reading
 * and saving (Media screen's own actions, Media permission on the server);
 * this only gives it the People wording.
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
  return (
    <AssetFocusPanel
      projectSlug={projectSlug}
      assetId={assetId}
      alt={name}
      focal={focal}
      onFocal={onFocal}
      editable={editable}
      show={show}
      labels={{
        title: t('title'),
        helper: editable ? t('helper') : t('readOnly'),
        keys: t('keys'),
        label: t('label'),
        valueText: (x, y) => t('valueText', { x, y }),
        previews: t('previews'),
        preview: { wide: t('preview.wide'), card: t('preview.card'), square: t('preview.square'), tall: t('preview.tall') },
        loadFailed: t('loadFailed'),
        status: { saving: t('status.saving'), saved: t('status.saved'), failed: t('status.failed') },
        scope: t('scope'),
      }}
    />
  )
}
