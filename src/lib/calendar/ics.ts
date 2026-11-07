// ── Calendar files (RFC 5545) and "Add to Google Calendar" links ─────────────
//
// Pure and client-safe: no Next.js, no I/O. Three layers, all plain strings in/out:
//
//   escapeIcsText / foldIcsLine   the two wire rules (escaping, 75-octet folding, CRLF)
//   buildIcs(event, opts)         a VCALENDAR with ONE VEVENT
//   googleCalendarUrl(event)      https://calendar.google.com/calendar/render?action=TEMPLATE…
//
// Times:
//   - one date: UTC instants (`…Z`) — every client imports them identically;
//   - a repeating class: TZID + an embedded VTIMEZONE, because "18:00 every Monday" must stay 18:00
//     across daylight saving (UTC times would drift by an hour). The VTIMEZONE lists the real
//     transitions of the zone for the years the class covers (explicit observances, no RRULE).
//   - a site without a time zone: floating local times (no Z, no TZID).
//
// PRIVACY: an event carries only what the caller puts in `IcsEvent` — title, place, free text. There is
// no field for meeting ids, passcodes or join links, and the callers never read them (forwarded files
// must not leak them).

import { localToUtc, zoneOffsetMinutes } from '@/lib/lifecycle/time'

export type IcsRecurrence = {
  /** RRULE text without the "RRULE:" prefix and without UNTIL (e.g. 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO'). */
  rule: string
  /** 'YYYY-MM-DDTHH:mm' start (local time) of the LAST session wanted; the rule stops there. Null = open-ended. */
  lastStartLocal?: string | null
  /** 'YYYY-MM-DD' dates skipped (cancelled sessions, holidays); they fall at the event's start time. */
  excludeDates?: string[]
}

export type IcsEvent = {
  /** Stable per session; becomes `<uid>@<host>` after sanitising. */
  uid: string
  host: string
  title: string
  /** Local 'YYYY-MM-DDTHH:mm' in `timeZone`. */
  startLocal: string
  /** Local end; null = one hour after the start. */
  endLocal: string | null
  /** IANA zone; null = floating local time. */
  timeZone: string | null
  location?: string | null
  description?: string | null
  url?: string | null
  recurrence?: IcsRecurrence | null
}

const CRLF = '\r\n'
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const MAX_VTIMEZONE_YEARS = 20

// ── Wire rules ───────────────────────────────────────────────────────────────

/** TEXT escaping: backslash, semicolon, comma, newlines; control characters dropped. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
}

const encoder = new TextEncoder()

/** Folds one content line at 75 octets (UTF-8), never inside a character; continuation lines start with one space. No trailing CRLF. */
export function foldIcsLine(line: string): string {
  if (encoder.encode(line).length <= 75) return line
  const out: string[] = []
  let current = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const n = encoder.encode(ch).length
    if (bytes + n > limit) {
      out.push(current)
      current = ' '
      bytes = 1
      limit = 75
    }
    current += ch
    bytes += n
  }
  out.push(current)
  return out.join(CRLF)
}

const prop = (name: string, value: string) => `${name}:${value}`
const textProp = (name: string, value: string) => prop(name, escapeIcsText(value))

/** A UID part safe for the wire: letters, digits, '.', '_', '-'. */
const uidPart = (v: string) => v.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'x'

// ── Date helpers ─────────────────────────────────────────────────────────────

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** 'YYYY-MM-DDTHH:mm' → 'YYYYMMDDTHHMM00'. Null when malformed. */
function basicLocal(local: string): string | null {
  const m = LOCAL.exec(local)
  return m ? `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}00` : null
}

/** An ISO instant → 'YYYYMMDDTHHMMSSZ'. */
export function basicUtc(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
}

/** Local 'YYYY-MM-DDTHH:mm' plus minutes (wall-clock arithmetic, no zone). */
function addMinutesLocal(local: string, minutes: number): string {
  const m = LOCAL.exec(local)
  if (!m) return local
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5] + minutes))
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}

export type SessionInstants = { start: Date; end: Date; endLocal: string }

/** UTC instants of a session (end defaults to start + 1 hour; an end not after the start also falls back to it). Null when the start is not a real local time or the zone is unusable. */
export function sessionInstants(startLocal: string, endLocal: string | null, timeZone: string): SessionInstants | null {
  try {
    const start = new Date(localToUtc(startLocal, timeZone).utc)
    let endL = endLocal && LOCAL.test(endLocal) ? endLocal : addMinutesLocal(startLocal, 60)
    let end = new Date(localToUtc(endL, timeZone).utc)
    if (!(end.getTime() > start.getTime())) {
      endL = addMinutesLocal(startLocal, 60)
      end = new Date(localToUtc(endL, timeZone).utc)
    }
    return { start, end, endLocal: endL }
  } catch {
    return null
  }
}

