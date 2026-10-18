'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BodyEditor } from '@/components/client/editor/BodyEditor'
import { useLinkTools } from '@/components/client/create/use-link-tools'
import type { StepProps } from '@/components/client/create/types'
import { LanguageChoiceList, LanguageWriteSection, type LanguageChoice } from '@/components/client/create/LanguageChoices'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import { TitleFields } from '@/components/client/create/steps/TitleStep'
import { BlocksPreview } from '@/components/client/create/ImproveReview'
import { asEditorValue, normalizeBlocks } from '@/lib/client/normalize-blocks'
import { languageReady } from '@/lib/client/wizard-steps'

export type { LanguageChoice }

/**
 * "Make it available in other languages?" (ADR-025 D9) — multilingual sites
 * only. The original language first; for each other language: Translate for me
 * (not yet — "Coming soon"), I'll write it (title, subtitle and story for that
 * language, via a language switch), or Not now. A language goes live only once
 * it has a title and text, so "Not now" is always safe.
 */
export function LanguagesStep({
  draft,
  site,
  update,
  choices,
  onChoice,
}: StepProps & {
  choices: Record<string, LanguageChoice>
  onChoice: (locale: string, choice: LanguageChoice) => void
}) {
  const t = useTranslations('clientDashboard.create.languages')
  const ui = useLocale()
  const others = site.languages.filter((l) => l !== site.defaultLocale)
  const writing = others.filter((l) => choices[l] === 'write')
  const [active, setActive] = useState<string | null>(writing[0] ?? null)
  const current = active && writing.includes(active) ? active : (writing[0] ?? null)
  const links = useLinkTools(site.projectSlug, current)
  const sourceLabel = t('sourceLabel', {
    language: languageName(site.defaultLocale, ui),
  })
  const original = normalizeBlocks(draft.body[site.defaultLocale], draft.body[site.defaultLocale])

  return (
    <section aria-labelledby="languages-step-title">
      <StepHeading id="languages-step-title" title={t('title')} helper={t('helper')} />

      <LanguageChoiceList
        defaultLocale={site.defaultLocale}
        others={others}
        choices={choices}
        isReady={(l) => languageReady(draft, l)}
        onChoice={onChoice}
        onActive={setActive}
      />

      {current ? (
        <LanguageWriteSection writing={writing} current={current} onActive={setActive}>
          <TitleFields
            idPrefix={`lang-${current}`}
            lang={current}
            title={draft.title[current] ?? ''}
            subtitle={draft.subtitle[current] ?? ''}
            onTitle={(v) => update({ [`title.${current}`]: v })}
            onSubtitle={(v) => update({ [`subtitle.${current}`]: v })}
            placeholders={{
              title: t('titlePlaceholder', {
                language: languageName(current, ui),
              }),
              subtitle: t('subtitlePlaceholder', {
                language: languageName(current, ui),
              }),
            }}
            source={{
              label: sourceLabel,
              lang: site.defaultLocale,
              title: draft.title[site.defaultLocale] ?? '',
              subtitle: draft.subtitle[site.defaultLocale] ?? '',
              empty: t('sourceEmpty'),
            }}
          />
          <p className="mt-6 text-[0.9375rem] font-medium text-foreground">{t('storyLabel')}</p>
          {/* Phones: the original folds away above the editor. */}
          <details className="mt-2 rounded-xl bg-muted md:hidden">
            <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[0.9375rem] font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              {t('showOriginal')}
            </summary>
            <div lang={site.defaultLocale} className="px-4 pb-4 text-[1rem] leading-7">
              {original.length ? <BlocksPreview blocks={original} /> : <p className="text-muted-foreground">{t('sourceEmpty')}</p>}
            </div>
          </details>
          {/* From md: original and translation side by side. */}
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <div lang={site.defaultLocale} className="hidden rounded-xl bg-muted p-4 text-[1rem] leading-7 md:block">
              <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{sourceLabel}</p>
              {original.length ? <BlocksPreview blocks={original} /> : <p className="text-muted-foreground">{t('sourceEmpty')}</p>}
            </div>
            <div className="flex min-h-64 flex-col" lang={current}>
              <BodyEditor
                initialValue={asEditorValue(normalizeBlocks(draft.body[current], draft.body[current]))}
                placeholder={t('storyPlaceholder', {
                  language: languageName(current, ui),
                })}
                onChange={(value) =>
                  update({
                    [`body.${current}`]: normalizeBlocks(value, draft.body[current]),
                  })
                }
                links={links}
              />
            </div>
          </div>
        </LanguageWriteSection>
      ) : null}
    </section>
  )
}
