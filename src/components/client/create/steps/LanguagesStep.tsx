'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BodyEditor } from '@/components/client/editor/BodyEditor'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import { TitleFields } from '@/components/client/create/steps/TitleStep'
import { BlocksPreview } from '@/components/client/create/ImproveReview'
import { asEditorValue, normalizeBlocks } from '@/lib/client/normalize-blocks'
import { languageReady } from '@/lib/client/wizard-steps'

export type LanguageChoice = 'translate' | 'write' | 'later'

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
  const sourceLabel = t('sourceLabel', { language: languageName(site.defaultLocale, ui) })
  const original = normalizeBlocks(draft.body[site.defaultLocale])

  return (
    <section aria-labelledby="languages-step-title">
      <StepHeading id="languages-step-title" title={t('title')} helper={t('helper')} />

      <ul className="mt-8 flex flex-col gap-3">
        <li className="flex min-h-14 items-center justify-between rounded-2xl border border-border-subtle bg-muted px-4 py-3">
          <span className="text-[17px] font-medium text-foreground">{languageName(site.defaultLocale, ui)}</span>
          <span className="text-sm text-muted-foreground">{t('original')}</span>
        </li>
        {others.map((locale) => {
          const choice = choices[locale] ?? 'later'
          const name = languageName(locale, ui)
          const ready = languageReady(draft, locale)
          return (
            <li key={locale} className="rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[17px] font-medium text-foreground">{name}</span>
                <span className={`text-sm ${ready ? 'text-success' : 'text-muted-foreground'}`}>{ready ? t('ready') : t('missing')}</span>
              </div>
              <div role="radiogroup" aria-label={name} className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Choice on={false} disabled label={t('translate')} badge={t('soon')} />
                <Choice
                  on={choice === 'write'}
                  label={t('write')}
                  onPress={() => {
                    onChoice(locale, 'write')
                    setActive(locale)
                  }}
                />
                <Choice on={choice === 'later'} label={t('later')} onPress={() => onChoice(locale, 'later')} />
              </div>
            </li>
          )
        })}
      </ul>

      {current ? (
        <div className="mt-10 border-t border-border-subtle pt-8">
          {writing.length > 1 ? (
            <div role="radiogroup" aria-label={t('write')} className="mb-6 flex flex-wrap gap-2">
              {writing.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={l === current}
                  onClick={() => setActive(l)}
                  className={`inline-flex min-h-11 items-center rounded-full border-2 px-4 text-[15px] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    l === current ? 'border-foreground bg-selected-tint text-foreground' : 'border-border text-foreground hover:bg-hover'
                  }`}
                >
                  {languageName(l, ui)}
                </button>
              ))}
            </div>
          ) : null}
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            {t('editing', { language: languageName(current, ui) })}
          </h2>
          <div key={current}>
            <TitleFields
              idPrefix={`lang-${current}`}
              lang={current}
              title={draft.title[current] ?? ''}
              subtitle={draft.subtitle[current] ?? ''}
              onTitle={(v) => update({ [`title.${current}`]: v })}
              onSubtitle={(v) => update({ [`subtitle.${current}`]: v })}
              placeholders={{
                title: t('titlePlaceholder', { language: languageName(current, ui) }),
                subtitle: t('subtitlePlaceholder', { language: languageName(current, ui) }),
              }}
              source={{
                label: sourceLabel,
                lang: site.defaultLocale,
                title: draft.title[site.defaultLocale] ?? '',
                subtitle: draft.subtitle[site.defaultLocale] ?? '',
                empty: t('sourceEmpty'),
              }}
            />
            <p className="mt-6 text-[15px] font-medium text-foreground">{t('storyLabel')}</p>
            {/* Phones: the original folds away above the editor. */}
            <details className="mt-2 rounded-xl bg-muted md:hidden">
              <summary className="flex min-h-11 cursor-pointer items-center px-4 text-[15px] font-medium text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                {t('showOriginal')}
              </summary>
              <div lang={site.defaultLocale} className="px-4 pb-4 text-[16px] leading-7">
                {original.length ? <BlocksPreview blocks={original} /> : <p className="text-muted-foreground">{t('sourceEmpty')}</p>}
              </div>
            </details>
            {/* From md: original and translation side by side. */}
            <div className="mt-2 grid gap-4 md:grid-cols-2">
              <div lang={site.defaultLocale} className="hidden rounded-xl bg-muted p-4 text-[16px] leading-7 md:block">
                <p className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">{sourceLabel}</p>
                {original.length ? <BlocksPreview blocks={original} /> : <p className="text-muted-foreground">{t('sourceEmpty')}</p>}
              </div>
              <div className="flex min-h-64 flex-col" lang={current}>
                <BodyEditor
                  initialValue={asEditorValue(normalizeBlocks(draft.body[current]))}
                  placeholder={t('storyPlaceholder', { language: languageName(current, ui) })}
                  onChange={(value) => update({ [`body.${current}`]: normalizeBlocks(value) })}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function Choice({
  on,
  label,
  onPress,
  disabled,
  badge,
}: {
  on: boolean
  label: string
  onPress?: () => void
  disabled?: boolean
  badge?: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      onClick={onPress}
      className={`flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-3 text-[15px] font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted-foreground ${
        on ? 'border-foreground bg-selected-tint text-foreground' : 'border-border text-foreground enabled:hover:bg-hover'
      }`}
    >
      {label}
      {badge ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{badge}</span> : null}
    </button>
  )
}
