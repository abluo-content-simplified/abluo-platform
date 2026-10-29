'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { PublicationDates } from './PublicationDates'
import { publishChoiceDates, shortMoment, type PublishChoiceValue, type PublishMode } from './publish-plan'
import { useDateLocale } from '@/lib/i18n/date-locale-context'

/**
 * The publishing choice (Catalogue redesign §2.6) — one component for Posts
 * and Catalogue (later Events): Publish now · Schedule · Keep as draft.
 *
 *   Publish now → nothing more to answer: it goes live when confirmed.
 *   Schedule    → From: "Now" (Change / Back to now)
 *                 Until: "No end date" (Add an end date / Change / Remove)
 *   Keep draft  → nothing
 *
 * One plain sentence under the choices says what will happen ("Goes live now
 * and stays online until 31 Oct at 18:00."). UI only: each module keeps its
 * own validation, lifecycle rules, dependencies and permissions, and sends
 * what publishChoiceDates() returns (publish-plan.ts). `children` is the slot below for what
 * the module needs to say (publication blockers, "Finishing your photo…").
 *
 * Dates speak UTC ISO and are entered in the SITE's zone (ADR-032 D8).
 */

export type { PublishMode, PublishChoiceValue } from './publish-plan'

type TextKey = 'title' | 'now' | 'nowHelp' | 'schedule' | 'scheduleHelp' | 'draft' | 'draftHelp'

export function PublishChoice({
  id,
  value,
  onChange,
  zone,
  labelledBy,
  allowExpire = true,
  text = {},
  children,
}: {
  /** Prefix for the element ids. */
  id: string
  value: PublishChoiceValue
  onChange: (next: PublishChoiceValue) => void
  /** The site's IANA time zone. */
  zone: string
  /** Id of the visible question heading; without it the group is named by `text.title`. */
  labelledBy?: string
  /** Offer "Until" under Schedule (default true). */
  allowExpire?: boolean
  /** A module's own wording for any of the texts (defaults: `app.lifecycle.publish`). */
  text?: Partial<Record<TextKey, string>>
  /** Below the choices: blockers, waiting notices. */
  children?: ReactNode
}) {
  const t = useTranslations('app.lifecycle.publish')
  const dateLocale = useDateLocale()
  const say = (k: TextKey) => text[k] ?? t(k)
  const set = (patch: Partial<PublishChoiceValue>) => onChange({ ...value, ...patch })
  const modes: PublishMode[] = ['now', 'schedule', 'draft']
  const until = allowExpire && value.expire ? value.unpublishAt : null
  const moment = (iso: string) => {
    const m = shortMoment(iso, zone, dateLocale)
    return t('moment', m)
  }

  const summary = (() => {
    const { mode, publishAt } = publishChoiceDates({ ...value, expire: allowExpire && value.expire })
    if (mode === 'draft') return t('summaryDraft')
    if (mode === 'schedule' && publishAt) return until ? t('summaryAtUntil', { start: moment(publishAt), end: moment(until) }) : t('summaryAt', { start: moment(publishAt) })
    return until ? t('summaryNowUntil', { end: moment(until) }) : t('summaryNow')
  })()

  return (
    <div>
      <div role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : say('title')} className="flex flex-col gap-3">
        {modes.map((mode) => {
          const on = value.mode === mode
          return (
            <div key={mode} className={`rounded-2xl border-2 ${on ? 'border-foreground bg-selected-tint' : 'border-border'}`}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => set({ mode })}
                className={`flex min-h-16 w-full flex-col items-start rounded-[0.875rem] px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${on ? '' : 'hover:bg-hover'}`}
              >
                <span className="text-[1.0625rem] font-semibold text-foreground">{say(mode)}</span>
                <span className="text-[0.9375rem] leading-6 text-muted-foreground">{say(`${mode}Help` as TextKey)}</span>
              </button>
              {on && mode === 'schedule' ? (
                <div className="px-4 pb-2">
                  <PublicationDates
                    id={id}
                    from={value.publishAt}
                    until={until}
                    allowUntil={allowExpire}
                    zone={zone}
                    onChange={(next) => set({ publishAt: next.from, expire: !!next.until, unpublishAt: next.until ?? value.unpublishAt })}
                  />
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <p className="mt-4 text-[0.9375rem] leading-6 font-medium text-foreground" aria-live="polite">
        {summary}
      </p>

      {children}
    </div>
  )
}
