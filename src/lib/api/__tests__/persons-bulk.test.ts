/**
 * People list — bulk changes and completeness (ADR-043 D8). Permission before
 * any I/O, cross-project ids refused for the whole call before any write,
 * archived / anonymised / unchanged people skipped, per-person partial failure,
 * published + draft patched without publishing, audit on refusal.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/sanity/server-clients', () => ({ sanityWriteClient: {} }))

import { bulkUpdatePersons, listPersons, PERSON_BULK_QUERY, PERSON_LIST_QUERY, personMissing } from '../persons'
import { TenantAuthorizationError } from '../tenant-scoped-sanity'
import type { ProjectGrant, TenantAuthorizationContext } from '../tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

const PID = '11111111-1111-4111-8111-111111111111'
const ALL = ['people.person.read', 'people.person.write', 'people.person.archive', 'people.person.anonymise', 'people.person.delete']
const grant = (o: Partial<ProjectGrant> = {}): ProjectGrant => ({ projectId: PID, projectSlug: asSupabaseProjectSlug('cyce'), membershipId: 'm1', role: 'owner', permissions: ALL, enabledModuleIds: ['people'], ...o })
const editor = () => grant({ role: 'editor', permissions: ['people.person.read', 'people.person.write'] })
const viewer = () => grant({ role: 'viewer', permissions: ['people.person.read'] })
const ctx = (g: ProjectGrant): TenantAuthorizationContext => ({ userId: 'u1', platformRole: 'tenant_user', projects: [g] })

type Docs = Record<string, Record<string, unknown>>
const person = (id: string, over: Record<string, unknown> = {}) => ({ _id: id, _type: 'person', _rev: `r-${id}`, projectSlug: 'cyce', publicId: `00000000-0000-4000-8000-00000000000${id.length}`, firstName: id, lastName: 'X', visibility: 'listed', groups: [], ...over })
const baseDocs = (): Docs => ({
  anna: person('anna', { groups: ['teachers'] }),
  'drafts.anna': person('drafts.anna', { _rev: 'd-anna', groups: ['teachers', 'board'], visibility: 'off' }),
  bob: person('bob', { visibility: 'off' }),
  carl: person('carl'),
  'drafts.carl': person('drafts.carl', { _rev: 'd-carl' }),
  drafty: person('drafts.drafty', { _id: 'drafts.drafty', _rev: 'd-drafty' }),
  arch: person('arch', { archivedAt: '2026-10-01T00:00:00Z' }),
  anon: person('anon', { anonymisedAt: '2026-10-01T00:00:00Z', visibility: 'off' }),
  foreign: person('foreign', { projectSlug: 'livener' }),
})

function fake(docs: Docs = baseDocs(), opts: { failTx?: (ids: string[]) => unknown; terms?: string[] } = {}) {
  const txs: Array<Array<[string, unknown]>> = []
  const fetch = vi.fn(async (q: string, p: Record<string, unknown> = {}) => {
    if (q.includes('count(*[_type == "project"')) return 1
    if (q === PERSON_BULK_QUERY) {
      return Object.values(docs).filter((d) => d.projectSlug === p.projectSlug && ((p.ids as string[]).includes(String(d._id)) || (p.draftIds as string[]).includes(String(d._id))))
    }
    if (q.includes('_type == "taxonomyTerm"')) return (p.keys as string[]).filter((k) => (opts.terms ?? ['teachers', 'board']).includes(k))
    if (q.includes('_type == "siteConfig"')) return { defaultLocale: 'it', supportedLocales: ['it', 'de'] }
    if (q === PERSON_LIST_QUERY) return Object.values(docs).filter((d) => d.projectSlug === p.projectSlug)
    return []
  })
  const transaction = vi.fn(() => {
    const ops: Array<[string, unknown]> = []
    const tx = {
      patch: (id: string, v: unknown) => (ops.push(['patch', [id, v]]), tx),
      commit: vi.fn(async () => {
        const ids = ops.map(([, v]) => (v as [string])[0])
        const err = opts.failTx?.(ids)
        if (err) throw err
        txs.push(ops)
        return { transactionId: 'tx' }
      }),
    }
    return tx
  })
  const audit = vi.fn(async (_entry: { contentId: string; outcome: string }) => undefined)
  const client = { getDocument: vi.fn(async (id: string) => docs[id]), fetch, create: vi.fn(), patch: vi.fn(), transaction }
  return { client, fetch, txs, audit, deps: { client: client as never, audit, scheduleUsage: async () => new Map() } }
}
const sets = (f: ReturnType<typeof fake>) => f.txs.flat().map(([, v]) => v as [string, { set: Record<string, unknown>; ifRevisionID: string }])

describe('bulkUpdatePersons — gates (before any I/O)', () => {
  it('needs write for groups / show / hide and archive for archive', async () => {
    for (const [g, op, ok] of [
      [viewer(), 'hide', false],
      [viewer(), 'addGroup', false],
      [editor(), 'archive', false],
      [editor(), 'hide', true],
    ] as const) {
      const f = fake()
      const call = bulkUpdatePersons(ctx(g), PID, { ids: ['carl'], op, group: 'teachers' }, f.deps)
      if (ok) await expect(call).resolves.toBeDefined()
      else {
        await expect(call).rejects.toBeInstanceOf(TenantAuthorizationError)
        expect(f.fetch).not.toHaveBeenCalled()
        expect(f.client.transaction).not.toHaveBeenCalled()
      }
    }
  })
  it('refuses a project without the People module', async () => {
    const f = fake()
    await expect(bulkUpdatePersons(ctx(grant({ enabledModuleIds: [] })), PID, { ids: ['carl'], op: 'hide' }, f.deps)).rejects.toBeInstanceOf(TenantAuthorizationError)
    expect(f.fetch).not.toHaveBeenCalled()
  })
  it('rejects bad input before reading', async () => {
    const f = fake()
    const bad = [
      { ids: [], op: 'hide' },
      { ids: ['carl', 'carl'], op: 'hide' },
      { ids: ['../x'], op: 'hide' },
      { ids: ['carl'], op: 'delete' },
      { ids: ['carl'], op: 'addGroup' },
      { ids: ['carl'], op: 'addGroup', group: 'Not A Key!' },
      { ids: Array.from({ length: 101 }, (_, i) => `p${i}`), op: 'hide' },
    ]
    for (const input of bad) await expect(bulkUpdatePersons(ctx(grant()), PID, input as never, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.fetch).not.toHaveBeenCalled()
  })
})

describe('bulkUpdatePersons — cross-project', () => {
  it('a foreign or unknown id refuses the whole call, nothing is written', async () => {
    for (const bad of ['foreign', 'nobody']) {
      const f = fake()
      await expect(bulkUpdatePersons(ctx(grant()), PID, { ids: ['carl', bad], op: 'hide' }, f.deps)).rejects.toMatchObject({ code: 'not_found' })
      expect(f.client.transaction).not.toHaveBeenCalled()
    }
  })
  it('an unknown group is refused before any write', async () => {
    const f = fake(baseDocs(), { terms: [] })
    await expect(bulkUpdatePersons(ctx(grant()), PID, { ids: ['carl'], op: 'addGroup', group: 'teachers' }, f.deps)).rejects.toMatchObject({ code: 'invalid_value' })
    expect(f.client.transaction).not.toHaveBeenCalled()
  })
})

describe('bulkUpdatePersons — rules', () => {
  it('skips archived and anonymised people, counts unchanged ones', async () => {
    const f = fake()
    const r = await bulkUpdatePersons(ctx(grant()), PID, { ids: ['arch', 'anon', 'bob', 'carl'], op: 'hide' }, f.deps)
    expect(r.changed).toEqual(['carl'])
    expect(r.skipped).toEqual([{ id: 'arch', reason: 'archived' }, { id: 'anon', reason: 'anonymised' }, { id: 'bob', reason: 'unchanged' }])
    expect(r.failed).toEqual([])
  })
  it('hide patches the published person AND its draft, without publishing; revision-guarded', async () => {
    const f = fake()
    await bulkUpdatePersons(ctx(grant()), PID, { ids: ['carl'], op: 'hide' }, f.deps)
    expect(sets(f)).toEqual([
      ['carl', { ifRevisionID: 'r-carl', set: { visibility: 'off' } }],
      ['drafts.carl', { ifRevisionID: 'd-carl', set: { visibility: 'off' } }],
    ])
  })
  it('a never-published person changes in the draft only', async () => {
    const f = fake()
    const r = await bulkUpdatePersons(ctx(grant()), PID, { ids: ['drafty'], op: 'hide' }, f.deps)
    expect(r.changed).toEqual(['drafty'])
    expect(sets(f).map(([id]) => id)).toEqual(['drafts.drafty'])
  })
  it('show only changes hidden people (listed / page stay as they are)', async () => {
    const f = fake()
    const r = await bulkUpdatePersons(ctx(grant()), PID, { ids: ['bob', 'carl'], op: 'show' }, f.deps)
    expect(r.changed).toEqual(['bob'])
    expect(r.skipped).toEqual([{ id: 'carl', reason: 'unchanged' }])
    expect(sets(f)).toEqual([['bob', { ifRevisionID: 'r-bob', set: { visibility: 'listed' } }]])
  })
  it('add / remove group work per document and skip people already in the wanted state', async () => {
    const f = fake()
    const add = await bulkUpdatePersons(ctx(grant()), PID, { ids: ['anna', 'carl'], op: 'addGroup', group: 'board' }, f.deps)
    expect(add.changed).toEqual(['anna', 'carl'])
    expect(sets(f).find(([id]) => id === 'anna')![1].set).toEqual({ groups: ['teachers', 'board'] })
    expect(sets(f).find(([id]) => id === 'drafts.anna')).toBeUndefined() // the draft already has it
    const g = fake()
    const rem = await bulkUpdatePersons(ctx(grant()), PID, { ids: ['anna', 'carl'], op: 'removeGroup', group: 'board' }, g.deps)
    expect(rem.changed).toEqual(['anna'])
    expect(rem.skipped).toEqual([{ id: 'carl', reason: 'unchanged' }])
    expect(sets(g)).toEqual([['drafts.anna', { ifRevisionID: 'd-anna', set: { groups: ['teachers'] } }]])
  })
  it('archive: published people only, through the lifecycle service', async () => {
    const f = fake()
    const r = await bulkUpdatePersons(ctx(grant()), PID, { ids: ['drafty', 'arch'], op: 'archive' }, f.deps)
    expect(r.changed).toEqual([])
    expect(r.skipped).toEqual([{ id: 'drafty', reason: 'unpublished' }, { id: 'arch', reason: 'archived' }])
    expect(f.client.transaction).not.toHaveBeenCalled()
  })
})

describe('bulkUpdatePersons — partial failure and audit', () => {
  it('one conflict does not stop the others and is reported with its code', async () => {
    const f = fake(baseDocs(), { failTx: (ids) => (ids.includes('carl') ? { statusCode: 409 } : null) })
    const r = await bulkUpdatePersons(ctx(grant()), PID, { ids: ['carl', 'anna'], op: 'hide' }, f.deps)
    expect(r.failed).toEqual([{ id: 'carl', code: 'conflict' }])
    expect(r.changed).toEqual(['anna'])
  })
  it('a failed write is audited as failed for that person; success records no lifecycle row', async () => {
    const f = fake(baseDocs(), { failTx: (ids) => (ids.includes('carl') ? new Error('boom') : null) })
    const r = await bulkUpdatePersons(ctx(grant()), PID, { ids: ['carl', 'anna'], op: 'hide' }, f.deps)
    expect(r.failed).toEqual([{ id: 'carl', code: 'failed' }])
    const rows = f.audit.mock.calls.map((c) => c[0])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ contentId: 'carl', outcome: 'failed' })
  })
})

describe('list completeness', () => {
  const site = { defaultLocale: 'it', languages: ['it', 'de', 'fr'] }
  const loc = (o: Record<string, string>) => ({ _type: 'localizedString', ...o })
  it('flags a missing photo and a missing short bio in the main language', () => {
    expect(personMissing({ photoUrl: null, jobTitle: loc({}), shortBio: loc({}) }, site, false)).toEqual({ photo: true, shortBio: true, languages: [] })
    expect(personMissing({ photoUrl: 'https://x/y.jpg', shortBio: loc({ it: 'Ciao' }) }, site, false)).toMatchObject({ photo: false, shortBio: false })
    expect(personMissing({ photoUrl: 'u', shortBio: loc({ it: '   ' }) }, site, false).shortBio).toBe(true)
  })
  it('lists the other languages where the title or short bio is still missing', () => {
    const row = { photoUrl: 'u', jobTitle: loc({ it: 'Insegnante', de: 'Lehrerin' }), shortBio: loc({ it: 'Ciao', de: 'Hallo', fr: 'Salut' }) }
    expect(personMissing(row, site, false).languages).toEqual(['fr']) // title missing in fr
    expect(personMissing({ photoUrl: 'u', jobTitle: loc({ it: 'A', de: 'B', fr: 'C' }), shortBio: loc({ it: 'a', fr: 'c' }) }, site, false).languages).toEqual(['de'])
  })
  it('does not ask for translations of something that does not exist in the main language', () => {
    expect(personMissing({ photoUrl: 'u', jobTitle: loc({ de: 'Lehrerin' }), shortBio: loc({ de: 'Hallo' }) }, site, false).languages).toEqual([])
  })
  it('nothing is missing for an anonymised person', () => {
    expect(personMissing({}, site, true)).toEqual({ photo: false, shortBio: false, languages: [] })
  })
  it('listPersons carries it on every item (anonymised: nothing)', async () => {
    const docs = baseDocs()
    docs['drafts.anna'] = { ...docs['drafts.anna'], shortBio: { _type: 'localizedText', it: 'Ciao' } } // the list shows the draft's values
    const f = fake(docs)
    const { persons } = await listPersons(ctx(grant()), PID, f.deps)
    expect(persons.find((p) => p.id === 'anna')!.missing).toEqual({ photo: true, shortBio: false, languages: ['de'] })
    expect(persons.find((p) => p.id === 'anon')!.missing).toEqual({ photo: false, shortBio: false, languages: [] })
    expect(persons.every((p) => p.missing && typeof p.missing.photo === 'boolean')).toBe(true)
  })
})
