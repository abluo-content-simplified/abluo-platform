/**
 * ADR-040 B2.4 / R9 — the Documents module's management plane: who can open a
 * document (everyone or groups), where it shows ("Show on", checked against
 * the pages), languages, direct-to-storage uploads with server-side checks for
 * every allowed type, and the daily sweep that never removes an active file.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createHash, randomUUID } from 'crypto'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { AccessError } from '../model'
import {
  beginDocumentFileUpload, createDocumentWithPlacements, finishDocumentFileUpload, listDocumentsForDashboard, removeDocumentFromPage,
  removeDocumentLanguages, reorderPageDocuments, setDocumentAccessAndPlacements, setDocumentArchivedState, updateDocumentDetails,
  setDocumentsArchivedState, deleteDocumentsForGood,
  type DocumentsGrant,
} from '../documents'
import type { DownloadPage } from '../download-pages'
import { sweepSiteAccessFiles } from '../sweep'
import { createFakeStore, type FakeStore } from './fake-store'
import { createFakeFiles, pdfBytes, type FakeFiles } from './fake-files'

const A = randomUUID(), B = randomUUID()
const SITE = ['en', 'it'] as const
// A grant is normally minted by authorizeDocumentsManagement(); the brand is a type-level guard only.
const grant = (projectId: string, level: 'read' | 'manage' = 'manage', groupsAvailable = true) =>
  Object.freeze({ projectId, actorUserId: randomUUID(), level, groupsAvailable }) as unknown as DocumentsGrant
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

let store: FakeStore, files: FakeFiles, gA: string, gA2: string, gB: string, doc: string, pages: DownloadPage[]
beforeEach(async () => {
  store = createFakeStore(); files = createFakeFiles()
  gA = await store.createGroup(A, { name: { en: 'Members' }, description: null }, 'x')
  gA2 = await store.createGroup(A, { name: { en: 'Board' }, description: null }, 'x')
  gB = await store.createGroup(B, { name: { en: 'Members' }, description: null }, 'x')
  pages = [
    { id: 'contact', title: 'Contact', path: 'contact', isHome: false, restricted: false, groupIds: [] },
    { id: 'members', title: 'Members', path: 'members', isHome: false, restricted: true, groupIds: [gA] },
    { id: 'board', title: 'Board', path: 'board', isHome: false, restricted: true, groupIds: [gA2] },
  ]
  doc = await createDocumentWithPlacements(store, grant(A), { title: { en: 'Timetable' }, visibility: 'groups', groupIds: [gA], pageIds: ['members'] }, pages)
})
const row = async (id = doc, projectId = A) => (await listDocumentsForDashboard(store, grant(projectId, 'read'))).find((d) => d.id === id)

async function uploadVia(bytes: Uint8Array, opts: { declaredSize?: number; declaredSha?: string; projectId?: string; locales?: string[]; mimeType?: string } = {}) {
  const t = await beginDocumentFileUpload(store, files, grant(opts.projectId ?? A), {
    documentId: doc, locales: opts.locales ?? ['en'], mimeType: opts.mimeType ?? 'application/pdf',
    sizeBytes: opts.declaredSize ?? bytes.length, sha256: opts.declaredSha ?? sha(bytes), filename: 'C:\\x\\orario.pdf',
  }, SITE)
  const path = files.uploadsSigned.at(-1)!
  files.objects.set(path, bytes) // the browser PUTs to the signed URL
  return { t, path }
}

describe('who can open it, and where it shows', () => {
  it('a group document: only this project\'s live groups; groups require at least one', async () => {
    await expect(createDocumentWithPlacements(store, grant(A), { title: { en: 'x' }, visibility: 'groups', groupIds: [gB] }, pages)).rejects.toThrow(AccessError)
    await expect(createDocumentWithPlacements(store, grant(A), { title: { en: 'x' }, visibility: 'groups', groupIds: [] }, pages)).rejects.toThrow(AccessError)
    expect(await row()).toMatchObject({ visibility: 'groups', groupIds: [gA], pageIds: ['members'] })
  })
  it('without the Access module there are no groups: only "everyone" is accepted', async () => {
    await expect(createDocumentWithPlacements(store, grant(A, 'manage', false), { title: { en: 'x' }, visibility: 'groups', groupIds: [gA] }, pages)).rejects.toThrow(/groups_unavailable/)
    const id = await createDocumentWithPlacements(store, grant(A, 'manage', false), { title: { en: 'Price list' }, visibility: 'everyone', pageIds: ['contact'] }, pages)
    expect(await row(id)).toMatchObject({ visibility: 'everyone', groupIds: [], pageIds: ['contact'] })
  })
  it('no mixing: a group document never goes on a public page or a page for other groups', async () => {
    for (const pageIds of [['contact'], ['board']]) {
      await expect(createDocumentWithPlacements(store, grant(A), { title: { en: 'x' }, visibility: 'groups', groupIds: [gA], pageIds }, pages)).rejects.toThrow(/page_does_not_fit/)
    }
    // a public document fits public and protected pages
    const pub = await createDocumentWithPlacements(store, grant(A), { title: { en: 'Price list' }, visibility: 'everyone', pageIds: ['contact', 'members'] }, pages)
    expect((await row(pub))?.pageIds.sort()).toEqual(['contact', 'members'])
  })
  it('only pages with a Download section can be chosen', async () => {
    await expect(createDocumentWithPlacements(store, grant(A), { title: { en: 'x' }, visibility: 'everyone', pageIds: ['about'] }, pages)).rejects.toThrow(AccessError)
  })
  it('making a public document members-only takes it off pages it no longer fits — in the same save', async () => {
    const pub = await createDocumentWithPlacements(store, grant(A), { title: { en: 'Price list' }, visibility: 'everyone', pageIds: ['contact'] }, pages)
    await expect(setDocumentAccessAndPlacements(store, grant(A), pub, { visibility: 'groups', groupIds: [gA], pageIds: ['contact'] }, pages)).rejects.toThrow(/page_does_not_fit/)
    expect(await row(pub)).toMatchObject({ visibility: 'everyone', pageIds: ['contact'] }) // nothing changed
    await setDocumentAccessAndPlacements(store, grant(A), pub, { visibility: 'groups', groupIds: [gA], pageIds: ['members'] }, pages)
    expect(await row(pub)).toMatchObject({ visibility: 'groups', groupIds: [gA], pageIds: ['members'] })
  })
  it('order on a page, and removing from a page, keep the document', async () => {
    const two = await createDocumentWithPlacements(store, grant(A), { title: { en: 'Second' }, visibility: 'groups', groupIds: [gA], pageIds: ['members'] }, pages)
    await reorderPageDocuments(store, grant(A), 'members', [two, doc], pages)
    expect((await row(two))?.pageOrder.members).toBeLessThan((await row(doc))!.pageOrder.members)
    await removeDocumentFromPage(store, grant(A), two, 'members')
    expect(await row(two)).toMatchObject({ pageIds: [], archivedAt: null })
  })
  it('archiving takes it off every page; restoring does not put it back', async () => {
    await setDocumentArchivedState(store, grant(A), doc, true)
    expect(await row()).toMatchObject({ pageIds: [] })
    await setDocumentArchivedState(store, grant(A), doc, false)
    expect(await row()).toMatchObject({ pageIds: [], archivedAt: null })
  })
  it('details: title required, note at most 200 characters', async () => {
    await expect(updateDocumentDetails(store, grant(A), doc, { title: { en: ' ' } })).rejects.toThrow(AccessError)
    await expect(updateDocumentDetails(store, grant(A), doc, { title: { en: 'x' }, note: { en: 'n'.repeat(201) } })).rejects.toThrow(/note_too_long/)
    await updateDocumentDetails(store, grant(A), doc, { title: { en: 'Timetable 2027' }, note: { en: 'Valid from March' } })
    expect(await row()).toMatchObject({ title: { en: 'Timetable 2027' }, note: { en: 'Valid from March' } })
  })
  it('read grants and other projects cannot change anything', async () => {
    await expect(createDocumentWithPlacements(store, grant(A, 'read'), { title: { en: 'x' }, visibility: 'everyone' }, pages)).rejects.toThrow()
    await expect(setDocumentArchivedState(store, grant(B), doc, true)).rejects.toThrow(AccessError)
    await expect(updateDocumentDetails(store, grant(B), doc, { title: { en: 'stolen' } })).rejects.toThrow(AccessError)
    expect(await row()).toMatchObject({ title: { en: 'Timetable' }, archivedAt: null })
  })
})

describe('languages', () => {
  it('one file for several languages is stored once; removing a language never removes the last one', async () => {
    const { t, path } = await uploadVia(pdfBytes(2048), { locales: ['en', 'it'] })
    expect(await finishDocumentFileUpload(store, files, grant(A), t.uploadId)).toEqual({ ok: true, replaced: false })
    expect(store.files.map((f) => [f.locale, f.storagePath]).sort()).toEqual([['en', path], ['it', path]])
    expect(await removeDocumentLanguages(store, grant(A), doc, ['it'], SITE)).toBe(1)
    expect(store.trash.map((x) => x.storagePath)).not.toContain(path) // still used by English
    await expect(removeDocumentLanguages(store, grant(A), doc, ['en'], SITE)).rejects.toThrow(/last_language/)
  })
  it('a language the site does not have is refused', async () => {
    await expect(uploadVia(pdfBytes(1024), { locales: ['de'] })).rejects.toThrow(AccessError)
    await expect(uploadVia(pdfBytes(1024), { locales: [] })).rejects.toThrow(AccessError)
  })
})

describe('direct-to-storage upload', () => {
  it('the path is chosen by the database, project-prefixed, with the type\'s extension; storage signs exactly that path', async () => {
    const { path } = await uploadVia(pdfBytes(2048))
    expect(path).toMatch(new RegExp(`^${A}/[0-9a-f-]{36}\\.pdf$`))
    expect(store.uploads.at(-1)!.filename).toBe('orario.pdf')
  })
  it.each([
    ['a type that is not allowed (SVG)', { mimeType: 'image/svg+xml' }],
    ['an Office file', { mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }],
    ['a PDF over 20 MB', { sizeBytes: 20 * 1024 * 1024 + 1 }],
    ['an image over 10 MB', { mimeType: 'image/png', sizeBytes: 10 * 1024 * 1024 + 1 }],
    ['a zero size', { sizeBytes: 0 }],
    ['a malformed hash', { sha256: 'abc' }],
    ['a malformed document id', { documentId: 'nope' }],
  ])('refuses %s before reserving anything', async (_n, over) => {
    await expect(beginDocumentFileUpload(store, files, grant(A), { documentId: doc, locales: ['en'], mimeType: 'application/pdf', sizeBytes: 10, sha256: 'a'.repeat(64), ...over }, SITE)).rejects.toThrow(AccessError)
    expect(store.uploads).toHaveLength(0)
    expect(files.uploadsSigned).toHaveLength(0)
  })
  it('another project cannot upload to this document', async () => {
    await expect(beginDocumentFileUpload(store, files, grant(B), { documentId: doc, locales: ['en'], mimeType: 'application/pdf', sizeBytes: 10, sha256: 'a'.repeat(64) }, SITE)).rejects.toThrow(AccessError)
  })
  it('finish: a valid PDF becomes the document\'s file', async () => {
    const bytes = pdfBytes(4096)
    const { t } = await uploadVia(bytes)
    expect(await finishDocumentFileUpload(store, files, grant(A), t.uploadId)).toEqual({ ok: true, replaced: false })
    expect(store.files).toHaveLength(1)
    expect(store.files[0]).toMatchObject({ locale: 'en', sizeBytes: 4096, sha256: sha(bytes), mimeType: 'application/pdf' })
  })
  it('finish before the browser has finished uploading → retry allowed, nothing failed', async () => {
    const t = await beginDocumentFileUpload(store, files, grant(A), { documentId: doc, locales: ['en'], mimeType: 'application/pdf', sizeBytes: 4096, sha256: 'a'.repeat(64) }, SITE)
    expect(await finishDocumentFileUpload(store, files, grant(A), t.uploadId)).toEqual({ ok: false, problem: 'not_uploaded_yet' })
    expect(store.uploads[0].status).toBe('pending')
  })
  it.each([
    ['not what it says (HTML declared as PDF)', () => new TextEncoder().encode('<html>hello</html>'), 'wrong_type', 'application/pdf'],
    ['a PDF declared as an image', () => pdfBytes(4096), 'wrong_type', 'image/png'],
    ['size differs from the declaration', () => pdfBytes(4096), 'size_mismatch', 'application/pdf'],
    ['content differs from the declared hash (corrupted / swapped)', () => pdfBytes(4096), 'hash_mismatch', 'application/pdf'],
  ] as const)('%s → refused, upload failed, object queued for removal', async (name, make, problem, mimeType) => {
    const bytes = make()
    const { t, path } = await uploadVia(bytes, {
      mimeType,
      declaredSize: problem === 'size_mismatch' ? bytes.length + 1 : bytes.length,
      declaredSha: problem === 'hash_mismatch' ? 'b'.repeat(64) : undefined,
    })
    expect(await finishDocumentFileUpload(store, files, grant(A), t.uploadId), name).toEqual({ ok: false, problem })
    expect(store.files).toHaveLength(0)
    expect(store.uploads[0].status).toBe('failed')
    expect(store.trash.map((x) => x.storagePath)).toContain(path)
  })
  it('an object larger than allowed in storage is refused', async () => {
    const t = await beginDocumentFileUpload(store, files, grant(A), { documentId: doc, locales: ['en'], mimeType: 'application/pdf', sizeBytes: 1024, sha256: 'a'.repeat(64) }, SITE)
    files.objects.set(files.uploadsSigned.at(-1)!, new Uint8Array(20 * 1024 * 1024 + 1))
    expect(await finishDocumentFileUpload(store, files, grant(A), t.uploadId)).toEqual({ ok: false, problem: 'too_large' })
  })
  it('another project cannot finish this project\'s upload; a finished upload cannot be finished again', async () => {
    const { t } = await uploadVia(pdfBytes(2048))
    await expect(finishDocumentFileUpload(store, files, grant(B), t.uploadId)).rejects.toThrow(AccessError)
    await finishDocumentFileUpload(store, files, grant(A), t.uploadId)
    await expect(finishDocumentFileUpload(store, files, grant(A), t.uploadId)).rejects.toThrow(AccessError)
  })
  it('an expired reservation cannot be finished', async () => {
    const { t } = await uploadVia(pdfBytes(2048))
    store.uploads[0].expiresAt = new Date(Date.now() - 1000).toISOString()
    await expect(finishDocumentFileUpload(store, files, grant(A), t.uploadId)).rejects.toThrow(AccessError)
  })
  it('replacing a language: the new file is live at once; the old object goes to the sweep', async () => {
    const one = await uploadVia(pdfBytes(2048, 0x41))
    await finishDocumentFileUpload(store, files, grant(A), one.t.uploadId)
    const two = await uploadVia(pdfBytes(3000, 0x42))
    expect(await finishDocumentFileUpload(store, files, grant(A), two.t.uploadId)).toEqual({ ok: true, replaced: true })
    expect(store.files).toHaveLength(1)
    expect(store.files[0].storagePath).toBe(two.path)
    expect(store.trash.map((x) => x.storagePath)).toContain(one.path)
    await sweepSiteAccessFiles(store, files)
    expect(files.objects.has(one.path)).toBe(false)
    expect(files.objects.has(two.path)).toBe(true)
  })
  it('an archived document takes no uploads', async () => {
    await setDocumentArchivedState(store, grant(A), doc, true)
    await expect(beginDocumentFileUpload(store, files, grant(A), { documentId: doc, locales: ['en'], mimeType: 'application/pdf', sizeBytes: 10, sha256: 'a'.repeat(64) }, SITE)).rejects.toThrow(AccessError)
  })
})

describe('daily sweep', () => {
  it('removes abandoned uploads and leftover replaced objects, never an active file', async () => {
    const live = await uploadVia(pdfBytes(2048))
    await finishDocumentFileUpload(store, files, grant(A), live.t.uploadId)
    const abandoned = await uploadVia(pdfBytes(1024), { locales: ['it'] })
    store.uploads.find((u) => u.uploadId === abandoned.t.uploadId)!.expiresAt = new Date(Date.now() - 1000).toISOString()
    // a bug wrongly queues the ACTIVE object:
    store.trash.push({ storagePath: live.path, projectId: A, reason: 'replaced' })
    const r = await sweepSiteAccessFiles(store, files)
    expect(r.expiredUploads).toBe(1)
    expect(files.objects.has(abandoned.path)).toBe(false)
    expect(files.objects.has(live.path)).toBe(true)
    expect(files.removed).not.toContain(live.path)
    expect(store.files[0].storagePath).toBe(live.path)
  })
  it('a pending upload still within its time is left alone', async () => {
    const pending = await uploadVia(pdfBytes(1024))
    await sweepSiteAccessFiles(store, files)
    expect(files.objects.has(pending.path)).toBe(true)
  })
  it('storage failing keeps everything queued for the next run', async () => {
    const { t, path } = await uploadVia(new TextEncoder().encode('nope'))
    await finishDocumentFileUpload(store, files, grant(A), t.uploadId)
    files.failRemove = true
    const r = await sweepSiteAccessFiles(store, files)
    expect(r.failedBatches).toBe(1)
    expect(store.trash.map((x) => x.storagePath)).toContain(path)
  })
})

describe('never public', () => {
  const SRC = resolve(__dirname, '../../..')
  const all: Array<[string, string]> = []
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      if (statSync(p).isDirectory()) { if (n !== 'node_modules' && n !== '__tests__') walk(p); continue }
      if (/\.(ts|tsx)$/.test(n)) all.push([p, readFileSync(p, 'utf8')])
    }
  }
  walk(SRC)
  it('no code asks for a public URL of the Access bucket, or touches it outside src/lib/access', () => {
    for (const [p, code] of all) {
      if (!/site-access-files|ACCESS_BUCKET/.test(code)) continue
      expect(p, p).toMatch(/lib[\\/]access[\\/]/)
      expect(code, p).not.toMatch(/getPublicUrl/)
    }
  })
  it('the bucket is created private (050), re-checked private and 20 MB (052, 054), and allows exactly PDF, JPG, PNG and WebP (054)', () => {
    const root = resolve(SRC, '..')
    const m050 = readFileSync(join(root, 'supabase/migrations/050_site_access.sql'), 'utf8')
    const m052 = readFileSync(join(root, 'supabase/migrations/052_site_access_documents.sql'), 'utf8')
    const m054 = readFileSync(join(root, 'supabase/migrations/054_documents_module.sql'), 'utf8')
    expect(m050).toMatch(/values \('site-access-files', 'site-access-files', false, 20971520, array\['application\/pdf'\]\)/)
    expect(m052).toMatch(/id = 'site-access-files' and not public and file_size_limit = 20971520/)
    expect(m054).toMatch(/id = 'site-access-files' and not public and file_size_limit = 20971520/)
    expect(m054).not.toMatch(/svg|msword|officedocument/i)
  })
  it('no Sanity schema can hold a protected file (restricted pages refuse file CTAs — B2.2)', () => {
    const rules = all.find(([p]) => p.endsWith(join('access', 'page-schema-rules.ts')))![1]
    expect(rules).toMatch(/fileDownload/)
  })
})

describe('categories and tags (R9.2)', () => {
  const vocab = { categories: ['prezzi'], tags: ['2027', 'listino'] }
  it('only keys that exist in Categories & Tags are stored', async () => {
    const id = await createDocumentWithPlacements(store, grant(A), { title: { en: 'Price list' }, visibility: 'everyone', categoryTermId: 'prezzi', tagTermIds: ['2027'] }, pages, vocab)
    expect(await row(id)).toMatchObject({ categoryTermId: 'prezzi', tagTermIds: ['2027'] })
    await expect(createDocumentWithPlacements(store, grant(A), { title: { en: 'x' }, visibility: 'everyone', categoryTermId: 'gone' }, pages, vocab)).rejects.toThrow(/unknown_term/)
    await expect(updateDocumentDetails(store, grant(A), id, { title: { en: 'x' }, tagTermIds: ['2027', 'gone'] }, vocab)).rejects.toThrow(/unknown_term/)
    await updateDocumentDetails(store, grant(A), id, { title: { en: 'Price list' }, categoryTermId: null, tagTermIds: ['listino'] }, vocab)
    expect(await row(id)).toMatchObject({ categoryTermId: null, tagTermIds: ['listino'] })
  })
  it('where a term is used: archived documents count too (they can be restored)', async () => {
    const { documentTermUsage } = await import('../taxonomy-usage')
    const id = await createDocumentWithPlacements(store, grant(A), { title: { en: 'Price list' }, visibility: 'everyone', categoryTermId: 'prezzi', tagTermIds: ['2027', 'listino'] }, pages, vocab)
    await setDocumentArchivedState(store, grant(A), id, true)
    const docs = await listDocumentsForDashboard(store, grant(A, 'read'))
    expect(documentTermUsage(docs, 'category').get('prezzi')?.map((x) => x.id)).toEqual([id])
    expect([...documentTermUsage(docs, 'tag').keys()].sort()).toEqual(['2027', 'listino'])
  })
})

describe('several at once, and deleting for good (R9.3)', () => {
  const del = (projectId = A) => Object.freeze({ projectId, actorUserId: randomUUID(), level: 'delete', groupsAvailable: true }) as unknown as DocumentsGrant
  it('archive and restore several documents; each leaves its pages', async () => {
    const two = await createDocumentWithPlacements(store, grant(A), { title: { en: 'Second' }, visibility: 'groups', groupIds: [gA], pageIds: ['members'] }, pages)
    expect(await setDocumentsArchivedState(store, grant(A), [doc, two, doc], true)).toBe(2)
    expect((await row())?.archivedAt).not.toBeNull()
    expect((await row(two))?.pageIds).toEqual([])
    expect(await setDocumentsArchivedState(store, grant(A), [doc, two], false)).toBe(2)
    expect((await row())?.archivedAt).toBeNull()
  })
  it('only archived documents are deleted, all or none; files go to the sweep', async () => {
    const { t, path } = await uploadVia(pdfBytes(2048))
    await finishDocumentFileUpload(store, files, grant(A), t.uploadId)
    const live = await createDocumentWithPlacements(store, grant(A), { title: { en: 'Live' }, visibility: 'everyone' }, pages)
    await setDocumentArchivedState(store, grant(A), doc, true)
    await expect(deleteDocumentsForGood(store, del(), [doc, live])).rejects.toThrow(/not_archived/)
    expect(await row()).toBeDefined()
    expect(await deleteDocumentsForGood(store, del(), [doc])).toBe(1)
    expect(await row()).toBeUndefined()
    expect(store.trash.map((x) => x.storagePath)).toContain(path)
    await sweepSiteAccessFiles(store, files)
    expect(files.objects.has(path)).toBe(false)
    expect(await row(live)).toBeDefined()
  })
  it('a manage grant cannot delete; another project cannot delete; batches are capped', async () => {
    await setDocumentArchivedState(store, grant(A), doc, true)
    await expect(deleteDocumentsForGood(store, grant(A), [doc])).rejects.toThrow(AccessError)
    await expect(deleteDocumentsForGood(store, del(B), [doc])).rejects.toThrow(AccessError)
    await expect(deleteDocumentsForGood(store, del(), [])).rejects.toThrow(AccessError)
    await expect(deleteDocumentsForGood(store, del(), Array.from({ length: 101 }, () => randomUUID()))).rejects.toThrow(AccessError)
    expect(await row()).toBeDefined()
  })
})
