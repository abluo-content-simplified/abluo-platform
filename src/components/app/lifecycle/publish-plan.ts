/**
 * The publishing choice, minus React (PublishChoice draws it): its value, what
 * the caller sends (publishChoiceDates) and the short moment the sentence uses.
 */

export type PublishMode = 'now' | 'schedule' | 'draft'

export type PublishChoiceValue = {
  mode: PublishMode
  /** Schedule "From"; null = now. */
  publishAt: string | null
  /** Schedule has an "Until". */
  expire: boolean
  /** Schedule "Until" (used while `expire`). */
  unpublishAt: string | null
}

/** "3 Nov at 9:00" (year added when it is not this year), in `zone`. */
export function shortMoment(iso: string, zone: string, locale: string, now = new Date()): { date: string; time: string } {
  const d = new Date(iso)
  const year = (x: Date) => new Intl.DateTimeFormat('en', { year: 'numeric', timeZone: zone }).format(x)
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(year(d) !== year(now) && { year: 'numeric' }), timeZone: zone }).format(d)
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone: zone }).format(d)
  return { date, time }
}

/**
 * What the caller should send: the mode the server needs and only the dates
 * the choice uses. Schedule with From = now is a plain "now" (with its Until).
 */
export function publishChoiceDates(value: PublishChoiceValue): { mode: PublishMode; publishAt: string | null; expiresAt: string | null } {
  if (value.mode === 'draft') return { mode: 'draft', publishAt: null, expiresAt: null }
  if (value.mode === 'now') return { mode: 'now', publishAt: null, expiresAt: null }
  const expiresAt = value.expire ? value.unpublishAt : null
  return value.publishAt ? { mode: 'schedule', publishAt: value.publishAt, expiresAt } : { mode: 'now', publishAt: null, expiresAt }
}
