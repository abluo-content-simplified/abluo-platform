import { describe, expect, it } from 'vitest'
import { cleanParams, collapse, isSafeHref, planDigest, type NotificationInput } from '../model'
import { digestLocale, renderDigest } from '../email'

const input: NotificationInput = {
  userId: 'u', side: 'client', projectId: 'p', kind: 'message.received', sourceType: 'conversation', sourceId: 's',
  href: '/hoffmann/messages/s', params: { subject: 'Your card', name: 'Tom' },
}

describe('collapse (ADR-050 D9)', () => {
  it('inserts the first row for a source', () => {
    const plan = collapse(null, input, '2026-11-10T10:00:00Z')
    expect(plan.op).toBe('insert')
    expect(plan.op === 'insert' && plan.row.count).toBe(1)
  })
  it('updates the unread row of the same source: count + 1, fresh time, emailable again', () => {
    const plan = collapse({ id: 'n1', count: 2 }, input, '2026-11-10T11:00:00Z')
    expect(plan).toEqual({ op: 'update', id: 'n1', patch: expect.objectContaining({ count: 3, created_at: '2026-11-10T11:00:00Z', emailed_at: null }) })
  })
})

describe('what a row may hold', () => {
  it('only in-app paths', () => {
    expect(isSafeHref('/hoffmann/messages/abc')).toBe(true)
    expect(isSafeHref('//evil.example')).toBe(false)
    expect(isSafeHref('https://evil.example')).toBe(false)
    expect(isSafeHref('/x"><script>')).toBe(false)
  })
  it('only short strings and numbers as params', () => {
    expect(cleanParams({ subject: 'x'.repeat(200), count: 3, bad: { a: 1 }, 'no-dash': 'x' })).toEqual({ subject: 'x'.repeat(140), count: 3 })
  })
})

describe('planDigest (D11)', () => {
  const now = Date.parse('2026-11-10T12:00:00Z')
  const row = (userId: string, createdAt: string) => ({ id: `${userId}-${createdAt}`, userId, side: 'client' as const, createdAt, projectId: 'p' })
  it('emails after 30 quiet minutes, when the person has not been in since', () => {
    const plan = planDigest([row('a', '2026-11-10T11:00:00Z'), row('b', '2026-11-10T11:50:00Z')], new Map([['a', '2026-11-10T10:00:00Z']]), new Map(), now)
    expect([...plan.keys()]).toEqual(['a'])
  })
  it('skips people who opened a dashboard after the notification', () => {
    const plan = planDigest([row('a', '2026-11-10T11:00:00Z')], new Map([['a', '2026-11-10T11:10:00Z']]), new Map(), now)
    expect(plan.size).toBe(0)
  })
  it('at most one digest every 4 hours', () => {
    const plan = planDigest([row('a', '2026-11-10T11:00:00Z')], new Map(), new Map([['a', '2026-11-10T09:00:00Z']]), now)
    expect(plan.size).toBe(0)
    const later = planDigest([row('a', '2026-11-10T11:00:00Z')], new Map(), new Map([['a', '2026-11-10T07:30:00Z']]), now)
    expect(later.size).toBe(1)
  })
})

describe('digest email', () => {
  it('holds a count and a link, never content', () => {
    const mail = renderDigest({ locale: 'it', count: 2, url: 'https://abluo.app/hoffmann/messages' })
    expect(mail.subject).toContain('2')
    expect(mail.html).toContain('https://abluo.app/hoffmann/messages')
  })
  it('language: profile, then the site, then English', () => {
    expect(digestLocale('de', 'it')).toBe('de')
    expect(digestLocale(null, 'it')).toBe('it')
    expect(digestLocale(null, 'fr')).toBe('en')
  })
})
