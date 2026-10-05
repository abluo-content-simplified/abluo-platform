'use client'

import { useLocale, useTranslations } from 'next-intl'
import type { StepProps } from '@/components/client/create/types'
import { StepHeading, languageName } from '@/components/client/create/StepHeading'
import { languageStates, languageSummaryKey } from '@/lib/client/wizard-steps'

export type PublishMode = 'now' | 'schedule' | 'draft'
export type PublishChoice = {
  mode: PublishMode
  /** `datetime-local` value, in the viewer's time zone. */
  at: string
  expire: boolean
  expireAt: string
}

/** `datetime-local` value (viewer's time zone) → ISO-8601 UTC, or null when empty/invalid. */
export function localToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

/** A Date → `datetime-local` value in the viewer's time zone. */
export function isoToLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * "What do you want to do with it?" — Publish now / Schedule / Keep as draft,
 * plus "Take offline automatically". The shell's main button performs the
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
  const zone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return ''
    }
  })()
  const set = (patch: Partial<PublishChoice>) => onChange({ ...choice, ...patch })
  const options: { mode: PublishMode; label: string; help: string }[] = [
    { mode: 'now', label: t('now'), help: t('nowHelp') },
    { mode: 'schedule', label: t('schedule'), help: t('scheduleHelp') },
    { mode: 'draft', label: t('draft'), help: t('draftHelp') },
  ]
  const inputClass =
    'mt-2 block min-h-[var(--control-height,56px)] w-full rounded-xl border border-border bg-background px-4 text-[17px] text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

  return (
    <section aria-labelledby="publish-step-title">
      <StepHeading id="publish-step-title" title={t('title')} />

      <div role="radiogroup" aria-labelledby="publish-step-title" className="mt-8 flex flex-col gap-3">
        {options.map((o) => {
          const on = choice.mode === o.mode
          return (
            <button
              key={o.mode}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => set({ mode: o.mode })}
              className={`flex min-h-16 w-full flex-col items-start rounded-2xl border-2 px-4 py-3 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                on ? 'border-foreground bg-selected-tint' : 'border-border hover:bg-hover'
              }`}
            >
              <span className="text-[17px] font-semibold text-foreground">{o.label}</span>
              <span className="text-[15px] leading-6 text-muted-foreground">{o.help}</span>
            </button>
          )
        })}
      </div>

      {choice.mode === 'schedule' ? (
        <div className="mt-6">
          <label htmlFor="publish-at" className="text-[15px] font-medium text-foreground">
            {t('when')}
          </label>
          <input id="publish-at" type="datetime-local" value={choice.at} onChange={(e) => set({ at: e.target.value })} className={inputClass} />
        </div>
      ) : null}

      {choice.mode !== 'draft' ? (
        <div className="mt-6 rounded-2xl border border-border p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p id="expire-label" className="text-[17px] font-medium text-foreground">
                {t('expire')}
              </p>
              <p className="text-[15px] leading-6 text-muted-foreground">{t('expireHelp')}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={choice.expire}
              aria-labelledby="expire-label"
              onClick={() => set({ expire: !choice.expire })}
              className={`relative inline-flex h-11 w-[72px] shrink-0 items-center rounded-full p-1 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                choice.expire ? 'bg-action' : 'bg-muted'
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-9 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none ${choice.expire ? 'translate-x-[28px]' : ''}`}
              />
            </button>
          </div>
          {choice.expire ? (
            <div className="mt-4">
              <label htmlFor="expire-at" className="text-[15px] font-medium text-foreground">
                {t('expireWhen')}
              </label>
              <input id="expire-at" type="datetime-local" value={choice.expireAt} onChange={(e) => set({ expireAt: e.target.value })} className={inputClass} />
            </div>
          ) : null}
        </div>
      ) : null}

      {choice.mode !== 'now' || choice.expire ? (
        <p className="mt-3 text-sm text-muted-foreground">{t('timezone', { zone })}</p>
      ) : null}

      {site.languages.length > 1 ? (
        <LanguageSummary draft={draft} languages={site.languages} choice={choice} />
      ) : null}

      <p role="alert" className="mt-4 min-h-5 text-[15px] text-destructive">
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
}: {
  draft: StepProps['draft']
  languages: string[]
  choice: PublishChoice
}) {
  const t = useTranslations('clientDashboard.create.publish')
  const ui = useLocale()
  const at = choice.mode === 'schedule' ? localToIso(choice.at) : null
  const heading =
    choice.mode === 'draft'
      ? t('summaryDraft')
      : choice.mode === 'schedule' && at
        ? t('summarySchedule', {
            date: new Intl.DateTimeFormat(ui, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(at)),
          })
        : t('summaryNow')
  return (
    <div className="mt-8 rounded-2xl bg-muted px-4 py-3" aria-live="polite">
      <h2 className="text-[15px] font-semibold text-foreground">{heading}</h2>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[15px] leading-7">
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
