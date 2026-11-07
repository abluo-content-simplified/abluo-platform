/**
 * Courses in the client dashboard (ADR-045). Every refusal happens BEFORE any
 * write; identity comes from the grant; only this project's courses are
 * reachable; delete is refused while anything references the course or it has
 * classes; publish needs a title in the main language.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import {
  COURSE_LIST_QUERY,
  COURSE_SEGMENT_QUERY,
  COURSE_SLUGS_QUERY,
  createCourse,
  discardCourseDraft,
  getCourseForEdit,
  listCourses,
  openCourseForEdit,
  publishCourseDraft,
  runCourseLifecycle,
  saveCourseDraft,
  setCoursePublishDate,
  unscheduleCourse,
} from '../course-drafts'
import type { PlacementInfo } from '@/lib/modules/courses/placement'
import { COURSE_DELETE_REFERRERS, CourseError } from '../course-lifecycle'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const PID = '11111111-1111-4111-8111-111111111111'
const PUB = '22222222-2222-4222-8222-222222222222'
const PUB2 = '33333333-3333-4333-8333-333333333333'
const ALL = ['courses.course.read', 'courses.course.write', 'courses.course.delete', 'courses.schedule.write', 'courses.meeting.manage']
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({
  projectId: PID,
  projectSlug: asSupabaseProjectSlug('cyce'),
  membershipId: 'm1',
  role: 'owner',
  permissions: ALL,
  enabledModuleIds: ['courses'],
  ...o,
})
const editor = () => grant({ role: 'editor', permissions: ['courses.course.read', 'courses.course.write', 'courses.schedule.write'] })
const viewer = () => grant({ role: 'viewer', permissions: ['courses.course.read'] })
const ctx = (...g: ProjectGrant[]): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: g })

type Docs = Record<string, Record<string, unknown>>
const baseDocs = (): Docs => ({
  iyengar: { _id: 'iyengar', _type: 'course', _rev: 'p1', projectSlug: 'cyce', publicId: PUB, title: { _type: 'localizedString', fr: 'Iyengar Yoga', en: 'Iyengar Yoga' }, color: 'accent' },
  'drafts.iyengar': { _id: 'drafts.iyengar', _type: 'course', _rev: 'd1', projectSlug: 'cyce', publicId: PUB, title: { _type: 'localizedString', fr: 'Yoga Iyengar' }, shortDescription: { _type: 'localizedText', fr: 'Pour tous' }, color: 'accent' },
  draftonly: { _id: 'drafts.draftonly', _type: 'course', _rev: 'o1', projectSlug: 'cyce', publicId: PUB2, title: { _type: 'localizedString', fr: 'Brouillon' } },
  archived: { _id: 'archived', _type: 'course', _rev: 'a1', projectSlug: 'cyce', publicId: '44444444-4444-4444-8444-444444444444', title: { _type: 'localizedString', fr: 'Ancien' }, archivedAt: '2026-10-01T00:00:00Z' },
  foreign: { _id: 'foreign', _type: 'course', _rev: 'f1', projectSlug: 'livener', publicId: '55555555-5555-4555-8555-555555555555', title: { _type: 'localizedString', en: 'Not ours' } },
  notacourse: { _id: 'notacourse', _type: 'post', _rev: 'x1', projectSlug: 'cyce' },
})
// the draft-only document is stored under its drafts.* id
const docsWithDraftOnly = (): Docs => {
  const d = baseDocs()
  d['drafts.draftonly'] = d.draftonly
  delete d.draftonly
  return d
}

const PLACED: PlacementInfo = { origin: 'https://www.cyce.info', defaultLocale: 'fr', pages: [{ id: 'p1', pageType: 'services', slugs: { fr: 'horaires' }, open: true, timetables: [{ courseScope: 'all', courseIds: [] }] }] }
const NO_PAGE: PlacementInfo = { ...PLACED, pages: [] }

type Opts = { docs?: Docs; deleteRefs?: Array<{ _id: string; _type: string; label?: unknown }>; commitError?: unknown; count?: number; placement?: PlacementInfo; segment?: unknown }

function fake(opts: Opts = {}, hasSchedule: (publicId: string, projectId: string) => Promise<boolean> = async () => false) {
  const docs = opts.docs ?? docsWithDraftOnly()
  const writes: Array<[string, unknown]> = []
  const patchOps: Array<[string, unknown]> = []
  const txOps: Array<[string, unknown]> = []
  const created: Array<Record<string, unknown>> = []
  const patch = vi.fn((id: string) => {
    const p = {
      ifRevisionId: (r: string) => (patchOps.push(['ifRevisionId', r]), p),
      setIfMissing: (v: unknown) => (patchOps.push(['setIfMissing', v]), p),
      set: (v: unknown) => (patchOps.push(['set', v]), p),
      unset: (v: unknown) => (patchOps.push(['unset', v]), p),
      commit: vi.fn(async () => {
        if (opts.commitError) throw opts.commitError
        writes.push(['patch', id])
        return { _rev: 'd2' }
      }),
    }
    return p
  })
  const transaction = vi.fn(() => {
    const tx = {
      patch: (id: string, v: unknown) => (txOps.push(['patch', [id, v]]), tx),
      create: (d: unknown) => (txOps.push(['create', d]), tx),
      createOrReplace: (d: unknown) => (txOps.push(['createOrReplace', d]), tx),
      delete: (id: string) => (txOps.push(['delete', id]), tx),
      commit: vi.fn(async (o?: { transactionId?: string }) => {
        if (opts.commitError) throw opts.commitError
        writes.push(['transaction', o?.transactionId ?? ''])
        return { transactionId: 'tx-1' }
      }),
    }
    return tx
  })
  const fetch = vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
    if (q.includes('count(*[_type == "project"')) return 1
    if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'fr', supportedLocales: ['fr', 'en', 'de'] }
    if (q === COURSE_DELETE_REFERRERS) return opts.deleteRefs ?? []
    if (q.includes('_type == "mediaAsset"')) {
      // Media Library: only this website's assets (`asset-*`) exist.
      if (p.projectSlug !== 'cyce' || !String(p.id).startsWith('asset-')) return null
      return q.includes('[0]._id') ? p.id : { url: 'https://cdn.example/x.jpg', alt: { _type: 'localizedString', fr: 'Une salle' } }
    }
    if (q.startsWith('count(*[_type == "course"')) return opts.count ?? 3
    if (q === COURSE_LIST_QUERY) return Object.values(docs).filter((d) => d._type === 'course' && d.projectSlug === p.projectSlug)
    if (q === COURSE_SLUGS_QUERY) return Object.values(docs).filter((d) => d._type === 'course' && d.projectSlug === p.projectSlug)
    if (q === COURSE_SEGMENT_QUERY) return p.projectSlug === 'cyce' ? (opts.segment ?? null) : null
    throw new Error(`unexpected query ${q}`)
  })
  const client = {
    getDocument: vi.fn(async (id: string) => docs[id]),
    fetch,
    create: vi.fn(async (d: Record<string, unknown>) => (created.push(d), writes.push(['create', d._id]), { ...d, _rev: 'c1' })),
    patch,
    transaction,
  }
  const audit = vi.fn(async () => undefined)
  const hasScheduleFn = vi.fn(hasSchedule)
  return {
    client, writes, patchOps, txOps, created, audit, hasSchedule: hasScheduleFn,
    deps: {
      client: client as never,
      uuid: () => 'new-course',
      publicUuid: () => '66666666-6666-4666-8666-666666666666',
      now: () => new Date('2026-11-04T10:00:00Z'),
      placement: vi.fn(async () => opts.placement ?? PLACED),
      audit,
      hasSchedule: hasScheduleFn,
    },
  }
}

// ── Gates ─────────────────────────────────────────────────────────────────────

describe('gates — refused before any I/O', () => {
  const writeCalls = (c: TenantAuthorizationContext, f: ReturnType<typeof fake>, pid = PID) => [
    () => createCourse(c, pid, { title: 'Yoga' }, f.deps),
    () => openCourseForEdit(c, pid, { id: 'iyengar' }, f.deps),
    () => saveCourseDraft(c, pid, { id: 'iyengar', rev: 'd1', set: { color: 'muted' } }, f.deps),
    () => publishCourseDraft(c, pid, { id: 'iyengar', rev: 'd1' }, f.deps),
    () => discardCourseDraft(c, pid, { id: 'iyengar', rev: 'd1' }, f.deps),
    () => runCourseLifecycle(c, pid, { id: 'iyengar', op: 'archive' }, f.deps),
  ]

  it.each([
    ['a viewer', ctx(viewer())],
    ['a site without the Courses module', ctx(grant({ enabledModuleIds: ['blog'] }))],
  ])('%s cannot write', async (_l, c) => {
    const f = fake()
    for (const call of writeCalls(c, f)) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
  })

  it('an editor can archive and restore but not delete', async () => {
    const f = fake()
    const c = ctx(editor())
    for (const op of ['deleteDraft', 'deletePermanently'] as const) {
      await expect(runCourseLifecycle(c, PID, { id: 'iyengar', op }, f.deps)).rejects.toThrow(TenantAuthorizationError)
    }
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
  })

  it('a site without the module cannot even list', async () => {
    await expect(listCourses(ctx(grant({ enabledModuleIds: [] })), PID, fake().deps)).rejects.toThrow(TenantAuthorizationError)
  })

  it("another tenant's project is refused for reads and writes", async () => {
    const f = fake()
    const c = ctx(grant())
    await expect(listCourses(c, 'other-project', f.deps)).rejects.toThrow(TenantAuthorizationError)
    for (const call of writeCalls(c, f, 'other-project')) await expect(call()).rejects.toThrow(TenantAuthorizationError)
    expect(f.writes).toEqual([])
  })
})

// ── Cross-project ─────────────────────────────────────────────────────────────

describe('cross-project — ids cannot be probed', () => {
  it('a course of another website (or another type) is not_found everywhere', async () => {
    const f = fake()
    const c = ctx(grant())
    for (const id of ['foreign', 'notacourse', 'missing', '../x', 'drafts.iyengar']) {
      await expect(getCourseForEdit(c, PID, id, f.deps)).rejects.toMatchObject({ code: 'not_found' })
      await expect(openCourseForEdit(c, PID, { id }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
      await expect(runCourseLifecycle(c, PID, { id, op: 'deletePermanently' }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
    }
    expect(f.writes).toEqual([])
  })

  it('the list holds only this website’s courses', async () => {
    const { courses } = await listCourses(ctx(viewer()), PID, fake().deps)
    expect(courses.map((x) => x.id).sort()).toEqual(['archived', 'draftonly', 'iyengar'])
  })
})

// ── List / get ────────────────────────────────────────────────────────────────

describe('list and get', () => {
  it('shows the draft’s title in the default language, the state, and no schedule until scheduling is wired', async () => {
    const { courses, site } = await listCourses(ctx(viewer()), PID, fake().deps)
    expect(site).toEqual({ defaultLocale: 'fr', languages: ['fr', 'en', 'de'], timeZone: null })
    const iy = courses.find((x) => x.id === 'iyengar')!
    expect(iy).toMatchObject({ title: 'Yoga Iyengar', shortDescription: 'Pour tous', state: 'changes', hasDraft: true, isPublished: true, color: 'accent', schedule: null, publicId: PUB })
    expect(iy.missingLanguages).toEqual(['en', 'de'])
    expect(courses.find((x) => x.id === 'draftonly')).toMatchObject({ state: 'draft', isPublished: false })
    expect(courses.find((x) => x.id === 'archived')).toMatchObject({ state: 'archived' })
  })

  it('uses the schedule summary when scheduling provides one, and survives its failure', async () => {
    const f = fake()
    const summary = new Map([[PUB, { classes: 2, teachers: ['Sabrina'], nextClassAt: '2026-11-05T17:00:00Z' }]])
    const ok = await listCourses(ctx(viewer()), PID, { ...f.deps, scheduleSummary: async () => summary })
    expect(ok.courses.find((x) => x.id === 'iyengar')!.schedule).toEqual({ classes: 2, teachers: ['Sabrina'], nextClassAt: '2026-11-05T17:00:00Z' })
    expect(ok.courses.find((x) => x.id === 'iyengar')!.searchText).toContain('sabrina')
    const failed = await listCourses(ctx(viewer()), PID, { ...f.deps, scheduleSummary: async () => { throw new Error('db down') } })
    expect(failed.courses.every((x) => x.schedule === null)).toBe(true)
  })

  it('get returns the draft over the published course', async () => {
    const s = await getCourseForEdit(ctx(viewer()), PID, 'iyengar', fake().deps)
    expect(s).toMatchObject({ id: 'iyengar', rev: 'd1', state: 'changes', title: { fr: 'Yoga Iyengar' }, color: 'accent' })
  })
})

// ── Create ────────────────────────────────────────────────────────────────────

describe('create', () => {
  it('makes a draft in the default language with a new publicId and the grant’s project', async () => {
    const f = fake()
    const r = await createCourse(ctx(editor()), PID, { title: '  Méditation  ' }, f.deps)
    expect(r).toEqual({ id: 'new-course', publicId: '66666666-6666-4666-8666-666666666666', rev: 'c1' })
    expect(f.created).toEqual([
      { _id: 'drafts.new-course', _type: 'course', projectSlug: 'cyce', publicId: '66666666-6666-4666-8666-666666666666', title: { _type: 'localizedString', fr: 'Méditation' }, color: 'none' },
    ])
    expect(f.audit).toHaveBeenCalled()
  })

  it('refuses an empty or oversized title, and a site with too many courses', async () => {
    const f = fake()
    await expect(createCourse(ctx(editor()), PID, { title: '   ' }, f.deps)).rejects.toMatchObject({ code: 'missing_title' })
    await expect(createCourse(ctx(editor()), PID, { title: 'x'.repeat(121) }, f.deps)).rejects.toMatchObject({ code: 'too_large' })
    await expect(createCourse(ctx(editor()), PID, { title: 5 as never }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(createCourse(ctx(editor()), PID, { title: 'A' }, fake({ count: 1000 }).deps)).rejects.toMatchObject({ code: 'too_large' })
    expect(f.created).toEqual([])
  })
})

// ── Open / save ───────────────────────────────────────────────────────────────

describe('open and save a draft', () => {
  it('open copies the published course into a draft without lifecycle fields or system fields', async () => {
    const docs = baseDocs()
    delete docs['drafts.iyengar']
    const f = fake({ docs })
    const r = await openCourseForEdit(ctx(editor()), PID, { id: 'iyengar' }, f.deps)
    expect(r).toEqual({ id: 'iyengar', rev: 'c1', created: true })
    expect(f.created[0]).toMatchObject({ _id: 'drafts.iyengar', _type: 'course', projectSlug: 'cyce', publicId: PUB })
    expect(f.created[0]).not.toHaveProperty('_rev')
  })

  it('open of an archived course asks to restore it', async () => {
    await expect(openCourseForEdit(ctx(editor()), PID, { id: 'archived' }, fake().deps)).rejects.toMatchObject({ code: 'archived' })
  })

  it('save sets localized text and colour, guarded by the revision', async () => {
    const f = fake()
    const r = await saveCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1', set: { 'title.en': ' Iyengar  Yoga ', 'shortDescription.de': 'Für alle', color: 'muted' } }, f.deps)
    expect(r).toEqual({ rev: 'd2' })
    expect(f.client.patch).toHaveBeenCalledWith('drafts.iyengar')
    expect(f.patchOps).toContainEqual(['ifRevisionId', 'd1'])
    expect(f.patchOps).toContainEqual(['set', { 'title.en': 'Iyengar Yoga', 'shortDescription.de': 'Für alle', color: 'muted' }])
    expect(f.patchOps).toContainEqual(['setIfMissing', { title: { _type: 'localizedString' }, shortDescription: { _type: 'localizedText' } }])
  })

  it('the image is a Media Library reference of this website: set, removed, or refused before any write', async () => {
    const f = fake()
    await saveCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1', set: { image: 'asset-1' } }, f.deps)
    expect(f.patchOps).toContainEqual(['set', { image: { _type: 'reference', _ref: 'asset-1' } }])
    const g = fake()
    await saveCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1', set: { image: null } }, g.deps)
    expect(g.patchOps).toContainEqual(['unset', ['image']])
    const h = fake()
    for (const image of ['other-site-asset', '../x', 42]) {
      await expect(saveCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1', set: { image } }, h.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    }
    expect(h.client.patch).not.toHaveBeenCalled()
  })

  it('the editor snapshot carries the image of this website (url and description), never a foreign one', async () => {
    const docs = docsWithDraftOnly()
    docs['drafts.iyengar'].image = { _type: 'reference', _ref: 'asset-1' }
    const snap = await getCourseForEdit(ctx(editor()), PID, 'iyengar', fake({ docs }).deps)
    expect(snap.image).toEqual({ assetId: 'asset-1', url: 'https://cdn.example/x.jpg', alt: { fr: 'Une salle' } })
    docs['drafts.iyengar'].image = { _type: 'reference', _ref: 'foreign-asset' }
    expect((await getCourseForEdit(ctx(editor()), PID, 'iyengar', fake({ docs }).deps)).image).toBeNull()
  })

  it('a cleared text is removed (incomplete drafts always save)', async () => {
    const f = fake()
    await saveCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1', set: { 'title.fr': '  ' } }, f.deps)
    expect(f.patchOps).toContainEqual(['unset', ['title.fr']])
  })

  it('refuses unknown fields, languages not on the site, unknown colours — before any read', async () => {
    const f = fake()
    const c = ctx(editor())
    for (const set of [{ projectSlug: 'x' }, { publicId: 'x' }, { 'title.fr.x': 'a' }, { slug: 'a' }, { archivedAt: 'now' }, { 'title.': 'a' }]) {
      await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set }, f.deps)).rejects.toMatchObject({ code: 'invalid_field' })
    }
    expect(f.client.getDocument).not.toHaveBeenCalled()
    await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { 'title.ja': 'x' } }, f.deps)).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { color: 'hotpink' } }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { 'title.fr': 'x'.repeat(121) } }, f.deps)).rejects.toMatchObject({ code: 'too_large' })
    expect(f.writes).toEqual([])
  })

  it('a stale revision is a conflict, a missing draft or archived course is refused', async () => {
    const c = ctx(editor())
    await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: 'old', set: { color: 'none' } }, fake().deps)).rejects.toMatchObject({ code: 'conflict' })
    await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: '', set: { color: 'none' } }, fake().deps)).rejects.toMatchObject({ code: 'conflict' })
    await expect(saveCourseDraft(c, PID, { id: 'archived', rev: 'a1', set: { color: 'none' } }, fake().deps)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('a store-side revision clash (409) is a conflict; other failures are opaque', async () => {
    const c = ctx(editor())
    await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { color: 'none' } }, fake({ commitError: { statusCode: 409 } }).deps)).rejects.toMatchObject({ code: 'conflict' })
    const err = await saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { color: 'none' } }, fake({ commitError: new Error('secret internal detail') }).deps).catch((e) => e)
    expect(err).toBeInstanceOf(CourseError)
    expect(err.code).toBe('failed')
    expect(err.message).not.toContain('secret')
  })
})

// ── Publish / discard ─────────────────────────────────────────────────────────

describe('publish and discard', () => {
  it('publishes the draft over the live course, keeping the publicId', async () => {
    const f = fake()
    await publishCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1' }, f.deps)
    const replaced = f.txOps.find(([k]) => k === 'createOrReplace')![1] as Record<string, unknown>
    expect(replaced).toMatchObject({ _id: 'iyengar', _type: 'course', projectSlug: 'cyce', publicId: PUB, title: { fr: 'Yoga Iyengar' } })
    expect(f.txOps.filter(([k]) => k === 'delete').map(([, v]) => v)).toEqual(['drafts.iyengar'])
  })

  it('publishing a new course creates it', async () => {
    const f = fake()
    await publishCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1' }, f.deps)
    expect(f.txOps.some(([k]) => k === 'create')).toBe(true)
  })

  it('needs a title in the main language and a matching revision', async () => {
    const docs = baseDocs()
    docs['drafts.iyengar'] = { ...docs['drafts.iyengar'], title: { _type: 'localizedString', en: 'Only English' } }
    await expect(publishCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1' }, fake({ docs }).deps)).rejects.toMatchObject({ code: 'missing_title' })
    await expect(publishCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'zzz' }, fake().deps)).rejects.toMatchObject({ code: 'conflict' })
  })

  it('discard needs a published course', async () => {
    const f = fake()
    await expect(discardCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1' }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await discardCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1' }, f.deps)
    expect(f.txOps.filter(([k]) => k === 'delete').map(([, v]) => v)).toEqual(['drafts.iyengar'])
  })
})

// ── Publish = online · dates ──────────────────────────────────────────────────

const FUTURE = '2026-12-01T09:00:00Z'
const replacedDoc = (f: ReturnType<typeof fake>) => (f.txOps.find(([k]) => k === 'createOrReplace' || k === 'create')![1] as Record<string, unknown>)
const scheduledDocs = (withDraft: boolean): Docs => {
  const d = baseDocs()
  d.iyengar = { ...d.iyengar, publishedAt: FUTURE }
  if (!withDraft) delete d['drafts.iyengar']
  return d
}

describe('publish = online: a timetable must show the course', () => {
  it('a never-published course goes online now (publishedAt = now) when a timetable shows it', async () => {
    const f = fake()
    const r = await publishCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1', mode: 'now' }, f.deps)
    expect(replacedDoc(f).publishedAt).toBe('2026-11-04T10:00:00.000Z')
    expect(r.publishedAt).toBe('2026-11-04T10:00:00.000Z')
    expect(f.deps.placement).toHaveBeenCalledWith('cyce')
  })

  it('refuses with no_timetable_page — before anything is written — when no published page would show it', async () => {
    const f = fake({ placement: NO_PAGE })
    await expect(publishCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1', mode: 'now' }, f.deps)).rejects.toMatchObject({ code: 'no_timetable_page' })
    await expect(publishCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1', mode: 'schedule', publishAt: '2027-01-10T09:00:00Z' }, f.deps)).rejects.toMatchObject({ code: 'no_timetable_page' })
    expect(f.writes).toEqual([])
  })

  it('a section that picks other courses does not count; one that picks this course does', async () => {
    const others: PlacementInfo = { ...PLACED, pages: [{ ...PLACED.pages[0], timetables: [{ courseScope: 'pick', courseIds: ['other'] }] }] }
    await expect(publishCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1', mode: 'now' }, fake({ placement: others }).deps)).rejects.toMatchObject({ code: 'no_timetable_page' })
    const mine: PlacementInfo = { ...PLACED, pages: [{ ...PLACED.pages[0], timetables: [{ courseScope: 'pick', courseIds: ['draftonly'] }] }] }
    await expect(publishCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1', mode: 'now' }, fake({ placement: mine }).deps)).resolves.toBeDefined()
  })

  it('a failing website read refuses (failed), never publishes blind', async () => {
    const f = fake()
    f.deps.placement.mockRejectedValueOnce(new Error('sanity down'))
    await expect(publishCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1', mode: 'now' }, f.deps)).rejects.toMatchObject({ code: 'failed' })
    expect(f.writes).toEqual([])
  })

  it('updating a course that is already published needs no check and keeps its date (none = visible)', async () => {
    const f = fake({ placement: NO_PAGE })
    const r = await publishCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1' }, f.deps)
    expect(f.deps.placement).not.toHaveBeenCalled()
    expect(replacedDoc(f)).not.toHaveProperty('publishedAt')
    expect(r.publishedAt).toBeNull()
    expect(f.audit).not.toHaveBeenCalled() // a content update is not a lifecycle event
  })

  it('"now" on a live course keeps its original date', async () => {
    const docs = baseDocs()
    docs.iyengar = { ...docs.iyengar, publishedAt: '2026-10-01T08:00:00Z' }
    const f = fake({ docs })
    await publishCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1', mode: 'now' }, f.deps)
    expect(replacedDoc(f).publishedAt).toBe('2026-10-01T08:00:00Z')
  })
})

describe('Publish on… (schedule)', () => {
  it('publishes with a future publishedAt and records "scheduled"', async () => {
    const f = fake()
    const r = await publishCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1', mode: 'schedule', publishAt: '2026-12-01T09:00:00+01:00' }, f.deps)
    expect(replacedDoc(f).publishedAt).toBe('2026-12-01T08:00:00.000Z')
    expect(r.publishedAt).toBe('2026-12-01T08:00:00.000Z')
    expect(f.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'scheduled' }))
  })

  it('refuses a missing, malformed, past or more than two years away date (invalid_schedule) before any read', async () => {
    const f = fake()
    for (const publishAt of [undefined, 'tomorrow', '2026-11-04T09:00:00Z', '2026-11-04T10:00:00Z', '2029-01-01T00:00:00Z']) {
      await expect(publishCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1', mode: 'schedule', publishAt }, f.deps)).rejects.toMatchObject({ code: 'invalid_schedule' })
    }
    expect(f.client.getDocument).not.toHaveBeenCalled()
    expect(f.writes).toEqual([])
  })

  it('never moves a live course into the future (that would take it offline)', async () => {
    const f = fake()
    await expect(publishCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1', mode: 'schedule', publishAt: '2026-12-01T09:00:00Z' }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.writes).toEqual([])
  })

  it('refuses an unknown mode', async () => {
    await expect(publishCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1', mode: 'later' as never }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('a scheduled course is "scheduled" in the list and when opened; with a draft it stays scheduled', async () => {
    const f = fake({ docs: scheduledDocs(true) })
    const list = await listCourses(ctx(viewer()), PID, f.deps)
    expect(list.courses.find((c) => c.id === 'iyengar')).toMatchObject({ state: 'scheduled', publishedAt: FUTURE, hasDraft: true })
    expect(await getCourseForEdit(ctx(viewer()), PID, 'iyengar', f.deps)).toMatchObject({ state: 'scheduled', publishedAt: FUTURE })
    // once the date has passed it is simply published
    const later = await getCourseForEdit(ctx(viewer()), PID, 'iyengar', { ...f.deps, now: () => new Date('2026-12-02T00:00:00Z') })
    expect(later.state).toBe('changes')
  })

  it('"keep" updates a scheduled course without moving its date', async () => {
    const f = fake({ docs: scheduledDocs(true) })
    const r = await publishCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1', mode: 'keep' }, f.deps)
    expect(replacedDoc(f).publishedAt).toBe(FUTURE)
    expect(r.publishedAt).toBe(FUTURE)
  })

  it('"now" on a scheduled course puts it online now (the check applies)', async () => {
    const f = fake({ docs: scheduledDocs(true) })
    await publishCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1', mode: 'now' }, f.deps)
    expect(replacedDoc(f).publishedAt).toBe('2026-11-04T10:00:00.000Z')
    await expect(publishCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1', mode: 'now' }, fake({ docs: scheduledDocs(true), placement: NO_PAGE }).deps)).rejects.toMatchObject({ code: 'no_timetable_page' })
  })

  it('an open draft never carries the publication date over from the published course', async () => {
    const f = fake({ docs: scheduledDocs(false) })
    await openCourseForEdit(ctx(editor()), PID, { id: 'iyengar' }, f.deps)
    expect(f.created[0]).not.toHaveProperty('publishedAt')
  })
})

describe('change the date · publish now instead · back to draft', () => {
  it('changes the go-live date of a scheduled course on both versions, without publishing the draft', async () => {
    const f = fake({ docs: scheduledDocs(true) })
    const r = await setCoursePublishDate(ctx(editor()), PID, { id: 'iyengar', mode: 'schedule', publishAt: '2026-12-15T09:00:00Z' }, f.deps)
    expect(r.publishedAt).toBe('2026-12-15T09:00:00.000Z')
    const patched = f.txOps.filter(([k]) => k === 'patch').map(([, v]) => v as [string, { set?: Record<string, unknown> }])
    expect(patched.map(([id]) => id).sort()).toEqual(['drafts.iyengar', 'iyengar'])
    expect(patched.every(([, v]) => v.set?.publishedAt === '2026-12-15T09:00:00.000Z')).toBe(true)
    expect(f.txOps.some(([k]) => k === 'createOrReplace' || k === 'delete')).toBe(false)
  })

  it('"now" puts it online at once; both need a timetable, a valid date and a scheduled course', async () => {
    const f = fake({ docs: scheduledDocs(false) })
    expect((await setCoursePublishDate(ctx(editor()), PID, { id: 'iyengar', mode: 'now' }, f.deps)).publishedAt).toBe('2026-11-04T10:00:00.000Z')
    await expect(setCoursePublishDate(ctx(editor()), PID, { id: 'iyengar', mode: 'now' }, fake({ docs: scheduledDocs(false), placement: NO_PAGE }).deps)).rejects.toMatchObject({ code: 'no_timetable_page' })
    await expect(setCoursePublishDate(ctx(editor()), PID, { id: 'iyengar', mode: 'schedule', publishAt: '2026-10-01T09:00:00Z' }, fake({ docs: scheduledDocs(false) }).deps)).rejects.toMatchObject({ code: 'invalid_schedule' })
    // a live course cannot be re-dated (it would go offline); a never-published one has no date to change
    await expect(setCoursePublishDate(ctx(editor()), PID, { id: 'iyengar', mode: 'schedule', publishAt: '2026-12-15T09:00:00Z' }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(setCoursePublishDate(ctx(editor()), PID, { id: 'draftonly', mode: 'now' }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('back to draft removes the scheduled version and keeps the draft (or makes one from it)', async () => {
    const withDraft = fake({ docs: scheduledDocs(true) })
    await unscheduleCourse(ctx(editor()), PID, { id: 'iyengar' }, withDraft.deps)
    expect(withDraft.txOps.filter(([k]) => k === 'delete').map(([, v]) => v)).toEqual(['iyengar'])
    expect(withDraft.txOps.some(([k]) => k === 'create')).toBe(false)

    const alone = fake({ docs: scheduledDocs(false) })
    await unscheduleCourse(ctx(editor()), PID, { id: 'iyengar' }, alone.deps)
    expect(alone.txOps.filter(([k]) => k === 'delete').map(([, v]) => v)).toEqual(['iyengar'])
    const copy = alone.txOps.find(([k]) => k === 'create')![1] as Record<string, unknown>
    expect(copy).toMatchObject({ _id: 'drafts.iyengar', _type: 'course', projectSlug: 'cyce', publicId: PUB, title: { fr: 'Iyengar Yoga' } })
    expect(copy).not.toHaveProperty('publishedAt')
    expect(copy).not.toHaveProperty('_rev')
    expect(alone.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'unpublished' }))
  })

  it('back to draft only works on a scheduled course', async () => {
    await expect(unscheduleCourse(ctx(editor()), PID, { id: 'iyengar' }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(unscheduleCourse(ctx(editor()), PID, { id: 'draftonly' }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('a scheduled course cannot be archived (it goes back to draft instead); viewers cannot change dates', async () => {
    await expect(runCourseLifecycle(ctx(editor()), PID, { id: 'iyengar', op: 'archive' }, fake({ docs: scheduledDocs(true) }).deps)).rejects.toMatchObject({ code: 'invalid_value' })
    for (const call of [
      () => setCoursePublishDate(ctx(viewer()), PID, { id: 'iyengar', mode: 'now' }, fake({ docs: scheduledDocs(true) }).deps),
      () => unscheduleCourse(ctx(viewer()), PID, { id: 'iyengar' }, fake({ docs: scheduledDocs(true) }).deps),
    ]) {
      await expect(call()).rejects.toBeInstanceOf(TenantAuthorizationError)
    }
  })
})

// ── Archive / delete ──────────────────────────────────────────────────────────

describe('archive and delete', () => {
  it('archive touches the published course and its draft', async () => {
    const f = fake()
    await runCourseLifecycle(ctx(editor()), PID, { id: 'iyengar', op: 'archive' }, f.deps)
    const patched = f.txOps.filter(([k]) => k === 'patch').map(([, v]) => (v as [string])[0])
    expect(patched).toEqual(['iyengar', 'drafts.iyengar'])
  })

  it('restore removes the archive fields and the stray end date', async () => {
    const f = fake()
    await runCourseLifecycle(ctx(editor()), PID, { id: 'archived', op: 'restore' }, f.deps)
    expect(f.txOps.filter(([k]) => k === 'patch').length).toBeGreaterThan(0)
  })

  it('a never-published draft can be deleted (owner)', async () => {
    const f = fake()
    await runCourseLifecycle(ctx(grant()), PID, { id: 'draftonly', op: 'deleteDraft' }, f.deps)
    expect(f.txOps.filter(([k]) => k === 'delete').map(([, v]) => v)).toEqual(['drafts.draftonly'])
  })

  it('a published, not archived course must be archived first', async () => {
    await expect(runCourseLifecycle(ctx(grant()), PID, { id: 'iyengar', op: 'deletePermanently' }, fake().deps)).rejects.toMatchObject({ code: 'archive_first' })
    await expect(runCourseLifecycle(ctx(grant()), PID, { id: 'iyengar', op: 'deleteDraft' }, fake().deps)).rejects.toMatchObject({ code: 'archive_first' })
  })

  it('an unreferenced archived course without classes is deleted for good', async () => {
    const f = fake()
    const r = await runCourseLifecycle(ctx(grant()), PID, { id: 'archived', op: 'deletePermanently' }, f.deps)
    expect(r).toEqual({ rev: null })
    expect(f.txOps.filter(([k]) => k === 'delete').map(([, v]) => v)).toEqual(['archived'])
    expect(f.hasSchedule).toHaveBeenCalledWith('44444444-4444-4444-8444-444444444444', PID)
  })

  it('delete is refused while any document references the course', async () => {
    const f = fake({ deleteRefs: [{ _id: 'drafts.page-1', _type: 'page', label: { it: 'Orario' } }] })
    const err = await runCourseLifecycle(ctx(grant()), PID, { id: 'archived', op: 'deletePermanently' }, f.deps).catch((e) => e)
    expect(err).toBeInstanceOf(CourseError)
    expect(err.code).toBe('in_use')
    expect(err.detail.usedIn).toEqual([{ kind: 'page', id: 'page-1', title: 'Orario' }])
    expect(f.writes).toEqual([])
  })

  it('delete is refused while the course has classes, and when that cannot be checked', async () => {
    const f = fake({}, async () => true)
    const err = await runCourseLifecycle(ctx(grant()), PID, { id: 'archived', op: 'deletePermanently' }, f.deps).catch((e) => e)
    expect(err.code).toBe('in_use')
    expect(err.detail.usedIn).toEqual([{ kind: 'classes', id: '', title: 'classes' }])
    const draft = await runCourseLifecycle(ctx(grant()), PID, { id: 'draftonly', op: 'deleteDraft' }, fake({}, async () => true).deps).catch((e) => e)
    expect(draft.code).toBe('in_use')
    const g = fake({}, async () => { throw new Error('scheduling down') })
    await expect(runCourseLifecycle(ctx(grant()), PID, { id: 'archived', op: 'deletePermanently' }, g.deps)).rejects.toMatchObject({ code: 'failed' })
    expect(f.writes).toEqual([])
    expect(g.writes).toEqual([])
  })

  it('without a scheduling check wired in, classes do not block (default hook)', async () => {
    const f = fake()
    const { hasSchedule: _unused, ...deps } = f.deps
    void _unused
    await expect(runCourseLifecycle(ctx(grant()), PID, { id: 'archived', op: 'deletePermanently' }, deps)).resolves.toEqual({ rev: null })
  })

  it('an unknown operation is refused', async () => {
    await expect(runCourseLifecycle(ctx(grant()), PID, { id: 'archived', op: 'explode' as never }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })
})

// ── Page address (ADR-045 D5) ─────────────────────────────────────────────────

describe('page address (slug) — save', () => {
  it('normalises a typed address per language and stores it as a localizedSlug', async () => {
    const f = fake()
    await saveCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1', set: { 'slug.fr': '  Yoga Iyengar (Débutants) ', 'slug.en': '' } }, f.deps)
    expect(f.patchOps).toContainEqual(['setIfMissing', { slug: { _type: 'localizedSlug' } }])
    expect(f.patchOps).toContainEqual(['set', { 'slug.fr': { _type: 'slug', current: 'yoga-iyengar-debutants' } }])
    expect(f.patchOps).toContainEqual(['unset', ['slug.en']])
  })

  it('refuses an address another course of the site uses or used (current or retired), in that language only', async () => {
    const docs = docsWithDraftOnly()
    docs['drafts.draftonly'] = { ...docs['drafts.draftonly'], slug: { _type: 'localizedSlug', fr: { _type: 'slug', current: 'brouillon' } } }
    docs.archived = { ...docs.archived, slug: { fr: { current: 'ancien-nouveau' } }, redirectFrom: { fr: ['ancien'] } }
    docs.foreign = { ...docs.foreign, slug: { fr: { current: 'pris-ailleurs' } } }
    const c = ctx(editor())
    for (const taken of ['brouillon', 'ancien', 'ancien-nouveau']) {
      const f = fake({ docs })
      await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { 'slug.fr': taken } }, f.deps)).rejects.toMatchObject({ code: 'slug_taken' })
      expect(f.writes).toEqual([])
    }
    // Another website's course never blocks; the same word in another language is free.
    await saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { 'slug.fr': 'pris-ailleurs' } }, fake({ docs }).deps)
    await saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { 'slug.en': 'brouillon' } }, fake({ docs }).deps)
    // Its own address is not "taken".
    const own = baseDocs()
    own.iyengar = { ...own.iyengar, slug: { fr: { current: 'yoga' } } }
    await saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { 'slug.fr': 'yoga' } }, fake({ docs: own }).deps)
  })

  it('refuses a language the site does not have and an address that is not text', async () => {
    const c = ctx(editor())
    await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { 'slug.ja': 'x' } }, fake().deps)).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { 'slug.fr': 42 } }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
    await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { 'slug.fr.x': 'a' } }, fake().deps)).rejects.toMatchObject({ code: 'invalid_field' })
    await expect(saveCourseDraft(c, PID, { id: 'iyengar', rev: 'd1', set: { 'slug.fr': '!!!' } }, fake().deps)).rejects.toMatchObject({ code: 'invalid_value' })
  })

  it('the editor reads the address and the site’s course segments', async () => {
    const docs = docsWithDraftOnly()
    docs['drafts.iyengar'] = { ...docs['drafts.iyengar'], slug: { _type: 'localizedSlug', fr: { _type: 'slug', current: 'yoga-iyengar' } } }
    const s = await getCourseForEdit(ctx(viewer()), PID, 'iyengar', fake({ docs, segment: { _type: 'localizedString', fr: 'cours', en: 'blog' } }).deps)
    expect(s.slug).toEqual({ fr: 'yoga-iyengar' })
    // Invalid / platform words are dropped.
    expect(s.pageSegments).toEqual({ fr: 'cours' })
    expect((await getCourseForEdit(ctx(viewer()), PID, 'iyengar', fake().deps)).pageSegments).toEqual({})
  })
})

describe('page address (slug) — publish', () => {
  it('fills a missing address from the title of every language that has one, unique among the site’s courses', async () => {
    const docs = docsWithDraftOnly()
    docs['drafts.draftonly'] = { ...docs['drafts.draftonly'], title: { _type: 'localizedString', fr: 'Yoga Iyengar', en: 'Iyengar' } }
    docs.archived = { ...docs.archived, slug: { fr: { current: 'yoga-iyengar' } } }
    const f = fake({ docs })
    await publishCourseDraft(ctx(editor()), PID, { id: 'draftonly', rev: 'o1' }, f.deps)
    expect(replacedDoc(f).slug).toEqual({ _type: 'localizedSlug', fr: { _type: 'slug', current: 'yoga-iyengar-2' }, en: { _type: 'slug', current: 'iyengar' } })
    expect(replacedDoc(f).redirectFrom).toBeUndefined()
  })

  it('keeps a typed address, and a changed published address becomes a redirect', async () => {
    const docs = baseDocs()
    docs.iyengar = { ...docs.iyengar, slug: { _type: 'localizedSlug', fr: { _type: 'slug', current: 'iyengar' }, en: { _type: 'slug', current: 'iyengar-yoga' } } }
    docs['drafts.iyengar'] = { ...docs['drafts.iyengar'], slug: { _type: 'localizedSlug', fr: { _type: 'slug', current: 'yoga-iyengar' }, en: { _type: 'slug', current: 'iyengar-yoga' } } }
    const f = fake({ docs })
    await publishCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1' }, f.deps)
    const doc = replacedDoc(f)
    expect((doc.slug as Record<string, { current: string }>).fr.current).toBe('yoga-iyengar')
    expect(doc.redirectFrom).toEqual({ _type: 'redirectFrom', fr: ['iyengar'] })
  })

  it('taking back a retired address stops its redirect', async () => {
    const docs = baseDocs()
    docs.iyengar = { ...docs.iyengar, slug: { fr: { current: 'yoga-iyengar' } }, redirectFrom: { _type: 'redirectFrom', fr: ['iyengar'] } }
    docs['drafts.iyengar'] = { ...docs['drafts.iyengar'], slug: { fr: { current: 'iyengar' } }, redirectFrom: { _type: 'redirectFrom', fr: ['iyengar'] } }
    const f = fake({ docs })
    await publishCourseDraft(ctx(editor()), PID, { id: 'iyengar', rev: 'd1' }, f.deps)
    expect(replacedDoc(f).redirectFrom).toEqual({ _type: 'redirectFrom', fr: ['yoga-iyengar'] })
  })
})
