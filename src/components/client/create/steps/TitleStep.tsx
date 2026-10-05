'use client'

import { useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading } from '@/components/client/create/StepHeading'

export const TITLE_MAX = 200
export const SUBTITLE_MAX = 300

/** Shows "N characters left" only once the writer is close to the limit. */
function Remaining({ value, max, id }: { value: string; max: number; id: string }) {
  const t = useTranslations('clientDashboard.create.titleStep')
  const left = max - value.length
  return (
    <p id={id} aria-live="polite" className="mt-2 min-h-5 text-sm text-muted-foreground">
      {left <= Math.max(20, Math.round(max * 0.2)) ? t('remaining', { count: Math.max(0, left) }) : ''}
    </p>
  )
}

/** "Give your story a title" — title (required) and subtitle, in the site's default language. */
export function TitleStep({ draft, locale, update }: StepProps) {
  const t = useTranslations('clientDashboard.create.titleStep')
  const title = draft.title[locale] ?? ''
  const subtitle = draft.subtitle[locale] ?? ''
  return (
    <section aria-labelledby="title-step-title">
      <StepHeading id="title-step-title" title={t('title')} helper={t('helper')} />
      <TitleFields
        idPrefix="title-step"
        title={title}
        subtitle={subtitle}
        onTitle={(v) => update({ [`title.${locale}`]: v })}
        onSubtitle={(v) => update({ [`subtitle.${locale}`]: v })}
        autoFocus
      />
    </section>
  )
}

/** Title + subtitle inputs, shared by the Title and Languages steps. */
export function TitleFields({
  idPrefix,
  title,
  subtitle,
  onTitle,
  onSubtitle,
  autoFocus,
  lang,
  placeholders,
  source,
}: {
  idPrefix: string
  title: string
  subtitle: string
  onTitle: (v: string) => void
  onSubtitle: (v: string) => void
  autoFocus?: boolean
  lang?: string
  /** Neutral placeholders (other languages); the examples are for the original only. */
  placeholders?: { title: string; subtitle: string }
  /** The original-language text, shown read-only above each field (other languages). */
  source?: { label: string; lang: string; title: string; subtitle: string; empty: string }
}) {
  const t = useTranslations('clientDashboard.create.titleStep')
  return (
    <div className="mt-8 flex flex-col gap-6">
      <div>
        <label htmlFor={`${idPrefix}-title`} className="text-[15px] font-medium text-foreground">
          {t('titleLabel')}
        </label>
        {source ? <Source id={`${idPrefix}-title-src`} label={source.label} lang={source.lang} text={source.title || source.empty} /> : null}
        <textarea
          id={`${idPrefix}-title`}
          lang={lang}
          rows={2}
          value={title}
          maxLength={TITLE_MAX}
          autoFocus={autoFocus}
          required
          aria-describedby={source ? `${idPrefix}-title-src ${idPrefix}-title-left` : `${idPrefix}-title-left`}
          placeholder={placeholders?.title ?? t('titlePlaceholder')}
          data-enter-next=""
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          onChange={(e) => onTitle(e.target.value.replace(/\n/g, ' '))}
          className="mt-2 block min-h-[var(--control-height,56px)] w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-2xl leading-8 font-semibold text-foreground placeholder:text-muted-foreground placeholder:font-normal focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <Remaining id={`${idPrefix}-title-left`} value={title} max={TITLE_MAX} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-subtitle`} className="text-[15px] font-medium text-foreground">
          {t('subtitleLabel')}
        </label>
        {source && source.subtitle ? (
          <Source id={`${idPrefix}-subtitle-src`} label={source.label} lang={source.lang} text={source.subtitle} />
        ) : null}
        <textarea
          id={`${idPrefix}-subtitle`}
          lang={lang}
          rows={2}
          value={subtitle}
          maxLength={SUBTITLE_MAX}
          aria-describedby={
            source?.subtitle ? `${idPrefix}-subtitle-src ${idPrefix}-subtitle-left` : `${idPrefix}-subtitle-left`
          }
          placeholder={placeholders?.subtitle ?? t('subtitlePlaceholder')}
          data-enter-next=""
          onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
          onChange={(e) => onSubtitle(e.target.value.replace(/\n/g, ' '))}
          className="mt-2 block min-h-[var(--control-height,56px)] w-full resize-none rounded-xl border border-border bg-background px-4 py-3 text-[19px] leading-7 text-foreground placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        />
        <Remaining id={`${idPrefix}-subtitle-left`} value={subtitle} max={SUBTITLE_MAX} />
      </div>
    </div>
  )
}

/** Read-only original text shown above a translation field. */
function Source({ id, label, lang, text }: { id: string; label: string; lang: string; text: string }) {
  return (
    <div id={id} className="mt-2 rounded-xl bg-muted px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p lang={lang} className="mt-1 text-[17px] leading-7 text-foreground">
        {text}
      </p>
    </div>
  )
}
