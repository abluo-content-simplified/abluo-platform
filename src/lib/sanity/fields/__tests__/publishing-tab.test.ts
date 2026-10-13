/**
 * ADR-032 A22 — the Studio Publishing tab: one tab, dashboard words, a status
 * line that agrees with the dashboard, and archived as status only.
 */
import { describe, expect, it } from 'vitest'
import { publishingSummary, unpublishAfterPublish, zoneName } from '../publishing-summary'
import { schemaTypes } from '@/lib/sanity/schema'

const NOW = new Date('2026-10-13T12:00:00Z')
const ROME = 'Europe/Rome'

describe('publishingSummary', () => {
  it('draft: nothing published', () => {
    expect(publishingSummary(null, 'required', ROME, NOW)).toMatchObject({ status: 'draft', label: 'Draft' })
  })

  it('scheduled: names the go-live moment in the site zone', () => {
    const s = publishingSummary({ publishedAt: '2027-01-01T09:00:00Z' }, 'required', ROME, NOW)
    expect(s.status).toBe('scheduled')
    expect(s.detail).toContain('1 Jan 2027, 10:00')
    expect(s.detail).toContain('Rome time, GMT+1')
  })

  it('published with an end date', () => {
    const s = publishingSummary({ publishedAt: '2026-10-01T09:00:00Z', expiresAt: '2026-11-01T09:00:00Z' }, 'required', ROME, NOW)
    expect(s).toMatchObject({ status: 'published' })
    expect(s.detail).toContain('until 1 Nov 2026, 10:00')
  })

  it('unpublished after the end date', () => {
    const s = publishingSummary({ publishedAt: '2026-10-01T09:00:00Z', expiresAt: '2026-10-06T09:00:00Z' }, 'required', ROME, NOW)
    expect(s.status).toBe('unpublished')
    expect(s.detail).toContain('since 6 Oct 2026, 11:00')
  })

  it('unpublished because the window is empty explains why', () => {
    const s = publishingSummary({ publishedAt: '2027-01-01T09:00:00Z', expiresAt: '2026-10-13T08:48:00Z' }, 'required', ROME, NOW)
    expect(s.status).toBe('unpublished')
    expect(s.detail).toMatch(/not after Publish on/)
  })

  it('archived dominates and points to the dashboard', () => {
    const s = publishingSummary({ publishedAt: '2026-10-01T09:00:00Z', archivedAt: '2026-10-10T08:00:00Z' }, 'required', ROME, NOW)
    expect(s.status).toBe('archived')
    expect(s.detail).toMatch(/Restore it from the dashboard/)
  })

  it('zone names read as places', () => {
    expect(zoneName('America/New_York')).toBe('New York time')
  })
})

describe('unpublishAfterPublish', () => {
  it('accepts empty and later dates, rejects earlier or equal ones', () => {
    expect(unpublishAfterPublish(undefined, '2027-01-01T09:00:00Z')).toBe(true)
    expect(unpublishAfterPublish('2027-02-01T09:00:00Z', '2027-01-01T09:00:00Z')).toBe(true)
    expect(unpublishAfterPublish('2026-10-13T08:48:00Z', '2027-01-01T09:00:00Z')).toMatch(/^Must be after Publish on/)
    expect(unpublishAfterPublish('2027-01-01T09:00:00Z', '2027-01-01T09:00:00Z')).toMatch(/^Must be after Publish on/)
  })
})

describe('Publishing tab on post and newsArticle', () => {
  type F = { name: string; title?: string; group?: string }
  const typeOf = (name: string) =>
    (schemaTypes as unknown as { name: string; groups?: { name: string; title: string }[]; fields?: F[] }[]).find((t) => t.name === name)!

  for (const name of ['post', 'newsArticle']) {
    it(`${name}: one Publishing tab with the dashboard words, no Settings/Redirects tabs`, () => {
      const t = typeOf(name)
      const groups = t.groups!.map((g) => g.name)
      expect(groups).toContain('publishing')
      expect(groups).not.toContain('settings')
      expect(groups).not.toContain('redirects')
      const field = (n: string) => t.fields!.find((f) => f.name === n)
      expect(field('publishingStatus')).toMatchObject({ group: 'publishing' })
      expect(field('publishedAt')).toMatchObject({ title: 'Publish on', group: 'publishing' })
      expect(field('expiresAt')).toMatchObject({ title: 'Unpublish on', group: 'publishing' })
      expect(field('featured')).toMatchObject({ group: 'publishing' })
      expect(field('redirectFrom')).toMatchObject({ group: 'seo' })
      for (const f of t.fields!) expect(['settings', 'redirects']).not.toContain(f.group)
    })
  }

  it('post: archived is read-only status in the Publishing tab', () => {
    const f = typeOf('post').fields!.find((x) => x.name === 'archivedAt') as F & { readOnly?: boolean }
    expect(f).toMatchObject({ group: 'publishing', readOnly: true })
  })
})
