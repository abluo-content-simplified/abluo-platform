'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import { languageStates, languageSummaryKey } from '@/lib/client/wizard-steps'
import { PublishChoice } from '@/components/app/lifecycle/PublishChoice'
import { choiceValue, type PublishChoice as PostPublishChoice } from './publish-choice-model'
import { editingZone } from '@/components/app/lifecycle/zoned-time'

/**
 * "What do you want to do with it?" — the shared PublishChoice (Publish now /
 * Schedule / Keep as draft, each expanding in place with its dates), in the
 * post's own wording. The shell's main button performs the
 * choice (it flushes autosave first). Each language is listed with whether it
 * goes live (D9: title + text).
 */
export function PublishStep({
  draft,
  site,
  choice,
  onChange,
  error,
  faqChoice,
}: StepProps & {
  choice: PostPublishChoice
  onChange: (c: PostPublishChoice) => void
  error: string | null
  /** "Publish the FAQ set too" (ADR-037 D9), when the post shows never-published FAQ sets and is about to go live. */
  faqChoice?: ReactNode
}) {
  const t = useTranslations('clientDashboard.create.publish')
  const zone = editingZone(site.timeZone)

  return (
    <section aria-labelledby="publish-step-title">
      <StepHeading id="publish-step-title" title={t('title')} />

      <div className="mt-8">
        <PublishChoice
          id="post"
          labelledBy="publish-step-title"
          zone={zone}
          // The post's own wording ("it" = the post; drafts continue from Home).
          text={{ now: t('now'), nowHelp: t('nowHelp'), schedule: t('schedule'), draft: t('draft'), draftHelp: t('draftHelp') }}
          value={choiceValue(choice)}
          onChange={(v) => onChange({ mode: v.mode, at: v.publishAt ?? '', expire: v.expire, expireAt: v.unpublishAt ?? '' })}
        />
      </div>

      {site.languages.length > 1 ? (
        <LanguageSummary draft={draft} languages={site.languages} choice={choice} />
      ) : null}

      {faqChoice ? <div className="mt-8">{faqChoice}</div> : null}

      <p role="alert" className="mt-4 min-h-5 text-[0.9375rem] text-destructive">
        {error}
      </p>
    </section>
  )
}

/**
 * One line per choice, always visible on multilingual sites (D9):
 *   Publish now  → "Goes live in: English ✓ · German – not included"
 *   Schedule     → the same (the date is in PublishChoice's sentence)
 *   Keep draft   → "Saved in: English ✓ · Italian – started · German – not started"
 */
function LanguageSummary({
  draft,
  languages,
  choice,
}: {
  draft: StepProps['draft']
  languages: string[]
  choice: PostPublishChoice
}) {
  const t = useTranslations('clientDashboard.create.publish')
  const ui = useLocale()
  // When it goes live is said once, by PublishChoice's sentence above.
  const heading = choice.mode === 'draft' ? t('summaryDraft') : t('summaryNow')
  return (
    <div className="mt-8 rounded-2xl bg-muted px-4 py-3" aria-live="polite">
      <h2 className="text-[0.9375rem] font-semibold text-foreground">{heading}</h2>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[0.9375rem] leading-7">
        {languageStates(draft, languages).map(({ locale, state }, i) => (
          <li key={locale} className="inline-flex items-center gap-1.5">
            {i > 0 ? (
              <span aria-hidden="true" className="text-muted-foreground">
                ·
              </span>
            ) : null}
            <span className="text-foreground">{languageName(locale, ui)}</span>
            {state === 'ready' ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-success">
                  <path d="m5 12 5 5L20 7" />
                </svg>
                <span className="sr-only">{t(languageSummaryKey(state, choice.mode))}</span>
              </>
            ) : (
              <span className="text-muted-foreground">– {t(languageSummaryKey(state, choice.mode))}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
