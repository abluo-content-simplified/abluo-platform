import { describe, expect, it } from 'vitest'
// groq-js ships with `sanity` (Studio's own GROQ engine). Used here to prove the
// GROQ fragment and its TypeScript twin agree.
import { evaluate, parse } from 'groq-js'
import { instant, isPublicAt, isPublicFilter, type LifecycleFields, type PublishedAtRule } from '../visibility'
import { deriveStatus } from '../status'
import { localToUtc, utcToLocal, validateWindow, zoneOffsetMinutes } from '../time'

const NOW = new Date('2026-10-12T10:00:00.000Z')
const PAST = '2026-10-01T09:00:00.000Z'
const PAST2 = '2026-10-05T09:00:00.000Z'
const FUTURE = '2026-10-17T10:00:00.000Z'
const FUTURE2 = '2026-11-01T10:00:00.000Z'

const FIXTURES: Record<string, LifecycleFields> = {
  none: {},
  publishedPast: { publishedAt: PAST },
  publishedFuture: { publishedAt: FUTURE },
  publishedPastExpiresFuture: { publishedAt: PAST, expiresAt: FUTURE },
  publishedPastExpiredPast: { publishedAt: PAST, expiresAt: PAST2 },
  expiresAtNowExactly: { publishedAt: PAST, expiresAt: NOW.toISOString() },
  publishedAtNowExactly: { publishedAt: NOW.toISOString() },
  scheduledWithEnd: { publishedAt: FUTURE, expiresAt: FUTURE2 },
  emptyWindow: { publishedAt: FUTURE2, expiresAt: FUTURE },
  onlyExpiresFuture: { expiresAt: FUTURE },
  onlyExpiredPast: { expiresAt: PAST },
  archived: { publishedAt: PAST, archivedAt: PAST2 },
  archivedScheduled: { publishedAt: FUTURE, archivedAt: PAST2 },
  nulls: { publishedAt: null, expiresAt: null, archivedAt: null },
}

async function groqPublic(doc: LifecycleFields, rule: PublishedAtRule): Promise<boolean> {
  const dataset = [{ _id: 'd', _type: 'thing', ...doc }]
  const tree = parse(`count(*[_id == "d" && ${isPublicFilter(rule)}]) == 1`)
  const value = await evaluate(tree, { dataset, timestamp: NOW })
  return (await value.get()) === true
}

describe('isPublicFilter ↔ isPublicAt (ADR-032 D3)', () => {
  for (const rule of ['required', 'optional'] as const) {
    for (const [name, doc] of Object.entries(FIXTURES)) {
      it(`${rule} · ${name}: GROQ and TypeScript agree`, async () => {
        expect(await groqPublic(doc, rule)).toBe(isPublicAt(doc, rule, NOW))
      })
    }
  }

  it('required keeps the existing post rule and adds the archive condition', () => {
    expect(isPublicFilter('required')).toBe(
      '(defined(publishedAt) && publishedAt <= now() && (!defined(expiresAt) || expiresAt > now()) && !defined(archivedAt))'
    )
  })

  it('optional treats a missing publishedAt as live (no migration for adopting types)', () => {
    expect(isPublicAt({}, 'optional', NOW)).toBe(true)
    expect(isPublicAt({}, 'required', NOW)).toBe(false)
  })

  it('archive dominates any window', () => {
    expect(isPublicAt(FIXTURES.archived, 'optional', NOW)).toBe(false)
    expect(isPublicAt(FIXTURES.archivedScheduled, 'required', new Date(FUTURE2))).toBe(false)
  })

  it('prefixes dereferenced documents', () => {
    expect(isPublicFilter('optional', 'relatedEvent->')).toContain('relatedEvent->expiresAt')
    expect(isPublicFilter('optional', '@->')).toContain('@->archivedAt')
  })

  it('works on a dereferenced document in GROQ', async () => {
    const dataset = [
      { _id: 'p', _type: 'post', relatedEvent: { _type: 'reference', _ref: 'e' } },
      { _id: 'e', _type: 'event', archivedAt: PAST2 },
    ]
    const tree = parse(`*[_id == "p"][0]{ "event": select(${isPublicFilter('optional', 'relatedEvent->')} => relatedEvent->_id) }`)
    const value = await (await evaluate(tree, { dataset, timestamp: NOW })).get()
    expect(value).toEqual({ event: null })
  })

  it('refuses unsafe paths', () => {
    expect(() => isPublicFilter('optional', 'x) || true || (')).toThrow()
    expect(() => isPublicFilter('optional', 'a.b->')).toThrow()
  })

  it('instant() ignores non-dates', () => {
    expect(instant('nope')).toBeNull()
    expect(instant(undefined)).toBeNull()
    expect(instant(PAST)).toBe(Date.parse(PAST))
  })
})

