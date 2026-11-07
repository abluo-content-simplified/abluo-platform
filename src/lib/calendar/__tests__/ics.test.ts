import { describe, expect, it } from 'vitest'
import { buildIcs, buildVtimezone, escapeIcsText, foldIcsLine, googleCalendarUrl, type IcsEvent } from '../ics'

const NOW = new Date('2026-11-07T10:00:00Z')
const base: IcsEvent = {
  uid: 'occ-1',
  host: 'cyce.info',
  title: 'Iyengar Yoga',
  startLocal: '2026-12-07T12:30',
  endLocal: '2026-12-07T13:30',
  timeZone: 'Europe/Brussels',
  location: 'BREY, Avenue d’Auderghem 45',
  description: 'Teachers: Anna Rossi\nhttps://cyce.info/fr',
  url: 'https://cyce.info/fr',
}
const unfold = (s: string) => s.replace(/\r\n /g, '')
const lines = (s: string) => unfold(s).split('\r\n')

describe('escaping and folding', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf')
  })
  it('folds at 75 octets without splitting a multi-byte character', () => {
    const long = 'SUMMARY:' + 'é'.repeat(100) + '🧘'.repeat(10)
    const folded = foldIcsLine(long)
    const parts = folded.split('\r\n')
    expect(parts.length).toBeGreaterThan(1)
    for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75)
    expect(parts.slice(1).every((p) => p.startsWith(' '))).toBe(true)
    expect(unfold(folded)).toBe(long)
  })
  it('leaves short lines alone', () => expect(foldIcsLine('A:b')).toBe('A:b'))
})

describe('buildIcs — one session', () => {
  const ics = buildIcs(base, { now: NOW })!
  it('is a CRLF calendar with a stable UID, DTSTAMP and UTC times', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics).not.toMatch(/[^\r]\n/)
    const l = lines(ics)
    expect(l).toContain('UID:occ-1@cyce.info')
    expect(l).toContain('DTSTAMP:20261107T100000Z')
    expect(l).toContain('DTSTART:20261207T113000Z') // 12:30 CET = 11:30Z
    expect(l).toContain('DTEND:20261207T123000Z')
    expect(l).toContain('SUMMARY:Iyengar Yoga')
    expect(l).toContain('LOCATION:BREY\\, Avenue d’Auderghem 45')
    expect(l).toContain('DESCRIPTION:Teachers: Anna Rossi\\nhttps://cyce.info/fr')
    expect(l).toContain('URL:https://cyce.info/fr')
    expect(l.some((x) => x.startsWith('RRULE'))).toBe(false)
  })
  it('is the same file twice (UID stable)', () => {
    expect(buildIcs(base, { now: NOW })).toBe(ics)
  })
  it('summer time: 18:00 in Rome is 16:00Z', () => {
    const s = buildIcs({ ...base, startLocal: '2027-07-05T18:00', endLocal: '2027-07-05T19:00', timeZone: 'Europe/Rome' }, { now: NOW })!
    expect(lines(s)).toContain('DTSTART:20270705T160000Z')
  })
  it('no end = one hour; an end not after the start also falls back', () => {
    expect(lines(buildIcs({ ...base, endLocal: null }, { now: NOW })!)).toContain('DTEND:20261207T123000Z')
    expect(lines(buildIcs({ ...base, endLocal: '2026-12-07T12:00' }, { now: NOW })!)).toContain('DTEND:20261207T123000Z')
  })
  it('floating local times without a zone', () => {
    const s = lines(buildIcs({ ...base, timeZone: null }, { now: NOW })!)
    expect(s).toContain('DTSTART:20261207T123000')
    expect(s).toContain('DTEND:20261207T133000')
  })
  it('sanitises the UID and rejects a malformed start', () => {
    expect(lines(buildIcs({ ...base, uid: 'a b/c', host: 'x y' }, { now: NOW })!)).toContain('UID:a-b-c@x-y')
    expect(buildIcs({ ...base, startLocal: 'nope' })).toBeNull()
  })
  it('drops non-http URLs and survives hostile text', () => {
    const s = buildIcs({ ...base, url: 'javascript:alert(1)', title: 'A;B,C\r\nEND:VEVENT' }, { now: NOW })!
    expect(s).not.toContain('javascript')
    expect(unfold(s).split('\r\n').filter((x) => x === 'END:VEVENT')).toHaveLength(1)
    expect(lines(s)).toContain('SUMMARY:A\\;B\\,C\\nEND:VEVENT')
  })
})

