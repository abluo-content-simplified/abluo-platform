/**
 * ADR-040 §15 (R9) — the dashboard's Documents actions, through the REAL
 * permission resolver and the REAL assertModuleAction (via
 * authorizeDocumentsManagement): support visits (deny by default), the module
 * off, roles without `documents.document.manage` and ids from another project
 * are refused before anything changes; "Show on" is checked against the
 * project's pages read on the server.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash, randomUUID } from 'crypto'
import { resolveProjectPermissions } from '@/lib/authz/resolve'
import type { AccessRole } from '@/lib/authz/roles'
import type { ProjectGrant, TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'
import { createFakeStore, type FakeStore } from '@/lib/access/__tests__/fake-store'
import { createFakeFiles, pdfBytes, type FakeFiles } from '@/lib/access/__tests__/fake-files'

const access = vi.fn()
vi.mock('@/lib/api/project-action', () => ({ resolveProjectAction: (slug: unknown) => access(slug) }))
const h = vi.hoisted(() => ({ store: null as unknown as FakeStore, files: null as unknown as FakeFiles, opened: 0, pages: [] as unknown[] }))
vi.mock('@/lib/access/server', () => ({
  withSiteAccessStore: async (_reason: string, fn: (s: unknown, f: unknown) => Promise<unknown>) => {
    h.opened++
    return fn(h.store, h.files)
  },
  accessEnvironment: () => 'production',
}))
vi.mock('@/lib/sanity/client', async (orig) => ({
  ...((await orig()) as object),
  sanityClient: {
    fetch: async (query: string) => (query.includes('siteConfig') ? { defaultLocale: 'it', supportedLocales: ['it', 'en'] } : h.pages),
  },
}))

import {
  beginDocumentUploadAction,
  createDocumentAction,
  deleteDocumentsAction,
  setDocumentsArchivedAction,
  finishDocumentUploadAction,
  removeDocumentFromPageAction,
  setDocumentAccessAction,
  setDocumentArchivedAction,
  updateDocumentAction,
} from '../actions'

const P_A = randomUUID(), P_B = randomUUID()
function grant(projectId: string, role: AccessRole, modules = ['blog', 'documents', 'members']): ProjectGrant {
  return {
    projectId,
    projectSlug: asSupabaseProjectSlug(projectId === P_A ? 'site-a' : 'site-b'),
    membershipId: `m-${role}`,
    role,
    permissions: resolveProjectPermissions({ role, enabledModuleIds: modules }).permissions,
    enabledModuleIds: modules,
  }
}
function as(g: ProjectGrant, extra: Partial<TenantAuthorizationContext> = {}) {
  const ctx: TenantAuthorizationContext = { userId: 'u1', platformRole: 'tenant_user', projects: [g], ...extra }
  access.mockResolvedValue({ ok: true, ctx, grant: g })
}
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
let gA: string

beforeEach(async () => {
  vi.clearAllMocks()
  h.store = createFakeStore()
  h.files = createFakeFiles()
  gA = await h.store.createGroup(P_A, { name: { it: 'Genitori' }, description: null }, 'x')
  h.opened = 0
  h.pages = [
    { _id: 'contatti', pageType: 'landing', title: { it: 'Contatti' }, slug: { it: { current: 'contatti' } }, access: null, hasDownloadSection: true },
    { _id: 'genitori', pageType: 'landing', title: { it: 'Genitori' }, slug: { it: { current: 'genitori' } }, access: { visibility: 'restricted', groups: [gA] }, hasDownloadSection: true },
    { _id: 'chi-siamo', pageType: 'landing', title: { it: 'Chi siamo' }, slug: { it: { current: 'chi-siamo' } }, access: null, hasDownloadSection: false },
  ]
  as(grant(P_A, 'owner'))
})

const create = (over: Record<string, unknown> = {}) =>
  createDocumentAction({ projectSlug: 'site-a', title: 'Listino', note: '', visibility: 'everyone', groupIds: [], pageIds: ['contatti'], ...over } as never)

describe('who may act', () => {
  it('an Owner adds a public document shown on Contact; title stored in the site language', async () => {
    const r = await create()
    expect(r).toMatchObject({ ok: true })
    expect(h.store.docs[0]).toMatchObject({ projectId: P_A, title: { it: 'Listino' }, visibility: 'everyone' })
    expect(h.store.placements.map((p) => p.pageId)).toEqual(['contatti'])
  })
  it('a support visit is refused before the store is even opened — deny by default, even with live-edit approval', async () => {
    as(grant(P_A, 'owner'), { support: { mode: 'live_edit' } as never })
    expect(await create()).toEqual({ ok: false, error: 'support_mode' })
    expect(await setDocumentArchivedAction({ projectSlug: 'site-a', documentId: randomUUID(), archived: true })).toEqual({ ok: false, error: 'support_mode' })
    expect(h.opened).toBe(0)
    expect(h.store.docs).toHaveLength(0)
  })
  it('with the Documents module off, nothing can be managed', async () => {
    as(grant(P_A, 'owner', ['blog', 'members']))
    expect(await create()).toEqual({ ok: false, error: 'forbidden' })
    expect(h.store.docs).toHaveLength(0)
  })
  it('an Editor without the "manage documents" extra is forbidden', async () => {
    as(grant(P_A, 'editor'))
    expect(await create()).toEqual({ ok: false, error: 'forbidden' })
  })
  it('without Access, groups cannot be chosen — public documents still can', async () => {
    as(grant(P_A, 'owner', ['documents']))
    expect(await create({ visibility: 'groups', groupIds: [gA], pageIds: ['genitori'] })).toEqual({ ok: false, error: 'groups_unavailable' })
    expect((await create()).ok).toBe(true)
  })
})

describe('Show on — checked on the server against the pages', () => {
  it('no mixing: a members-only document is refused on the public Contact page', async () => {
    expect(await create({ visibility: 'groups', groupIds: [gA], pageIds: ['contatti'] })).toEqual({ ok: false, error: 'page_does_not_fit' })
    expect(h.store.docs).toHaveLength(0)
    expect((await create({ visibility: 'groups', groupIds: [gA], pageIds: ['genitori'] })).ok).toBe(true)
  })
  it('a page without a Download section cannot be chosen', async () => {
    expect(await create({ pageIds: ['chi-siamo'] })).toEqual({ ok: false, error: 'page_without_section' })
  })
  it('changing who can open it re-checks the pages', async () => {
    const r = (await create()) as { ok: true; documentId: string }
    expect(await setDocumentAccessAction({ projectSlug: 'site-a', documentId: r.documentId, visibility: 'groups', groupIds: [gA], pageIds: ['contatti'] })).toEqual({ ok: false, error: 'page_does_not_fit' })
    expect(await setDocumentAccessAction({ projectSlug: 'site-a', documentId: r.documentId, visibility: 'groups', groupIds: [gA], pageIds: ['genitori'] })).toEqual({ ok: true })
    expect(await removeDocumentFromPageAction({ projectSlug: 'site-a', documentId: r.documentId, pageId: 'genitori' })).toEqual({ ok: true })
    expect(h.store.placements).toHaveLength(0)
  })
})

describe('tenant isolation', () => {
  it('ids from another project are not found; groups from another project are refused', async () => {
    const r = (await create()) as { ok: true; documentId: string }
    as(grant(P_B, 'owner'))
    expect((await updateDocumentAction({ projectSlug: 'site-b', documentId: r.documentId, title: 'stolen', note: '' })).ok).toBe(false)
    expect((await setDocumentArchivedAction({ projectSlug: 'site-b', documentId: r.documentId, archived: true })).ok).toBe(false)
    expect((await create({ projectSlug: 'site-b', visibility: 'groups', groupIds: [gA], pageIds: [] })).ok).toBe(false)
    expect(h.store.docs[0]).toMatchObject({ title: { it: 'Listino' }, archivedAt: null })
  })
})

describe('uploads', () => {
  it('a valid PDF for both languages is accepted; another project cannot finish it', async () => {
    const d = ((await create()) as { documentId: string }).documentId
    const bytes = pdfBytes(5000)
    const begun = (await beginDocumentUploadAction({ projectSlug: 'site-a', documentId: d, locales: ['it', 'en'], mimeType: 'application/pdf', sizeBytes: bytes.length, sha256: sha(bytes), filename: 'listino.pdf' })) as { ok: true; ticket: { uploadId: string } }
    expect(Object.keys(begun.ticket).sort()).toEqual(['expiresAt', 'signedUrl', 'token', 'uploadId'])
    h.files.objects.set(h.files.uploadsSigned.at(-1)!, bytes)
    as(grant(P_B, 'owner'))
    expect(await finishDocumentUploadAction({ projectSlug: 'site-b', uploadId: begun.ticket.uploadId })).toEqual({ ok: false, error: 'not_found' })
    as(grant(P_A, 'owner'))
    expect(await finishDocumentUploadAction({ projectSlug: 'site-a', uploadId: begun.ticket.uploadId })).toEqual({ ok: true, result: { ok: true, replaced: false } })
    expect(h.store.files.map((f) => f.locale).sort()).toEqual(['en', 'it'])
  })
  it('a language the site does not have, a type not allowed, or a file too large is refused before any upload URL', async () => {
    const d = ((await create()) as { documentId: string }).documentId
    const base = { projectSlug: 'site-a', documentId: d, locales: ['it'], mimeType: 'application/pdf', sizeBytes: 100, sha256: 'a'.repeat(64), filename: 'x.pdf' }
    expect(await beginDocumentUploadAction({ ...base, locales: ['de'] })).toEqual({ ok: false, error: 'locales_needed' })
    expect(await beginDocumentUploadAction({ ...base, mimeType: 'image/svg+xml' })).toEqual({ ok: false, error: 'file_type' })
    expect(await beginDocumentUploadAction({ ...base, mimeType: 'image/png', sizeBytes: 10 * 1024 * 1024 + 1 })).toEqual({ ok: false, error: 'file_too_large' })
    expect(h.files.uploadsSigned).toHaveLength(0)
  })
})

describe('several at once, and deleting for good (R9.3)', () => {
  it('an Owner archives several, then deletes them for good; not-archived ones are refused', async () => {
    const a = ((await create()) as { documentId: string }).documentId
    const b = ((await create({ title: 'Orario' })) as { documentId: string }).documentId
    expect(await deleteDocumentsAction({ projectSlug: 'site-a', documentIds: [a, b] })).toEqual({ ok: false, error: 'not_archived' })
    expect(await setDocumentsArchivedAction({ projectSlug: 'site-a', documentIds: [a, b], archived: true })).toEqual({ ok: true, changed: 2 })
    expect(await deleteDocumentsAction({ projectSlug: 'site-a', documentIds: [a, b] })).toEqual({ ok: true, deleted: 2 })
    expect(h.store.docs).toHaveLength(0)
  })
  it('an Editor with "manage documents" may archive but never delete; support never; another project never', async () => {
    const a = ((await create()) as { documentId: string }).documentId
    await setDocumentsArchivedAction({ projectSlug: 'site-a', documentIds: [a], archived: true })
    const editor = grant(P_A, 'editor')
    editor.permissions = [...editor.permissions, 'documents.document.read', 'documents.document.manage']
    as(editor)
    expect(await setDocumentsArchivedAction({ projectSlug: 'site-a', documentIds: [a], archived: false })).toMatchObject({ ok: true })
    await setDocumentsArchivedAction({ projectSlug: 'site-a', documentIds: [a], archived: true })
    expect(await deleteDocumentsAction({ projectSlug: 'site-a', documentIds: [a] })).toEqual({ ok: false, error: 'forbidden' })
    as(grant(P_A, 'owner'), { support: { mode: 'live_edit' } as never })
    expect(await deleteDocumentsAction({ projectSlug: 'site-a', documentIds: [a] })).toEqual({ ok: false, error: 'support_mode' })
    as(grant(P_B, 'owner'))
    expect((await deleteDocumentsAction({ projectSlug: 'site-b', documentIds: [a] })).ok).toBe(false)
    expect(h.store.docs).toHaveLength(1)
  })
})