describe('deriveStatus (ADR-032 D4)', () => {
  const s = (published: LifecycleFields | null, rule: PublishedAtRule = 'required', draft: unknown = null) =>
    deriveStatus({ published, draft, rule }, NOW)

  it('draft: nothing published', () => {
    expect(s(null, 'required', { _id: 'drafts.x' })).toEqual({ status: 'draft', hasChanges: false, publishOn: null, unpublishOn: null })
  })
  it('published, with and without an unpublish date', () => {
    expect(s({ publishedAt: PAST }).status).toBe('published')
    expect(s({ publishedAt: PAST, expiresAt: FUTURE })).toMatchObject({ status: 'published', unpublishOn: FUTURE, publishOn: null })
  })
  it('scheduled shows both dates', () => {
    expect(s({ publishedAt: FUTURE, expiresAt: FUTURE2 })).toMatchObject({ status: 'scheduled', publishOn: FUTURE, unpublishOn: FUTURE2 })
  })
  it('unpublished: expired, at the exact boundary, empty window, or a post without a date', () => {
    expect(s({ publishedAt: PAST, expiresAt: PAST2 }).status).toBe('unpublished')
    expect(s({ publishedAt: PAST, expiresAt: NOW.toISOString() }).status).toBe('unpublished')
    expect(s({ publishedAt: FUTURE2, expiresAt: FUTURE }).status).toBe('unpublished')
    expect(s({}, 'required').status).toBe('unpublished')
    expect(s({}, 'optional').status).toBe('published')
  })
  it('archived dominates, and keeps hasChanges', () => {
    expect(s({ publishedAt: FUTURE, archivedAt: PAST }, 'required', {})).toEqual({
      status: 'archived', hasChanges: true, publishOn: null, unpublishOn: null,
    })
  })
  it('hasChanges when a draft sits next to a published document', () => {
    expect(s({ publishedAt: PAST }, 'required', { _id: 'drafts.x' }).hasChanges).toBe(true)
  })
  it('a restored item (expiresAt = restore time, future publishedAt cleared) is unpublished', () => {
    expect(s({ publishedAt: PAST, expiresAt: NOW.toISOString() }).status).toBe('unpublished')
  })
  it('status and visibility never disagree', () => {
    for (const rule of ['required', 'optional'] as const) {
      for (const doc of Object.values(FIXTURES)) {
        expect(s(doc, rule).status === 'published').toBe(isPublicAt(doc, rule, NOW))
      }
    }
  })
})

describe('time zones (ADR-032 D8)', () => {
  const ROME = 'Europe/Rome'

  it('round-trips an ordinary time', () => {
    expect(localToUtc('2026-10-17T12:00', ROME)).toEqual({ utc: '2026-10-17T10:00:00.000Z', resolution: 'exact' })
    expect(utcToLocal('2026-10-17T10:00:00.000Z', ROME)).toBe('2026-10-17T12:00')
    expect(localToUtc('2026-11-01T11:00', ROME)).toEqual({ utc: '2026-11-01T10:00:00.000Z', resolution: 'exact' })
  })

  it('spring-forward gap moves to the first valid minute (29 Mar 2026, 02:30 → 03:00 CEST)', () => {
    const r = localToUtc('2026-03-29T02:30', ROME)
    expect(r.resolution).toBe('gap')
    expect(r.utc).toBe('2026-03-29T01:00:00.000Z')
    expect(utcToLocal(r.utc, ROME)).toBe('2026-03-29T03:00')
  })

  it('fall-back overlap takes the first occurrence (25 Oct 2026, 02:30 CEST)', () => {
    expect(localToUtc('2026-10-25T02:30', ROME)).toEqual({ utc: '2026-10-25T00:30:00.000Z', resolution: 'overlap' })
  })

  it('works for other zones and offsets', () => {
    expect(localToUtc('2026-07-01T09:00', 'Europe/London').utc).toBe('2026-07-01T08:00:00.000Z')
    expect(localToUtc('2026-03-08T02:30', 'America/New_York')).toEqual({ utc: '2026-03-08T07:00:00.000Z', resolution: 'gap' })
    expect(zoneOffsetMinutes(Date.parse('2026-07-01T00:00:00Z'), ROME)).toBe(120)
    expect(zoneOffsetMinutes(Date.parse('2026-01-01T00:00:00Z'), ROME)).toBe(60)
  })

  it('rejects malformed or impossible local values', () => {
    expect(() => localToUtc('2026-02-30T10:00', ROME)).toThrow()
    expect(() => localToUtc('2026-10-17 12:00', ROME)).toThrow()
    expect(() => localToUtc('2026-13-01T10:00', ROME)).toThrow()
    expect(() => localToUtc('2026-10-17T24:00', ROME)).toThrow()
  })
})

describe('validateWindow (ADR-032 D6)', () => {
  it('accepts a past publish date and a future unpublish date after it', () => {
    expect(validateWindow({ publishedAt: PAST, expiresAt: FUTURE }, NOW)).toBeNull()
    expect(validateWindow({ publishedAt: FUTURE }, NOW)).toBeNull()
    expect(validateWindow({}, NOW)).toBeNull()
  })
  it('refuses an unpublish date in the past or not after publishing', () => {
    expect(validateWindow({ expiresAt: PAST }, NOW)).toBe('unpublish_in_past')
    expect(validateWindow({ expiresAt: NOW.toISOString() }, NOW)).toBe('unpublish_in_past')
    expect(validateWindow({ publishedAt: FUTURE2, expiresAt: FUTURE }, NOW)).toBe('unpublish_not_after_publish')
    expect(validateWindow({ publishedAt: FUTURE, expiresAt: FUTURE }, NOW)).toBe('unpublish_not_after_publish')
  })
  it('refuses non-dates', () => {
    expect(validateWindow({ publishedAt: 'soon' }, NOW)).toBe('invalid_date')
    expect(validateWindow({ expiresAt: '' }, NOW)).toBe('invalid_date')
  })
})
