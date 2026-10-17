'use client'

import { useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { OptionCards } from '@/components/app/ui/OptionCards'
import { StepHeading } from '@/components/client/create/StepHeading'

const NONE = '__none'

/**
 * "Add a gallery to this post?" — overview-only screen. One of this site's
 * galleries, or none. Saved as `gallery` on the post draft (same-project check
 * on the server); shown below the article once the gallery is published.
 */
export function GalleryPickStep({ draft, site, update }: StepProps) {
  const t = useTranslations('clientDashboard.gallery.post')
  const tl = useTranslations('clientDashboard.gallery.list')
  const galleries = site.galleries ?? []
  const selected = draft.gallery ?? null

  return (
    <section aria-labelledby="gallery-pick-title">
      <StepHeading id="gallery-pick-title" title={t('title')} helper={t('helper')} />
      <div className="mt-8 flex flex-col gap-3">
        {galleries.length === 0 ? <p className="text-[0.9375rem] text-muted-foreground">{t('noGalleries')}</p> : null}
        <OptionCards
          label={t('options')}
          value={selected ?? NONE}
          onChange={(v) => update({ gallery: v === NONE ? null : v })}
          options={[
            ...galleries.map((g) => ({ value: g.id, title: g.title, body: tl('count', { count: g.count }) })),
            { value: NONE, title: t('none'), body: t('noneHelp') },
          ]}
        />
      </div>
    </section>
  )
}
