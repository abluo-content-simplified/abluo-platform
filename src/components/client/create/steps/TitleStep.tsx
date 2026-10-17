'use client'

import { useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { AssistButton } from '@/components/app/ui/AssistButton'
import { TextArea } from '@/components/app/ui/TextInput'
import { StepHeading } from '@/components/client/create/StepHeading'
import { ImproveReview } from '@/components/client/create/ImproveReview'
import { normalizeBlocks } from '@/lib/client/normalize-blocks'

export type ImproveLineResult = { ok: true; text: string } | { ok: false; error: string }

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

/** One line of text as a Portable Text block (for the side-by-side review). */
function lineBlocks(text: string) {
  return normalizeBlocks([{ _type: 'block', _key: 'l', style: 'normal', markDefs: [], children: [{ _type: 'span', _key: 's', text, marks: [] }] }])
}

/**
 * "Give your story a title" — title (required) and subtitle, in the site's
 * default language. "Improve title" / "Improve subtitle" work like Improve on
 * the story: the AI's suggestion is shown next to the writer's own, and
 * nothing changes unless they choose it. Without AI (`onImproveLine` absent)
 * the buttons say "Coming soon".
 */
export function TitleStep({
  draft,
  locale,
  update,
  onImproveLine,
}: StepProps & { onImproveLine?: (field: 'title' | 'subtitle', text: string) => Promise<ImproveLineResult> }) {
  const t = useTranslations('clientDashboard.create.titleStep')
  const title = draft.title[locale] ?? ''
  const subtitle = draft.subtitle[locale] ?? ''
  const [working, setWorking] = useState<'title' | 'subtitle' | null>(null)
  const [review, setReview] = useState<{ field: 'title' | 'subtitle'; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const improve = async (field: 'title' | 'subtitle') => {
    const current = field === 'title' ? title : subtitle
    if (!onImproveLine || working || !current.trim()) return
    setError(null)
    setWorking(field)
    try {
      const r = await onImproveLine(field, current)
      if (!r.ok) setError(r.error)
      else if (r.text.trim() && r.text.trim() !== current.trim()) setReview({ field, text: r.text.trim() })
      else setError(t('improveSame'))
    } finally {
      setWorking(null)
    }
  }

  const button = (field: 'title' | 'subtitle') => (
    <AssistButton
      badge={onImproveLine ? undefined : t('soon')}
      busy={working === field}
      disabled={!onImproveLine || working !== null || !(field === 'title' ? title : subtitle).trim()}
      onClick={() => void improve(field)}
    >
      {working === field ? t('improving') : field === 'title' ? t('improveTitle') : t('improveSubtitle')}
    </AssistButton>
  )

  return (
    <section aria-labelledby="title-step-heading">
      <StepHeading id="title-step-heading" title={t('title')} helper={t('helper')} />
      <TitleFields
        idPrefix="title-step"
        title={title}
        subtitle={subtitle}
        onTitle={(v) => update({ [`title.${locale}`]: v })}
        onSubtitle={(v) => update({ [`subtitle.${locale}`]: v })}
        autoFocus
        actions={{ title: button('title'), subtitle: button('subtitle') }}
      />
      <p role="status" className="mt-2 min-h-5 text-sm text-destructive">
        {error}
      </p>
      <ImproveReview
        open={review !== null}
        original={lineBlocks(review ? (review.field === 'title' ? title : subtitle) : '')}
        suggestion={lineBlocks(review?.text ?? '')}
        onKeep={() => setReview(null)}
        onAccept={() => {
          if (review) {
            const max = review.field === 'title' ? TITLE_MAX : SUBTITLE_MAX
            update({ [`${review.field}.${locale}`]: review.text.replace(/\s+/g, ' ').slice(0, max) })
          }
          setReview(null)
        }}
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
  actions,
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
  /** A button on the left of each field's counter row ("Improve title"). */
  actions?: { title?: ReactNode; subtitle?: ReactNode }
}) {
  const t = useTranslations('clientDashboard.create.titleStep')
  return (
    <div className="mt-8 flex flex-col gap-6">
      <div>
        <label htmlFor={`${idPrefix}-title`} className="text-[0.9375rem] font-medium text-foreground">
          {t('titleLabel')}
        </label>
        {source ? <Source id={`${idPrefix}-title-src`} label={source.label} lang={source.lang} text={source.title || source.empty} /> : null}
        <TextArea
          flush
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
          textSize="title"
          className="mt-2 block"
        />
        {actions?.title ? (
          <div className="mt-2 flex items-start justify-between gap-3">
            {actions.title}
            <Remaining id={`${idPrefix}-title-left`} value={title} max={TITLE_MAX} />
          </div>
        ) : (
          <Remaining id={`${idPrefix}-title-left`} value={title} max={TITLE_MAX} />
        )}
      </div>
      <div>
        <label htmlFor={`${idPrefix}-subtitle`} className="text-[0.9375rem] font-medium text-foreground">
          {t('subtitleLabel')}
        </label>
        {source && source.subtitle ? (
          <Source id={`${idPrefix}-subtitle-src`} label={source.label} lang={source.lang} text={source.subtitle} />
        ) : null}
        <TextArea
          flush
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
          textSize="lead"
          className="mt-2 block"
        />
        {actions?.subtitle ? (
          <div className="mt-2 flex items-start justify-between gap-3">
            {actions.subtitle}
            <Remaining id={`${idPrefix}-subtitle-left`} value={subtitle} max={SUBTITLE_MAX} />
          </div>
        ) : (
          <Remaining id={`${idPrefix}-subtitle-left`} value={subtitle} max={SUBTITLE_MAX} />
        )}
      </div>
    </div>
  )
}

/** Read-only original text shown above a translation field. */
function Source({ id, label, lang, text }: { id: string; label: string; lang: string; text: string }) {
  return (
    <div id={id} className="mt-2 rounded-xl bg-muted px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p lang={lang} className="mt-1 text-[1.0625rem] leading-7 text-foreground">
        {text}
      </p>
    </div>
  )
}
