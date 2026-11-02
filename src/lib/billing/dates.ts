/**
 * Calendar-date helpers for billing — PURE. Dates agreed with clients are
 * Italian calendar days, so day boundaries are Europe/Rome (DST-aware).
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 86_400_000

/** A real calendar date written YYYY-MM-DD ("2026-02-31" is not one). */
export function isIsoDate(s: string): boolean {
  if (!ISO_DATE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

const romeFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
})

/** Offset of Europe/Rome from UTC at an instant, in ms (+1 h winter, +2 h summer). */
function romeOffsetMs(at: Date): number {
  const p = Object.fromEntries(romeFormat.formatToParts(at).map((x) => [x.type, x.value]))
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second))
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** `YYYY-MM-DD` → the instant that calendar day starts in Europe/Rome (00:00 local); null if not a valid date. */
export function romeDayStart(isoDate: string): Date | null {
  if (!isIsoDate(isoDate)) return null
  const utcMidnight = new Date(`${isoDate}T00:00:00Z`)
  let candidate = new Date(utcMidnight.getTime() - romeOffsetMs(utcMidnight))
  candidate = new Date(utcMidnight.getTime() - romeOffsetMs(candidate))
  return candidate
}

/** `YYYY-MM-DD` → the start of the NEXT calendar day in Europe/Rome (= the end of that day); null if invalid. */
export function romeDayEnd(isoDate: string): Date | null {
  if (!isIsoDate(isoDate)) return null
  return romeDayStart(new Date(Date.parse(`${isoDate}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10))
}
