import { describe, expect, it, vi } from 'vitest'
import { decideCourseGate, gatePagesFor } from '../course-gate'
import type { PlacementPage } from '../placement'
import type { PageGate } from '@/lib/access/page-gate'

const page = (id: string, open: boolean, over: Partial<PlacementPage> = {}): PlacementPage => ({ id, pageType: null, slugs: { en: id }, open, timetables: [{ courseScope: 'all', courseIds: [] }], ...over })
const DENIED: PageGate = { kind: 'denied', reason: 'no_session' as never, navigation: 'locked', visitor: 'none' }

describe('course page access (takes the access of its timetable pages)', () => {
  it('no timetable page shows the course → open, nothing read', async () => {
    const readPage = vi.fn()
    const picked = page('t', false, { timetables: [{ courseScope: 'pick', courseIds: ['other'] }] })
    expect(await decideCourseGate({ pages: [picked], courseDocId: 'c', locale: 'en' }, { readPage, decide: vi.fn() })).toEqual({ kind: 'open' })
    expect(readPage).not.toHaveBeenCalled()
  })

  it('members-only timetable → denied, with that page note and decision; granted when the visitor holds the group', async () => {
    const readPage = vi.fn(async () => ({ access: { visibility: 'restricted', groups: ['g'] }, accessPromptNote: [{ _type: 'block' }] }))
    const denied = await decideCourseGate({ pages: [page('timetable', false)], courseDocId: 'c', locale: 'en' }, { readPage, decide: async () => DENIED })
    expect(denied).toMatchObject({ kind: 'denied', note: [{ _type: 'block' }], gate: { visitor: 'none' } })
    expect(readPage).toHaveBeenCalledWith('timetable', expect.any(Array))
    const granted = await decideCourseGate({ pages: [page('timetable', false)], courseDocId: 'c', locale: 'en' }, { readPage, decide: async () => ({ kind: 'granted', chain: [], visitorGroupIds: ['g'] }) })
    expect(granted).toEqual({ kind: 'granted' })
  })

  it('any page that opens wins (a public timetable keeps the course page public)', async () => {
    const decide = vi.fn(async (f: { access?: unknown }) => ((f.access as { visibility?: string })?.visibility === 'public' ? ({ kind: 'open' } as PageGate) : DENIED))
    const readPage = vi.fn(async (id: string) => ({ access: { visibility: id === 'pub' ? 'public' : 'restricted' } }))
    expect(await decideCourseGate({ pages: [page('members', false), page('pub', true)], courseDocId: 'c', locale: 'en' }, { readPage, decide })).toEqual({ kind: 'open' })
  })

  it('an unreadable page counts as closed (deny by default)', async () => {
    expect(await decideCourseGate({ pages: [page('t', false)], courseDocId: 'c', locale: 'en' }, { readPage: async () => null, decide: vi.fn() })).toMatchObject({ kind: 'denied', gate: null })
  })

  it('checks each page with its slug in the language (home has no path)', () => {
    expect(gatePagesFor([page('a', true, { slugs: { fr: 'horaire' } }), page('h', true, { pageType: 'home', slugs: {} })], 'c', 'en')).toEqual([
      { id: 'a', slug: 'horaire' },
      { id: 'h', slug: '' },
    ])
  })
})
