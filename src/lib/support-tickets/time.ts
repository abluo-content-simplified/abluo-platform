/**
 * "Last update" wording for support tickets (admin and client): date AND time
 * in the viewer's own time zone — "Today, 10:42", "Yesterday, 16:05",
 * "21 Oct, 16:05" (with the year when it is not this year). Pure and
 * client-safe: the caller passes the locale, the translated "Today" /
 * "Yesterday" and (for tests) `now` and `timeZone`. Without `timeZone` the
 * runtime's own zone is used — the browser's, which is what we want.
 */
export type LastUpdateLabels = { today: string; yesterday: string }

export type LastUpdateOptions = {
  locale: string
  labels: LastUpdateLabels
  now?: Date
  timeZone?: string
}

function make(locale: string, options: Intl.DateTimeFormatOptions, timeZone?: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone })
  } catch {
    return new Intl.DateTimeFormat('en', { ...options, timeZone: undefined })
  }
}

/** Calendar day of `d` in the zone, as a number comparable by whole days (UTC midnight of that y-m-d). */
function dayNumber(d: Date, timeZone?: string): number {
  const parts = make('en-US', { year: 'numeric', month: 'numeric', day: 'numeric' }, timeZone).formatToParts(d)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return Date.UTC(get('year'), get('month') - 1, get('day')) / 86_400_000
}

/** Returns '' for a missing or invalid date. */
export function formatLastUpdate(iso: string | null | undefined, { locale, labels, now = new Date(), timeZone }: LastUpdateOptions): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const time = make(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, timeZone).format(d)
  const diff = dayNumber(now, timeZone) - dayNumber(d, timeZone)
  if (diff === 0) return `${labels.today}, ${time}`
  if (diff === 1) return `${labels.yesterday}, ${time}`
  const sameYear = make('en-US', { year: 'numeric' }, timeZone).format(d) === make('en-US', { year: 'numeric' }, timeZone).format(now)
  const date = make(locale, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }, timeZone).format(d)
  return `${date}, ${time}`
}
