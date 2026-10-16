'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import { languageStates, languageSummaryKey } from '@/lib/client/wizard-steps'
import { PublishChoice } from '@/components/app/lifecycle/PublishChoice'
import { editingZone, formatInZone, fromLocalInput, toLocalInput } from '@/components/app/lifecycle/zoned-time'

export type PublishMode = 'now' | 'schedule' | 'draft'
export type PublishChoice = {
  mode: PublishMode
  /** "Publish on" — UTC ISO ('' = not chosen). Entered in the site's time zone (ADR-032 D8). */
  at: string
  expire: boolean
  /** "Unpublish on" — UTC ISO ('' = not chosen). */
  expireAt: string
}

/** A UTC ISO value, or null when empty/invalid. */
export function choiceIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** The default choice: publish now; "Publish on" tomorrow 09:00 and "Unpublish on" 30 days later, both in the site's zone. */
export function defaultPublishChoice(zone: string, now = new Date()): PublishChoice {
  const today = toLocalInput(now.toISOString(), zone).slice(0, 10)
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 24 * 3600 * 1000).toISOString().slice(0, 10)
  const at = fromLocalInput(`${tomorrow}T09:00`, zone)?.utc ?? ''
  const later = at ? new Date(Date.parse(at) + 30 * 24 * 3600 * 1000).toISOString() : ''
  return { mode: 'now', at, expire: false, expireAt: later }
}

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
}: StepProps & { choice: PublishChoice; onChange: (c: PublishChoice) => void; error: string | null }) {
  const t = useTranslations('clientDashboard.create.publish')
  const zone = editingZone(site.timeZone)
  const inputClass =
    'mt-2 block min-h-[var(--control-height,56px)] w-full rounded-xl border border-border bg-background px-4 text-[1.0625rem] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

  return (
    <section aria-labelledby="publish-step-title">
      <StepHeading id="publish-step-title" title={t('title')} />

      <div className="mt-8">
        <PublishChoice
          id="post"
          labelledBy="publish-step-title"
          zone={zone}
          inputClassName={inputClass}
          // The post's own wording ("it" = the post; drafts continue from Home).
          text={{ now: t('now'), nowHelp: t('nowHelp'), schedule: t('schedule'), scheduleHelp: t('scheduleHelp'), draft: t('draft'), draftHelp: t('draftHelp'), expire: t('expire'), expireHelp: t('expireHelp') }}
          value={{ mode: choice.mode, publishAt: choice.at || null, expire: choice.expire, unpublishAt: choice.expireAt || null }}
          onChange={(v) => onChange({ mode: v.mode, at: v.publishAt ?? '', expire: v.expire, expireAt: v.unpublishAt ?? '' })}
        />
      </div>

      {site.languages.length > 1 ? (
        <LanguageSummary draft={draft} languages={site.languages} choice={choice} zone={zone} />
      ) : null}

      <p role="alert" className="mt-4 min-h-5 text-[0.9375rem] text-destructive">
        {error}
      </p>
    </section>
  )
}

/**
 * One line per choice, always visible on multilingual sites (D9):
 *   Publish now  → "Goes live in: English ✓ · German – not included"
 *   Schedule     → "Goes live on <date> in: …"
 *   Keep draft   → "Saved in: English ✓ · Italian – started · German – not started"
 */
function LanguageSummary({
  draft,
  languages,
  choice,
  zone,
}: {
  draft: StepProps['draft']
  languages: string[]
  choice: PublishChoice
  zone: string
}) {
  const t = useTranslations('clientDashboard.create.publish')
  const ui = useLocale()
  const at = choice.mode === 'schedule' ? choiceIso(choice.at) : null
  const heading =
    choice.mode === 'draft'
      ? t('summaryDraft')
      : choice.mode === 'schedule' && at
        ? t('summarySchedule', {
            date: formatInZone(at, zone, ui),
          })
        : t('summaryNow')
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
