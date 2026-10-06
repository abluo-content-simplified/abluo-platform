'use client'

import { useTranslations } from 'next-intl'
import type { MediaScope } from '@/components/client/media/media-api'
import { PhotoCard, type CardChange, type CardPhoto } from '@/components/client/media/PhotoCard'

export type FocalPoint = { x: number; y: number }
/** The photo as a wizard holds it: a Media Library asset plus its place in the list. */
export type DescribedPhoto = CardPhoto & { key: string }
export type DescribeChange = CardChange

/**
 * "Describe photo n of N" — one photo of a gallery or of a media upload, in
 * the one photo card (name, focus point + description, tags, caption; the
 * site's languages as tabs). Nothing is required (Tom, wave B): Next always
 * goes on, and "Describe later" skips the rest.
 */
export function PhotoDescribeStep({
  projectSlug,
  scope,
  site,
  photo,
  index,
  total,
  tagSuggestions,
  onChange,
  onSaving,
  onSkip,
}: {
  projectSlug: string
  scope: MediaScope
  site: { defaultLocale: string; languages: readonly string[] }
  photo: DescribedPhoto
  index: number
  total: number
  tagSuggestions?: readonly string[]
  onChange: (change: DescribeChange) => void
  onSaving: (job: Promise<unknown>) => void
  /** "Describe later": leave the remaining photos as they are. */
  onSkip?: () => void
}) {
  const t = useTranslations('clientDashboard.photoWizard.describe')

  return (
    <section aria-labelledby="describe-step-title" className="flex flex-col">
      <h1 id="describe-step-title" className="text-[1.875rem] leading-9 font-semibold tracking-tight text-foreground">
        {t('title', { n: index + 1, total })}
      </h1>
      <p className="mt-3 text-[1.0625rem] leading-7 text-muted-foreground">{t('helperLater')}</p>
      {onSkip ? (
        <div className="mt-3">
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex min-h-11 items-center rounded-lg px-1 text-[0.9375rem] font-medium text-foreground underline underline-offset-4 hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {total - index > 1 ? t('skipRest', { count: total - index }) : t('skip')}
          </button>
        </div>
      ) : null}

      <div className="mt-8">
        <PhotoCard
          projectSlug={projectSlug}
          scope={scope}
          site={site}
          photo={photo}
          tagSuggestions={tagSuggestions}
          onChange={onChange}
          onSaving={onSaving}
        />
      </div>
    </section>
  )
}
