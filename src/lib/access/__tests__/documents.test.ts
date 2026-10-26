/**
 * ADR-040 B2.4 — protected documents on the management plane: direct-to-
 * storage uploads with server-side checks, replacement, and the daily sweep
 * that never removes an active file.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { createHash, randomUUID } from 'crypto'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import { AccessError } from '../model'
import {
  beginDocumentUpload, createDocument, finishDocumentUpload, listDocuments, setDocumentArchived, setDocumentGroups,
  type AccessManagementGrant,
} from '../management'
import { sweepSiteAccessFiles } from '../sweep'
import { createFakeStore, type FakeStore } from './fake-store'
import { createFakeFiles, pdfBytes, type FakeFiles } from './fake-files'

const A = randomUUID(), B = randomUUID()
// A grant is normally minted by authorizeAccessManagement(); the brand is a type-level guard only.
const grant = (projectId: string, level: 'read' | 'manage' = 'manage') => Object.freeze({ projectId, actorUserId: randomUUID(), level }) as unknown as AccessManagementGrant
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')

let store: FakeStore, files: FakeFiles, gA: string, gB: string, doc: string
beforeEach(async () => {
  store = createFakeStore(); files = createFakeFiles()
  gA = await store.createGroup(A, { name: { en: 'Members' }, description: null }, 'x')
  gB = await store.createGroup(B, { name: { en: 'Members' }, description: null }, 'x')
  doc = await createDocument(store, grant(A), { title: { en: 'Timetable' }, groupIds: [gA] })
})

async function uploadVia(bytes: Uint8Array, opts: { declaredSize?: number; declaredSha?: string; projectId?: string; locale?: string } = {}) {
  const t = await beginDocumentUpload(store, files, grant(opts.projectId ?? A), {
    documentId: doc, locale: opts.locale ?? 'en', sizeBytes: opts.declaredSize ?? bytes.length, sha256: opts.declaredSha ?? sha(bytes), filename: 'C:\\x\\orario.pdf',
  })
  const path = files.uploadsSigned.at(-1)!
  files.objects.set(path, bytes) // the browser PUTs to the signed URL
  return { t, path }
}

describe('documents', () => {
  it('only this project\'s live groups; an empty list means nobody', async () => {
    await expect(createDocument(store, grant(A), { title: { en: 'x' }, groupIds: [gB] })).rejects.toThrow(AccessError)
    await setDocumentGroups(store, grant(A), doc, [])
    expect((await listDocuments(store, grant(A, 'read'))).find((d) => d.id === doc)?.groupIds).toEqual([])
  })
  it('read grants cannot change anything', async () => {
    await expect(createDocument(store, grant(A, 'read'), { title: { en: 'x' }, groupIds: [] })).rejects.toThrow()
    await expect(beginDocumentUpload(store, files, grant(A, 'read'), { documentId: doc, locale: 'en', sizeBytes: 10, sha256: 'a'.repeat(64) })).rejects.toThrow()
  })
})

describe('direct-to-storage upload', () => {
  it('the path is chosen by the database, project-prefixed; storage signs exactly that path', async () => {
    const { path } = await uploadVia(pdfBytes(2048))
    expect(path).toMatch(new RegExp(`^${A}/[0-9a-f-]{36}\\.pdf$`))
    expect(store.uploads.at(-1)!.filename).toBe('orario.pdf')
  })
  it.each([
    ['a locale the platform does not have', { locale: 'xx' }],
    ['a size over 20 MB', { sizeBytes: 20 * 1024 * 1024 + 1 }],
    ['a zero size', { sizeBytes: 0 }],
    ['a malformed hash', { sha256: 'abc' }],
    ['a malformed document id', { documentId: 'nope' }],
  ])('refuses %s before reserving anything', async (_n, over) => {
    await expect(beginDocumentUpload(store, files, grant(A), { documentId: doc, locale: 'en', sizeBytes: 10, sha256: 'a'.repeat(64), ...over })).rejects.toThrow(AccessError)
    expect(store.uploads).toHaveLength(0)
    expect(files.uploadsSigned).toHaveLength(0)
  })
  it('another project cannot upload to this document', async () => {
    await expect(beginDocumentUpload(store, files, grant(B), { documentId: doc, locale: 'en', sizeBytes: 10, sha256: 'a'.repeat(64) })).rejects.toThrow(AccessError)
  })
  it('finish: a valid PDF becomes the document\'s file', async () => {
    const bytes = pdfBytes(4096)
    const { t } = await uploadVia(bytes)
    expect(await finishDocumentUpload(store, files, grant(A), t.uploadId)).toEqual({ ok: true, replaced: false })
    expect(store.files).toHaveLength(1)
    expect(store.files[0]).toMatchObject({ locale: 'en', sizeBytes: 4096, sha256: sha(bytes) })
  })
  it('finish before the browser has finished uploading → retry allowed, nothing failed', async () => {
    const t = await beginDocumentUpload(store, files, grant(A), { documentId: doc, locale: 'en', sizeBytes: 4096, sha256: 'a'.repeat(64) })
    expect(await finishDocumentUpload(store, files, grant(A), t.uploadId)).toEqual({ ok: false, problem: 'not_uploaded_yet' })
    expect(store.uploads[0].status).toBe('pending')
  })
  it.each([
    ['not a PDF', () => new TextEncoder().encode('<html>hello</html>'), 'not_a_pdf'],
    ['size differs from the declaration', () => pdfBytes(4096), 'size_mismatch'],
    ['content differs from the declared hash (corrupted / swapped)', () => pdfBytes(4096), 'hash_mismatch'],
  ] as const)('%s → refused, upload failed, object queued for removal', async (name, make, problem) => {
    const bytes = make()
    const { t, path } = await uploadVia(bytes, {
      declaredSize: problem === 'size_mismatch' ? bytes.length + 1 : bytes.length,
      declaredSha: problem === 'hash_mismatch' ? 'b'.repeat(64) : undefined,
    })
    expect(await finishDocumentUpload(store, files, grant(A), t.uploadId), name).toEqual({ ok: false, problem })
    expect(store.files).toHaveLength(0)
    expect(store.uploads[0].status).toBe('failed')
    expect(store.trash.map((x) => x.storagePath)).toContain(path)
  })
  it('an object larger than 20 MB in storage is refused', async () => {
    const t = await beginDocumentUpload(store, files, grant(A), { documentId: doc, locale: 'en', sizeBytes: 1024, sha256: 'a'.repeat(64) })
    files.objects.set(files.uploadsSigned.at(-1)!, new Uint8Array(20 * 1024 * 1024 + 1))
    expect(await finishDocumentUpload(store, files, grant(A), t.uploadId)).toEqual({ ok: false, problem: 'too_large' })
  })
  it('another project cannot finish this project\'s upload; a finished upload cannot be finished again', async () => {
    const { t } = await uploadVia(pdfBytes(2048))
    await expect(finishDocumentUpload(store, files, grant(B), t.uploadId)).rejects.toThrow(AccessError)
    await finishDocumentUpload(store, files, grant(A), t.uploadId)
    await expect(finishDocumentUpload(store, files, grant(A), t.uploadId)).rejects.toThrow(AccessError)
  })
  it('an expired reservation cannot be finished', async () => {
    const { t } = await uploadVia(pdfBytes(2048))
    store.uploads[0].expiresAt = new Date(Date.now() - 1000).toISOString()
    await expect(finishDocumentUpload(store, files, grant(A), t.uploadId)).rejects.toThrow(AccessError)
  })
  it('replacing a language: the new file is live, the old object is removed', async () => {
    const one = await uploadVia(pdfBytes(2048, 0x41))
    await finishDocumentUpload(store, files, grant(A), one.t.uploadId)
    const two = await uploadVia(pdfBytes(3000, 0x42))
    expect(await finishDocumentUpload(store, files, grant(A), two.t.uploadId)).toEqual({ ok: true, replaced: true })
    expect(store.files).toHaveLength(1)
    expect(store.files[0].storagePath).toBe(two.path)
    expect(files.objects.has(one.path)).toBe(false)
    expect(store.trash).toHaveLength(0)
  })
  it('an archived document takes no uploads', async () => {
    await setDocumentArchived(store, grant(A), doc, true)
    await expect(beginDocumentUpload(store, files, grant(A), { documentId: doc, locale: 'en', sizeBytes: 10, sha256: 'a'.repeat(64) })).rejects.toThrow(AccessError)
  })
})

describe('daily sweep', () => {
  it('removes abandoned uploads and leftover replaced objects, never an active file', async () => {
    const live = await uploadVia(pdfBytes(2048))
    await finishDocumentUpload(store, files, grant(A), live.t.uploadId)
    const abandoned = await uploadVia(pdfBytes(1024), { locale: 'it' })
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
    await finishDocumentUpload(store, files, grant(A), t.uploadId)
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
  it('the bucket is created private (050) and re-checked private and 20 MB (052)', () => {
    const root = resolve(SRC, '..')
    const m050 = readFileSync(join(root, 'supabase/migrations/050_site_access.sql'), 'utf8')
    const m052 = readFileSync(join(root, 'supabase/migrations/052_site_access_documents.sql'), 'utf8')
    expect(m050).toMatch(/values \('site-access-files', 'site-access-files', false, 20971520, array\['application\/pdf'\]\)/)
    expect(m052).toMatch(/id = 'site-access-files' and not public and file_size_limit = 20971520/)
  })
  it('no Sanity schema can hold a protected file (restricted pages refuse file CTAs — B2.2)', () => {
    const rules = all.find(([p]) => p.endsWith(join('access', 'page-schema-rules.ts')))![1]
    expect(rules).toMatch(/fileDownload/)
  })
})