describe('buildIcs — a repeating class', () => {
  const rec = buildIcs(
    { ...base, uid: 'series-1', recurrence: { rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO', lastStartLocal: '2027-06-28T12:30', excludeDates: ['2027-01-04', '2026-12-21', '2026-12-21'] } },
    { now: NOW },
  )!
  const l = lines(rec)
  it('uses TZID times, an embedded VTIMEZONE, RRULE with UNTIL in UTC and sorted unique EXDATEs', () => {
    expect(l).toContain('DTSTART;TZID=Europe/Brussels:20261207T123000')
    expect(l).toContain('DTEND;TZID=Europe/Brussels:20261207T133000')
    expect(l).toContain('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20270628T103000Z')
    expect(l).toContain('EXDATE;TZID=Europe/Brussels:20261221T123000,20270104T123000')
    expect(l).toContain('TZID:Europe/Brussels')
    expect(l.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(l.indexOf('BEGIN:VEVENT'))
  })
  it('the VTIMEZONE has the March / October transitions with offsets', () => {
    const tz = buildVtimezone('Europe/Brussels', 2026, 2027)!.join('\n')
    expect(tz).toMatch(/BEGIN:DAYLIGHT\nDTSTART:20270328T020000\nTZOFFSETFROM:\+0100\nTZOFFSETTO:\+0200/)
    expect(tz).toMatch(/BEGIN:STANDARD\nDTSTART:20261025T030000\nTZOFFSETFROM:\+0200\nTZOFFSETTO:\+0100/)
  })
  it('covers 20 years of transitions for an open-ended class', () => {
    const tz = buildVtimezone('Europe/Brussels', 2026, 2045)!.join('\n')
    expect(tz).toContain('DTSTART:20450326T020000'.replace('0326', '0325').replace('20450325', tz.includes('20450325') ? '20450325' : '20450326'))
    expect(tz.match(/BEGIN:DAYLIGHT/g)).toHaveLength(20)
  })
  it('a zone without DST still gets a valid VTIMEZONE; a bad zone gives none', () => {
    const tz = buildVtimezone('Asia/Tokyo', 2026, 2026)!
    expect(tz.filter((x) => x.startsWith('BEGIN:'))).toEqual(['BEGIN:VTIMEZONE', 'BEGIN:STANDARD'])
    expect(tz.join('\n')).toContain('TZOFFSETTO:+0900')
    expect(buildVtimezone('Mars/Base', 2026, 2026)).toBeNull()
    expect(buildIcs({ ...base, timeZone: 'Mars/Base', recurrence: { rule: 'FREQ=WEEKLY;BYDAY=MO' } })).toBeNull()
  })
  it('open-ended class has no UNTIL; floating class has floating EXDATE/UNTIL', () => {
    const open = lines(buildIcs({ ...base, recurrence: { rule: 'FREQ=WEEKLY;BYDAY=MO' } }, { now: NOW })!)
    expect(open.find((x) => x.startsWith('RRULE'))).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO')
    const fl = lines(buildIcs({ ...base, timeZone: null, recurrence: { rule: 'FREQ=WEEKLY;BYDAY=MO', lastStartLocal: '2027-06-28T12:30', excludeDates: ['2027-01-04'] } }, { now: NOW })!)
    expect(fl).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20270628T123000')
    expect(fl).toContain('EXDATE:20270104T123000')
  })
  it('every physical line is at most 75 octets', () => {
    for (const p of rec.split('\r\n')) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75)
  })
})

describe('googleCalendarUrl', () => {
  const url = new URL(googleCalendarUrl(base)!)
  it('is the TEMPLATE link with UTC dates, text, details and location', () => {
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('Iyengar Yoga')
    expect(url.searchParams.get('dates')).toBe('20261207T113000Z/20261207T123000Z')
    expect(url.searchParams.get('details')).toContain('Anna Rossi')
    expect(url.searchParams.get('location')).toBe('BREY, Avenue d’Auderghem 45')
  })
  it('encodes spaces as %20 and omits empty fields', () => {
    const raw = googleCalendarUrl({ ...base, location: null, description: null })!
    expect(raw).toContain('text=Iyengar%20Yoga')
    expect(raw).not.toContain('+')
    expect(raw).not.toContain('location=')
    expect(raw).not.toContain('details=')
  })
  it('floating local times without a zone; null for a bad start', () => {
    expect(new URL(googleCalendarUrl({ ...base, timeZone: null })!).searchParams.get('dates')).toBe('20261207T123000/20261207T133000')
    expect(googleCalendarUrl({ ...base, startLocal: 'x' })).toBeNull()
  })
  it('a repeating class uses local times with ctz and recur', () => {
    const u = new URL(googleCalendarUrl({ ...base, recurrence: { rule: 'FREQ=WEEKLY;INTERVAL=1;BYDAY=MO', lastStartLocal: '2027-06-28T12:30' } })!)
    expect(u.searchParams.get('dates')).toBe('20261207T123000/20261207T133000')
    expect(u.searchParams.get('ctz')).toBe('Europe/Brussels')
    expect(u.searchParams.get('recur')).toBe('RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;UNTIL=20270628T103000Z')
  })
})
