'use client'

import { useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading } from '@/components/client/create/StepHeading'

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
      <div role="radiogroup" aria-label={t('options')} className="mt-8 flex flex-col gap-3">
        {galleries.map((g) => (
          <Option key={g.id} on={selected === g.id} onPick={() => update({ gallery: g.id })} title={g.title}>
            {tl('count', { count: g.count })}
          </Option>
        ))}
        {galleries.length === 0 ? <p className="text-[0.9375rem] text-muted-foreground">{t('noGalleries')}</p> : null}
        <Option on={!selected} onPick={() => update({ gallery: null })} title={t('none')}>
          {t('noneHelp')}
        </Option>
      </div>
    </section>
  )
}

function Option({ on, onPick, title, children }: { on: boolean; onPick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      onClick={onPick}
      className={`flex min-h-16 w-full flex-col items-start gap-1 rounded-2xl border-2 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
        on ? 'border-foreground bg-selected-tint' : 'border-border hover:bg-hover'
      }`}
    >
      <span className="text-[1.0625rem] font-semibold text-foreground">{title}</span>
      <span className="text-[0.9375rem] leading-6 text-muted-foreground">{children}</span>
    </button>
  )
}
