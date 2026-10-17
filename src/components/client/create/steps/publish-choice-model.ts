import type { PublishChoiceValue } from '@/components/app/lifecycle/publish-plan'

/** The post wizard's publishing choice (pure, so it is unit-tested). Dates are UTC ISO, '' = not chosen. */
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

/** The default choice: publish now; a schedule starts "From: Now" with no end date. */
export function defaultPublishChoice(): PublishChoice {
  return { mode: 'now', at: '', expire: false, expireAt: '' }
}

/** The shared component's value for a post choice. */
export function choiceValue(choice: PublishChoice): PublishChoiceValue {
  return { mode: choice.mode, publishAt: choiceIso(choice.at), expire: choice.expire, unpublishAt: choiceIso(choice.expireAt) }
}
