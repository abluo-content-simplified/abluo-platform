import { describe, expect, it } from 'vitest'
import { datesSentence, publishChoiceDates, shortMoment } from '../publish-plan'
import { timeSteps } from '@/lib/client/date-range'

describe('publishChoiceDates — the mode and only the dates the choice uses', () => {
  const at = '2026-11-03T08:00:00.000Z'
  const end = '2026-11-30T17:00:00.000Z'
  it('Publish now asks nothing more: no dates are sent', () => {
    expect(publishChoiceDates({ mode: 'now', publishAt: at, expire: true, unpublishAt: end })).toEqual({ mode: 'now', publishAt: null, expiresAt: null })
  })
  it('Schedule from a date, with or without an end', () => {
    expect(publishChoiceDates({ mode: 'schedule', publishAt: at, expire: true, unpublishAt: end })).toEqual({ mode: 'schedule', publishAt: at, expiresAt: end })
    expect(publishChoiceDates({ mode: 'schedule', publishAt: at, expire: false, unpublishAt: end })).toEqual({ mode: 'schedule', publishAt: at, expiresAt: null })
  })
  it('Schedule from "Now" is a plain publish that keeps its end date', () => {
    expect(publishChoiceDates({ mode: 'schedule', publishAt: null, expire: true, unpublishAt: end })).toEqual({ mode: 'now', publishAt: null, expiresAt: end })
    expect(publishChoiceDates({ mode: 'schedule', publishAt: null, expire: false, unpublishAt: end })).toEqual({ mode: 'now', publishAt: null, expiresAt: null })
  })
  it('Keep as draft sends nothing', () => {
    expect(publishChoiceDates({ mode: 'draft', publishAt: at, expire: true, unpublishAt: end })).toEqual({ mode: 'draft', publishAt: null, expiresAt: null })
  })
})

describe('the summary moment and the time list', () => {
  it('says "3 Nov" + "9:00" in the site zone, adding the year only when it differs', () => {
    const now = new Date('2026-10-17T10:00:00Z')
    const m = shortMoment('2026-11-03T08:00:00.000Z', 'Europe/Rome', 'en-GB', now)
    expect(m.date).toBe('3 Nov')
    expect(m.time).toMatch(/^0?9:00$/)
    expect(shortMoment('2027-01-05T08:00:00.000Z', 'Europe/Rome', 'en-GB', now).date).toBe('5 Jan 2027')
  })
  it('steps every 15 minutes and keeps an off-grid time that was already chosen', () => {
    const steps = timeSteps()
    expect(steps).toHaveLength(96)
    expect(steps[0]).toBe('00:00')
    expect(steps[36]).toBe('09:00')
    expect(timeSteps('09:07')).toContain('09:07')
    expect(timeSteps('09:07')).toHaveLength(97)
  })
})

describe('datesSentence — when existing content is on the website', () => {
  const now = new Date('2026-10-18T10:00:00Z')
  const past = '2026-10-17T20:22:00.000Z'
  const future = '2026-10-20T07:00:00.000Z'
  const later = '2026-10-24T16:00:00.000Z'
  it('live since a past moment, with or without an end', () => {
    expect(datesSentence({ publishedAt: past, expiresAt: null }, now)).toEqual({ key: 'summarySince', start: past })
    expect(datesSentence({ publishedAt: past, expiresAt: later }, now)).toEqual({ key: 'summarySinceUntil', start: past, end: later })
  })
  it('a future go-live date: off the website until then', () => {
    expect(datesSentence({ publishedAt: future, expiresAt: null }, now)).toEqual({ key: 'summaryLater', start: future })
    expect(datesSentence({ publishedAt: future, expiresAt: later }, now)).toEqual({ key: 'summaryLaterUntil', start: future, end: later })
  })
  it('an end that has passed, and no go-live date', () => {
    expect(datesSentence({ publishedAt: past, expiresAt: '2026-10-18T09:00:00.000Z' }, now)).toEqual({ key: 'summaryEnded', end: '2026-10-18T09:00:00.000Z' })
    expect(datesSentence({ publishedAt: null, expiresAt: null }, now)).toEqual({ key: 'summaryNow' })
  })
})
