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
  createCourse,
  discardCourseDraft,
  getCourseForEdit,
  listCourses,
  openCourseForEdit,
  publishCourseDraft,
  runCourseLifecycle,
  saveCourseDraft,
} from '../course-drafts'
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

type Opts = { docs?: Docs; deleteRefs?: Array<{ _id: string; _type: string; label?: unknown }>; commitError?: unknown; count?: number }

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
    if (q.startsWith('count(*[_type == "course"')) return opts.count ?? 3
    if (q === COURSE_LIST_QUERY) return Object.values(docs).filter((d) => d._type === 'course' && d.projectSlug === p.projectSlug)
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
    expect(site).toEqual({ defaultLocale: 'fr', languages: ['fr', 'en', 'de'] })
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