// ── VTIMEZONE ────────────────────────────────────────────────────────────────

const offsetText = (minutes: number) => {
  const a = Math.abs(minutes)
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(a / 60))}${pad(a % 60)}`
}

/**
 * An embedded VTIMEZONE for `timeZone` covering `fromYear`..`toYear`: an initial observance and one
 * observance per offset change (found by scanning the zone, to the minute). Invalid zone → null.
 */
export function buildVtimezone(timeZone: string, fromYear: number, toYear: number): string[] | null {
  try {
    const start = Date.UTC(fromYear, 0, 1)
    const end = Date.UTC(toYear + 1, 0, 1)
    const STEP = 2 * 86_400_000 // transitions are weeks apart; a 2-day step finds each, the search below finds its minute
    const first = zoneOffsetMinutes(start, timeZone)
    const lines = ['BEGIN:VTIMEZONE', `TZID:${timeZone}`]
    // The initial observance: valid from long before the first date.
    lines.push('BEGIN:STANDARD', 'DTSTART:19700101T000000', `TZOFFSETFROM:${offsetText(first)}`, `TZOFFSETTO:${offsetText(first)}`, 'END:STANDARD')
    let prev = first
    for (let t = start; t < end; t += STEP) {
      const next = zoneOffsetMinutes(t + STEP, timeZone)
      if (next === prev) continue
      // Binary search the minute of the change inside (t, t + STEP].
      let lo = t
      let hi = t + STEP
      while (hi - lo > 60_000) {
        const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000
        if (zoneOffsetMinutes(mid, timeZone) === prev) lo = mid
        else hi = mid
      }
      const wall = new Date(hi + prev * 60_000) // the wall clock just before the change, in the OLD offset
      const local = `${pad(wall.getUTCFullYear(), 4)}${pad(wall.getUTCMonth() + 1)}${pad(wall.getUTCDate())}T${pad(wall.getUTCHours())}${pad(wall.getUTCMinutes())}00`
      const kind = next > prev ? 'DAYLIGHT' : 'STANDARD'
      lines.push(`BEGIN:${kind}`, `DTSTART:${local}`, `TZOFFSETFROM:${offsetText(prev)}`, `TZOFFSETTO:${offsetText(next)}`, `END:${kind}`)
      prev = next
    }
    lines.push('END:VTIMEZONE')
    return lines
  } catch {
    return null
  }
}

// ── The calendar ─────────────────────────────────────────────────────────────

export type BuildIcsOptions = { now?: Date; productId?: string }

/** A complete VCALENDAR (CRLF line ends, folded lines) with one VEVENT, or null when the event's times are unusable. */
export function buildIcs(event: IcsEvent, options: BuildIcsOptions = {}): string | null {
  const now = options.now ?? new Date()
  const zone = event.timeZone
  const rec = event.recurrence ?? null
  const startBasic = basicLocal(event.startLocal)
  if (!startBasic) return null
  const lines: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${options.productId ?? '-//Abluo//Timetable//EN'}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH']

  let dtStart: string
  let dtEnd: string
  let dateTime: (local: string) => string | null
  let until: string | null = null

  if (!zone) {
    // Floating local times.
    const endL = event.endLocal && LOCAL.test(event.endLocal) && event.endLocal > event.startLocal ? event.endLocal : addMinutesLocal(event.startLocal, 60)
    dtStart = prop('DTSTART', startBasic)
    dtEnd = prop('DTEND', basicLocal(endL) as string)
    dateTime = (local) => basicLocal(local)
    if (rec?.lastStartLocal) until = basicLocal(rec.lastStartLocal)
  } else if (rec) {
    const inst = sessionInstants(event.startLocal, event.endLocal, zone)
    if (!inst) return null
    const y0 = +event.startLocal.slice(0, 4)
    const lastYear = rec.lastStartLocal ? +rec.lastStartLocal.slice(0, 4) : y0 + MAX_VTIMEZONE_YEARS - 1
    const tz = buildVtimezone(zone, y0, Math.min(Math.max(lastYear, y0), y0 + MAX_VTIMEZONE_YEARS - 1))
    if (!tz) return null
    lines.push(...tz)
    dtStart = `DTSTART;TZID=${zone}:${startBasic}`
    dtEnd = `DTEND;TZID=${zone}:${basicLocal(inst.endLocal)}`
    dateTime = (local) => {
      const b = basicLocal(local)
      return b ? `${b}` : null
    }
    if (rec.lastStartLocal) {
      try {
        until = basicUtc(localToUtc(rec.lastStartLocal, zone).utc)
      } catch {
        until = null
      }
    }
  } else {
    const inst = sessionInstants(event.startLocal, event.endLocal, zone)
    if (!inst) return null
    dtStart = prop('DTSTART', basicUtc(inst.start))
    dtEnd = prop('DTEND', basicUtc(inst.end))
    dateTime = () => null
  }

  const v: string[] = ['BEGIN:VEVENT', prop('UID', `${uidPart(event.uid)}@${uidPart(event.host)}`), prop('DTSTAMP', basicUtc(now)), dtStart, dtEnd]
  if (rec) {
    v.push(prop('RRULE', rec.rule + (until ? `;UNTIL=${until}` : '')))
    const time = event.startLocal.slice(10) // 'THH:mm'
    const ex = [...new Set(rec.excludeDates ?? [])]
      .sort()
      .map((d) => dateTime(`${d}${time}`))
      .filter((x): x is string => !!x)
    if (ex.length) v.push(zone ? `EXDATE;TZID=${zone}:${ex.join(',')}` : `EXDATE:${ex.join(',')}`)
  }
  v.push(textProp('SUMMARY', event.title))
  if (event.location?.trim()) v.push(textProp('LOCATION', event.location.trim()))
  if (event.description?.trim()) v.push(textProp('DESCRIPTION', event.description.trim()))
  if (event.url && /^https?:\/\//i.test(event.url)) v.push(prop('URL', event.url.replace(/[\r\n\s]/g, '')))
  v.push('STATUS:CONFIRMED', 'TRANSP:OPAQUE', 'END:VEVENT')
  lines.push(...v, 'END:VCALENDAR')
  return lines.map(foldIcsLine).join(CRLF) + CRLF
}

// ── Google Calendar ──────────────────────────────────────────────────────────

/**
 * The "add to Google Calendar" link: Google's own event form (nothing is created until the person saves it).
 *   - one session: UTC instants when the zone is known, otherwise floating local times;
 *   - a repeating class (event.recurrence + a zone): local times with `ctz` (so 18:00 stays 18:00 across DST)
 *     and `recur=RRULE:…`. Holidays / cancelled dates (EXDATE) are not passed: Google's link does not take
 *     them reliably — the .ics file carries them.
 * Null when the start is unusable.
 */
export function googleCalendarUrl(event: Pick<IcsEvent, 'title' | 'startLocal' | 'endLocal' | 'timeZone' | 'location' | 'description' | 'recurrence'>): string | null {
  const zone = event.timeZone
  const rec = event.recurrence ?? null
  const q = new URLSearchParams({ action: 'TEMPLATE', text: event.title })
  if (zone && rec) {
    const inst = sessionInstants(event.startLocal, event.endLocal, zone)
    const s = basicLocal(event.startLocal)
    const e = inst ? basicLocal(inst.endLocal) : null
    if (!inst || !s || !e) return null
    q.set('dates', `${s}/${e}`)
    q.set('ctz', zone)
    let until = ''
    if (rec.lastStartLocal) {
      try {
        until = `;UNTIL=${basicUtc(localToUtc(rec.lastStartLocal, zone).utc)}`
      } catch {
        until = ''
      }
    }
    q.set('recur', `RRULE:${rec.rule}${until}`)
  } else if (zone) {
    const inst = sessionInstants(event.startLocal, event.endLocal, zone)
    if (!inst) return null
    q.set('dates', `${basicUtc(inst.start)}/${basicUtc(inst.end)}`)
  } else {
    const s = basicLocal(event.startLocal)
    if (!s) return null
    const endL = event.endLocal && LOCAL.test(event.endLocal) && event.endLocal > event.startLocal ? event.endLocal : addMinutesLocal(event.startLocal, 60)
    q.set('dates', `${s}/${basicLocal(endL)}`)
    if (rec) q.set('recur', `RRULE:${rec.rule}${rec.lastStartLocal ? `;UNTIL=${basicLocal(rec.lastStartLocal)}` : ''}`)
  }
  if (event.description?.trim()) q.set('details', event.description.trim())
  if (event.location?.trim()) q.set('location', event.location.trim())
  return `https://calendar.google.com/calendar/render?${q.toString().replace(/\+/g, '%20')}`
}
