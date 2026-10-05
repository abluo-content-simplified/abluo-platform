'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import { BlocksPreview } from '@/components/client/create/ImproveReview'
import { normalizeBlocks } from '@/lib/client/normalize-blocks'
import { hasText } from '@/lib/client/wizard-steps'

/**
 * "Here's how your post will look" — a simple, read-only rendering with the
 * app's tokens (title, subtitle, cover, body) for every language that has
 * content. The real tenant-design preview in a frame comes later (ADR-025 D7).
 */
export function PreviewStep({ draft, site }: StepProps) {
  const t = useTranslations('clientDashboard.create.preview')
  const ui = useLocale()
  const withContent = site.languages.filter((l) => draft.title[l]?.trim() || hasText(draft.body[l]))
  const [picked, setPicked] = useState(withContent[0] ?? site.defaultLocale)
  const locale = withContent.includes(picked) ? picked : (withContent[0] ?? site.defaultLocale)
  const title = draft.title[locale]?.trim()
  const subtitle = draft.subtitle[locale]?.trim()
  const blocks = normalizeBlocks(draft.body[locale])

  return (
    <section aria-labelledby="preview-step-title">
      <StepHeading id="preview-step-title" title={t('title')} helper={t('helper')} />

      {withContent.length > 1 ? (
        <div role="radiogroup" aria-label={t('language')} className="mt-6 flex flex-wrap gap-2">
          {withContent.map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={l === locale}
              onClick={() => setPicked(l)}
              className={`inline-flex min-h-11 items-center rounded-full border-2 px-4 text-[15px] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                l === locale ? 'border-foreground bg-selected-tint text-foreground' : 'border-border text-foreground hover:bg-hover'
              }`}
            >
              {languageName(l, ui)}
            </button>
          ))}
        </div>
      ) : null}

      <article lang={locale} className="mt-8 overflow-hidden rounded-2xl border border-border bg-card text-card-foreground">
        {draft.cover?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${draft.cover.url}?w=1280&auto=format`}
            alt={draft.cover.alt[locale] ?? draft.cover.alt[site.defaultLocale] ?? ''}
            className="aspect-[16/9] w-full object-cover"
          />
        ) : null}
        <div className="p-6">
          {title || subtitle || blocks.length ? (
            <>
              {title ? <h2 className="text-[28px] leading-9 font-semibold tracking-tight">{title}</h2> : null}
              {subtitle ? <p className="mt-3 text-[19px] leading-7 text-muted-foreground">{subtitle}</p> : null}
              {blocks.length ? (
                <div className="mt-6 text-[17px] leading-7">
                  <BlocksPreview blocks={blocks} />
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-muted-foreground">{t('empty')}</p>
          )}
        </div>
      </article>
    </section>
  )
}
