'use client'

/**
 * The photo card for a photo known only by its id (quick win 2.5): name,
 * description per language, focus point, tags, caption — saved on the Media
 * Library asset, so it applies everywhere the photo is used. Opens from any
 * module's photo list (Catalogue items first).
 */
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { PhotoCard, type CardChange, type CardPhoto } from '@/components/client/media/PhotoCard'
import { mediaApi, type MediaScope } from '@/components/client/media/media-api'

export function PhotoEditSheet({
  projectSlug,
  scope,
  site,
  assetId,
  onClose,
  onChange,
}: {
  projectSlug: string
  scope: MediaScope
  site: { defaultLocale: string; languages: readonly string[] }
  /** The photo to open; null = closed. */
  assetId: string | null
  onClose: () => void
  onChange?: (change: CardChange) => void
}) {
  const t = useTranslations('clientDashboard.media.editSheet')
  const [loaded, setLoaded] = useState<{ id: string; photo: CardPhoto | null } | null>(null)

  useEffect(() => {
    if (!assetId) return
    let live = true
    mediaApi(scope)
      .status({ projectSlug, assetIds: [assetId] })
      .then((r) => {
        if (!live) return
        const i = r.ok ? r.items.find((x) => x.assetId === assetId && x.status === 'ready') : undefined
        setLoaded({
          id: assetId,
          photo: i ? { assetId: i.assetId, rev: i.rev, url: i.url, name: i.name, alt: i.alt, caption: i.caption, tags: i.tags, focal: i.focal } : null,
        })
      })
      .catch(() => live && setLoaded({ id: assetId, photo: null }))
    return () => {
      live = false
    }
  }, [assetId, projectSlug, scope])

  const current = loaded && loaded.id === assetId ? loaded : null
  return (
    <BottomSheet open={assetId !== null} title={t('title')} onClose={onClose}>
      {!current ? (
        <p className="py-6 text-[0.9375rem] text-muted-foreground" role="status">
          {t('loading')}
        </p>
      ) : current.photo ? (
        <PhotoCard key={current.photo.assetId} projectSlug={projectSlug} scope={scope} site={site} photo={current.photo} onChange={(c) => onChange?.(c)} onSaving={() => undefined} />
      ) : (
        <p className="py-6 text-[0.9375rem] text-destructive" role="alert">
          {t('error')}
        </p>
      )}
    </BottomSheet>
  )
}
