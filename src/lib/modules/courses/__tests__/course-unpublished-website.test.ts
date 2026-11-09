/**
 * An unpublished course is never public (Tom, 2026-11-08). Every website reader
 * of courses — the timetable's courses (by publicId or "all"), the course
 * list section, the course page and its redirect, the sitemap and the
 * dashboard search's "on the website" — goes through COURSE_VISIBLE, which is
 * the platform's one public-visibility rule (isPublicFilter, publishedAt
 * optional). Evaluated by groq-js on real queries at a fixed clock.
 */
import { describe, expect, it } from 'vitest'
import { evaluate, parse } from 'groq-js'
import { isPublicAt, isPublicFilter } from '@/lib/lifecycle/visibility'
import { MODULE_REGISTRY } from '@/lib/modules/registry'
import {
  COURSES_BY_PUBLIC_IDS_QUERY,
  COURSES_LISTING_QUERY,
  COURSE_BY_OLD_SLUG_QUERY,
  COURSE_BY_SLUG_QUERY,
  COURSE_VISIBLE,
  SITEMAP_COURSES_QUERY,
} from '../queries'

const NOW = new Date('2026-11-12T10:00:00Z')
const course = (id: string, publicId: string, o: Record<string, unknown> = {}) => ({
  _id: id,
  _type: 'course',
  projectSlug: 'cyce',
  publicId,
  title: { en: id },
  slug: { _type: 'localizedSlug', en: { _type: 'slug', current: id } },
  redirectFrom: { _type: 'redirectFrom', en: [`old-${id}`] },
  ...o,
})
const DATASET = [
  course('live', 'p-live', { publishedAt: '2026-09-01T08:00:00Z' }),
  course('legacy', 'p-legacy'), // published before dates existed
  course('leaving', 'p-leaving', { publishedAt: '2026-09-01T08:00:00Z', expiresAt: '2026-12-01T00:00:00Z' }), // "Unpublish on…" still ahead
  course('unpublished', 'p-unpub', { publishedAt: '2026-09-01T08:00:00Z', expiresAt: '2026-11-04T10:00:00Z' }),
  course('restored', 'p-restored', { expiresAt: '2026-10-01T00:00:00Z' }), // restore lands on Unpublished
  course('archived', 'p-arch', { archivedAt: '2026-10-01T00:00:00Z', expiresAt: '2026-10-01T00:00:00Z' }),
  course('scheduled', 'p-sched', { publishedAt: '2026-12-01T08:00:00Z' }),
  { ...course('drafty', 'p-draft'), _id: 'drafts.drafty' },
]
const ALL_IDS = DATASET.map((d) => d.publicId)
const PUBLIC = ['leaving', 'legacy', 'live']

async function run(query: string, params: Record<string, unknown> = {}) {
  const p = { projectSlug: 'cyce', locale: 'en', defaultLocale: 'en', ...params }
  return (await evaluate(parse(query, { params: p }), { dataset: DATASET, params: p, timestamp: NOW })).get()
}

describe('unpublished courses are never public', () => {
  it('COURSE_VISIBLE is the shared rule (drafts excluded) — and agrees with isPublicAt', () => {
    expect(COURSE_VISIBLE).toBe(`!(_id in path("drafts.**")) && ${isPublicFilter('optional')}`)
    expect(COURSE_VISIBLE).toContain('expiresAt > now()')
    const ts = DATASET.filter((d) => !d._id.startsWith('drafts.') && isPublicAt(d as never, 'optional', NOW)).map((d) => d._id).sort()
    expect(ts).toEqual(PUBLIC)
  })

  it('timetable courses — by publicId and "all courses" — and the course list section', async () => {
    const picked = (await run(COURSES_BY_PUBLIC_IDS_QUERY, { publicIds: ALL_IDS })) as Array<{ title: string }>
    expect(picked.map((c) => c.title).sort()).toEqual(PUBLIC)
    const all = (await run(COURSES_LISTING_QUERY)) as Array<{ title: string }>
    expect(all.map((c) => c.title).sort()).toEqual(PUBLIC)
  })

  it('the course page and its redirect: no page for an unpublished, restored, archived, scheduled or draft course', async () => {
    for (const id of ['unpublished', 'restored', 'archived', 'scheduled', 'drafty']) {
      expect(await run(COURSE_BY_SLUG_QUERY, { slug: id }), id).toBeNull()
      expect(await run(COURSE_BY_OLD_SLUG_QUERY, { slug: `old-${id}` }), id).toBeNull()
    }
    expect(await run(COURSE_BY_SLUG_QUERY, { slug: 'leaving' })).toMatchObject({ title: 'leaving' })
    expect(await run(COURSE_BY_OLD_SLUG_QUERY, { slug: 'old-live' })).toEqual({ currentSlug: 'live' })
  })

  it('the sitemap lists only public courses', async () => {
    const rows = (await run(SITEMAP_COURSES_QUERY)) as Array<{ slugMap: { en: { current: string } } }>
    expect(rows.map((r) => r.slugMap.en.current).sort()).toEqual(PUBLIC)
  })

  it('the dashboard search marks only public courses as "on the website"', () => {
    const search = MODULE_REGISTRY.find((m) => m.id === 'courses')?.search
    const source = search?.source as { site?: { visible?: string } } | undefined
    expect(source?.site?.visible).toBe(COURSE_VISIBLE)
  })
})
