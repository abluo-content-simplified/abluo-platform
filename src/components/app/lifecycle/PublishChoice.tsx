'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { PublicationDateField } from './PublicationDateField'
import { Switch } from '../ui/Switch'

/**
 * The publishing choice (Catalogue redesign §2.6, quick win 2.3) — one
 * component for Posts and Catalogue (later Events): Publish now · Schedule ·
 * Keep as draft. The chosen card expands IN PLACE:
 *
 *   Publish now → "Unpublish automatically" (+ Unpublish on)
 *   Schedule    → Publish on, then "Unpublish automatically" (+ Unpublish on)
 *   Keep draft  → nothing
 *
 * UI only. Each module keeps its own validation, lifecycle rules,
 * dependencies and permissions; the caller performs the choice. `children`
 * is the slot below the choices for what the module needs to say there
 * (publication blockers, "Finishing your photo…" — ADR-035).
 *
 * Dates speak UTC ISO and are entered in the SITE's zone (ADR-032 D8).
 */

export type PublishMode = 'now' | 'schedule' | 'draft'

export type PublishChoiceValue = {
  mode: PublishMode
  /** "Publish on" (schedule only). */
  publishAt: string | null
  /** "Unpublish automatically" switched on. */
  expire: boolean
  /** "Unpublish on" (used while `expire`). */
  unpublishAt: string | null
}

type TextKey = 'title' | 'now' | 'nowHelp' | 'schedule' | 'scheduleHelp' | 'draft' | 'draftHelp' | 'expire' | 'expireHelp'

export function PublishChoice({
  id,
  value,
  onChange,
  zone,
  labelledBy,
  allowExpire = true,
  text = {},
  inputClassName,
  children,
}: {
  /** Prefix for the field ids. */
  id: string
  value: PublishChoiceValue
  onChange: (next: PublishChoiceValue) => void
  /** The site's IANA time zone. */
  zone: string
  /** Id of the visible question heading; without it the group is named by `text.title`. */
  labelledBy?: string
  /** Offer "Unpublish automatically" (default true). */
  allowExpire?: boolean
  /** A module's own wording for any of the texts (defaults: `app.lifecycle.publish`). */
  text?: Partial<Record<TextKey, string>>
  inputClassName?: string
  /** Below the choices: blockers, waiting notices. */
  children?: ReactNode
}) {
  const t = useTranslations('app.lifecycle.publish')
  const tl = useTranslations('app.lifecycle.dates')
  const say = (k: TextKey) => text[k] ?? t(k)
  const set = (patch: Partial<PublishChoiceValue>) => onChange({ ...value, ...patch })
  const modes: PublishMode[] = ['now', 'schedule', 'draft']

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
              {on && mode !== 'draft' ? (
                <div className="flex flex-col gap-4 px-4 pb-4">
                  {mode === 'schedule' ? (
                    <PublicationDateField id={`${id}-publish-on`} label={tl('publishOn')} value={value.publishAt} onChange={(v) => set({ publishAt: v })} zone={zone} inputClassName={inputClassName} />
                  ) : null}
                  {allowExpire ? (
                    <div className={mode === 'schedule' ? 'border-t border-border pt-4' : ''}>
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p id={`${id}-expire-label`} className="text-[1.0625rem] font-medium text-foreground">
                            {say('expire')}
                          </p>
                          <p className="text-[0.9375rem] leading-6 text-muted-foreground">{say('expireHelp')}</p>
                        </div>
                        <Switch checked={value.expire} onChange={(expire) => set({ expire })} labelledBy={`${id}-expire-label`} />
                      </div>
                      {value.expire ? (
                        <PublicationDateField
                          id={`${id}-unpublish-on`}
                          className="mt-4"
                          label={tl('unpublishOn')}
                          value={value.unpublishAt}
                          onChange={(v) => set({ unpublishAt: v })}
                          zone={zone}
                          inputClassName={inputClassName}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
      {children}
    </div>
  )
}

/** The dates the caller should send: only what the choice actually uses. */
export function publishChoiceDates(value: PublishChoiceValue): { publishAt: string | null; expiresAt: string | null } {
  return {
    publishAt: value.mode === 'schedule' ? value.publishAt : null,
    expiresAt: value.mode !== 'draft' && value.expire ? value.unpublishAt : null,
  }
}
