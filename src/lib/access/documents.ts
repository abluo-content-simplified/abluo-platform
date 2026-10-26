/**
 * Documents module — management plane (ADR-040 §15, R9). Server-only.
 *
 * Who may manage documents is a DASHBOARD question (ADR-028):
 * `authorizeDocumentsManagement()` runs assertModuleAction() — the `documents`
 * module must be installed and the caller must hold `documents.document.read`
 * / `.manage` on that project. It returns a grant bound to ONE project that
 * every function below takes instead of a project id.
 *
 * Groups (who can open a document) exist only while Access (`members`) is also
 * installed; without it every document is public. A documents grant lets an
 * Editor CHOOSE groups for a document — never create, rename, or see or change
 * passwords (those stay `members.access.manage`, and support never writes them).
 *
 * Uploads (as B2.4): the database reserves the upload and chooses the path;
 * the browser PUTs the file to a one-time signed URL; the SERVER then reads
 * the stored bytes and checks type, size and hash before the document points
 * at them. One upload may serve several languages (one stored object).
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { LOCALE_CODES } from '@/lib/i18n/locales'
import { ACCESS_LIMITS, ACCESS_MODULE_ID, AccessError, DOCUMENTS_PERMISSIONS, isUuid } from './model'
import type { DocumentInput, DocumentRow, DocumentVisibility, GroupRow, LocalizedName, SiteAccessStore } from './store'
import type { SiteAccessFiles } from './file-storage'
import { DOCUMENT_FILE_TYPES, inspectDocumentFile, isDocumentFileType, sanitizeFilename, UPLOAD_TTL_SECONDS, type DocumentFileType } from './pdf'
import { documentFitsPage, type DownloadPage } from './download-pages'

declare const GRANT: unique symbol
export type DocumentsGrant = {
  readonly projectId: string
  readonly actorUserId: string
  readonly level: 'read' | 'manage'
  /** Access (`members`) is installed on the project: documents may be limited to groups. */
  readonly groupsAvailable: boolean
  readonly [GRANT]: true
}

/** Throws TenantAuthorizationError (from assertModuleAction) when refused. */
export function authorizeDocumentsManagement(
  ctx: TenantAuthorizationContext,
  projectId: string,
  level: 'read' | 'manage',
  deps: { permissionOwnerMap?: Record<string, string> } = {}
): DocumentsGrant {
  assertModuleAction(ctx, projectId, level === 'manage' ? DOCUMENTS_PERMISSIONS.manage : DOCUMENTS_PERMISSIONS.read, deps)
  const project = ctx.projects.find((p) => p.projectId === projectId)
  const groupsAvailable = Boolean(project?.enabledModuleIds.includes(ACCESS_MODULE_ID))
  return Object.freeze({ projectId, actorUserId: ctx.userId, level, groupsAvailable }) as DocumentsGrant
}

function requireManage(grant: DocumentsGrant): void {
  if (grant?.level !== 'manage' || !isUuid(grant.projectId)) throw new AccessError('invalid_input', 'manage grant required')
}
function requireRead(grant: DocumentsGrant): void {
  if ((grant?.level !== 'read' && grant?.level !== 'manage') || !isUuid(grant.projectId)) throw new AccessError('invalid_input', 'grant required')
}
function requireDocumentId(value: unknown): string {
  if (!isUuid(value)) throw new AccessError('invalid_input', 'document')
  return value.toLowerCase()
}

// ── Validation ────────────────────────────────────────────────────────────────

const LOCALE_KEY = /^[a-z]{2}(-[A-Z]{2})?$/
const SANITY_ID = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/
const SHA256_HEX = /^[0-9a-f]{64}$/

function localizedText(value: unknown, max: number, field: string, required: boolean): LocalizedName | null {
  if (value === null || value === undefined) {
    if (required) throw new AccessError('invalid_input', field)
    return null
  }
  if (typeof value !== 'object' || Array.isArray(value)) throw new AccessError('invalid_input', field)
  const out: LocalizedName = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!LOCALE_KEY.test(k) || typeof v !== 'string') throw new AccessError('invalid_input', field)
    const t = v.trim()
    if (!t) continue
    if ([...t].length > max) throw new AccessError('invalid_input', `${field}_too_long`)
    out[k] = t
  }
  if (Object.keys(out).length === 0) {
    if (required) throw new AccessError('invalid_input', field)
    return null
  }
  return out
}

function sanityId(value: unknown, field: string): string {
  if (typeof value !== 'string' || !SANITY_ID.test(value) || value.startsWith('drafts.') || value.startsWith('versions.')) {
    throw new AccessError('invalid_input', field)
  }
  return value
}

export function normalizeDocumentInput(input: { title: unknown; note?: unknown; categoryTermId?: unknown; tagTermIds?: unknown }): DocumentInput {
  const tags = input.tagTermIds === undefined || input.tagTermIds === null ? [] : input.tagTermIds
  if (!Array.isArray(tags) || tags.length > ACCESS_LIMITS.tagsPerDocument) throw new AccessError('invalid_input', 'tags')
  return {
    title: localizedText(input.title, ACCESS_LIMITS.documentTitleMax, 'title', true)!,
    note: localizedText(input.note, ACCESS_LIMITS.noteMax, 'note', false),
    categoryTermId: input.categoryTermId === undefined || input.categoryTermId === null || input.categoryTermId === '' ? null : sanityId(input.categoryTermId, 'category'),
    tagTermIds: [...new Set(tags.map((t) => sanityId(t, 'tags')))],
  }
}

/** The project's category and tag keys (Categories & Tags), read by the caller from Sanity. */
export type TermVocabulary = { categories: readonly string[]; tags: readonly string[] }

/** A document may only point at terms that exist (a term deleted meanwhile is refused, never stored). */
export function assertKnownTerms(details: Pick<DocumentInput, 'categoryTermId' | 'tagTermIds'>, vocab: TermVocabulary): void {
  if (details.categoryTermId && !vocab.categories.includes(details.categoryTermId)) throw new AccessError('invalid_input', 'unknown_term')
  if (details.tagTermIds.some((t) => !vocab.tags.includes(t))) throw new AccessError('invalid_input', 'unknown_term')
}

/**
 * Everyone, or one or more LIVE groups of THIS project. Groups are only
 * possible while Access is installed.
 */
async function normalizeAccess(store: SiteAccessStore, grant: DocumentsGrant, visibility: unknown, groupIds: unknown): Promise<{ visibility: DocumentVisibility; groupIds: string[] }> {
  if (visibility === 'everyone') return { visibility, groupIds: [] }
  if (visibility !== 'groups') throw new AccessError('invalid_input', 'visibility')
  if (!grant.groupsAvailable) throw new AccessError('invalid_input', 'groups_unavailable')
  if (!Array.isArray(groupIds) || groupIds.length === 0) throw new AccessError('invalid_input', 'no_groups')
  const ids = [...new Set(groupIds)]
  if (!ids.every(isUuid)) throw new AccessError('invalid_input', 'groups')
  const live = new Set((await store.listGroups(grant.projectId)).filter((g) => !g.archivedAt).map((g) => g.id.toLowerCase()))
  const norm = ids.map((g) => (g as string).toLowerCase())
  if (!norm.every((g) => live.has(g))) throw new AccessError('invalid_input', 'unknown_group')
  return { visibility: 'groups', groupIds: norm.sort() }
}

function normalizeLocales(value: unknown, siteLocales: readonly string[]): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new AccessError('invalid_input', 'locales')
  const out = [...new Set(value)]
  if (!out.every((l) => typeof l === 'string' && (LOCALE_CODES as readonly string[]).includes(l) && siteLocales.includes(l))) {
    throw new AccessError('invalid_input', 'locales')
  }
  return out as string[]
}

/** Placements may only target pages that have a Download section AND fit the document. */
function normalizePlacements(value: unknown, doc: { visibility: DocumentVisibility; groupIds: readonly string[] }, pages: readonly DownloadPage[]): string[] {
  if (!Array.isArray(value) || value.length > ACCESS_LIMITS.pagesPerDocument) throw new AccessError('invalid_input', 'pages')
  const byId = new Map(pages.map((p) => [p.id, p]))
  const ids = [...new Set(value.map((v) => sanityId(v, 'pages')))]
  for (const id of ids) {
    const page = byId.get(id)
    if (!page) throw new AccessError('invalid_input', 'page_without_section')
    if (!documentFitsPage(doc, page)) throw new AccessError('invalid_input', 'page_does_not_fit')
  }
  return ids.sort()
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export async function listDocumentsForDashboard(store: SiteAccessStore, grant: DocumentsGrant): Promise<DocumentRow[]> {
  requireRead(grant)
  return store.listDocuments(grant.projectId)
}

/** Group NAMES for the "Who can open it" choice — never passwords. Empty without Access. */
export async function listGroupChoices(store: SiteAccessStore, grant: DocumentsGrant): Promise<GroupRow[]> {
  requireRead(grant)
  if (!grant.groupsAvailable) return []
  return store.listGroups(grant.projectId)
}

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Creates a document with its details, who can open it and where it shows.
 * Files are added afterwards (uploads), so the pages list only shows it once it
 * has a file.
 */
export async function createDocumentWithPlacements(
  store: SiteAccessStore,
  grant: DocumentsGrant,
  input: { title: unknown; note?: unknown; categoryTermId?: unknown; tagTermIds?: unknown; visibility: unknown; groupIds?: unknown; pageIds?: unknown },
  pages: readonly DownloadPage[],
  vocab: TermVocabulary = { categories: [], tags: [] }
): Promise<string> {
  requireManage(grant)
  const details = normalizeDocumentInput(input)
  assertKnownTerms(details, vocab)
  const access = await normalizeAccess(store, grant, input.visibility, input.groupIds)
  const pageIds = normalizePlacements(input.pageIds ?? [], access, pages)
  const id = await store.createDocument(grant.projectId, { ...details, ...access }, grant.actorUserId)
  if (pageIds.length) await store.setDocumentPlacements(grant.projectId, id, pageIds, grant.actorUserId)
  return id
}

export async function updateDocumentDetails(
  store: SiteAccessStore,
  grant: DocumentsGrant,
  documentId: unknown,
  input: { title: unknown; note?: unknown; categoryTermId?: unknown; tagTermIds?: unknown },
  vocab: TermVocabulary = { categories: [], tags: [] }
): Promise<void> {
  requireManage(grant)
  const details = normalizeDocumentInput(input)
  assertKnownTerms(details, vocab)
  await store.updateDocument(grant.projectId, requireDocumentId(documentId), details, grant.actorUserId)
}

/**
 * Who can open it, and where it shows — saved together so a document can never
 * be left placed on a page it no longer fits (e.g. made Members-only while it
 * still shows on the public Contact page).
 */
export async function setDocumentAccessAndPlacements(
  store: SiteAccessStore,
  grant: DocumentsGrant,
  documentId: unknown,
  input: { visibility: unknown; groupIds?: unknown; pageIds: unknown },
  pages: readonly DownloadPage[]
): Promise<void> {
  requireManage(grant)
  const id = requireDocumentId(documentId)
  const access = await normalizeAccess(store, grant, input.visibility, input.groupIds)
  const pageIds = normalizePlacements(input.pageIds, access, pages)
  // Narrow the placements first, so no moment exists where a group document
  // sits on a public page.
  const current = (await store.listDocuments(grant.projectId)).find((d) => d.id === id)
  if (!current) throw new AccessError('not_found', 'document')
  const keep = current.pageIds.filter((p) => pageIds.includes(p))
  if (keep.length !== current.pageIds.length) await store.setDocumentPlacements(grant.projectId, id, keep, grant.actorUserId)
  await store.setDocumentAccess(grant.projectId, id, access, grant.actorUserId)
  await store.setDocumentPlacements(grant.projectId, id, pageIds, grant.actorUserId)
}

/** The order of the documents on one page (the Pages recap). */
export async function reorderPageDocuments(store: SiteAccessStore, grant: DocumentsGrant, pageId: unknown, documentIds: unknown, pages: readonly DownloadPage[]): Promise<void> {
  requireManage(grant)
  const page = sanityId(pageId, 'page')
  if (!pages.some((p) => p.id === page)) throw new AccessError('invalid_input', 'page_without_section')
  if (!Array.isArray(documentIds) || !documentIds.every(isUuid)) throw new AccessError('invalid_input', 'documents')
  await store.reorderPageDocuments(grant.projectId, page, documentIds.map((d) => (d as string).toLowerCase()), grant.actorUserId)
}

/** Removes one document from one page (the Pages recap); the document itself stays. */
export async function removeDocumentFromPage(store: SiteAccessStore, grant: DocumentsGrant, documentId: unknown, pageId: unknown): Promise<void> {
  requireManage(grant)
  const id = requireDocumentId(documentId)
  const page = sanityId(pageId, 'page')
  const current = (await store.listDocuments(grant.projectId)).find((d) => d.id === id)
  if (!current) throw new AccessError('not_found', 'document')
  await store.setDocumentPlacements(grant.projectId, id, current.pageIds.filter((p) => p !== page), grant.actorUserId)
}

/** Archived documents are refused to every visitor and leave every page. Never deleted. */
export async function setDocumentArchivedState(store: SiteAccessStore, grant: DocumentsGrant, documentId: unknown, archived: boolean): Promise<void> {
  requireManage(grant)
  const id = requireDocumentId(documentId)
  if (archived === true) await store.setDocumentPlacements(grant.projectId, id, [], grant.actorUserId).catch(() => undefined)
  await store.setDocumentArchived(grant.projectId, id, archived === true, grant.actorUserId)
}

/** Never the last language (archive the document instead). */
export async function removeDocumentLanguages(store: SiteAccessStore, grant: DocumentsGrant, documentId: unknown, locales: unknown, siteLocales: readonly string[]): Promise<number> {
  requireManage(grant)
  return store.removeDocumentLanguages(grant.projectId, requireDocumentId(documentId), normalizeLocales(locales, siteLocales), grant.actorUserId)
}

// ── Uploads ───────────────────────────────────────────────────────────────────

export type UploadTicket = { uploadId: string; signedUrl: string; token: string; expiresAt: string }

export async function beginDocumentFileUpload(
  store: SiteAccessStore,
  files: SiteAccessFiles,
  grant: DocumentsGrant,
  input: { documentId: unknown; locales: unknown; mimeType: unknown; sizeBytes: unknown; sha256: unknown; filename?: unknown },
  siteLocales: readonly string[]
): Promise<UploadTicket> {
  requireManage(grant)
  const documentId = requireDocumentId(input.documentId)
  const locales = normalizeLocales(input.locales, siteLocales)
  if (!isDocumentFileType(input.mimeType)) throw new AccessError('invalid_input', 'file_type')
  const mimeType: DocumentFileType = input.mimeType
  const size = input.sizeBytes
  if (typeof size !== 'number' || !Number.isInteger(size) || size <= 0) throw new AccessError('invalid_input', 'size')
  if (size > DOCUMENT_FILE_TYPES[mimeType].maxBytes) throw new AccessError('invalid_input', 'file_too_large')
  const sha = typeof input.sha256 === 'string' ? input.sha256.toLowerCase() : ''
  if (!SHA256_HEX.test(sha)) throw new AccessError('invalid_input', 'sha256')
  const reservation = await store.beginUpload(grant.projectId, {
    documentId, locales, mimeType, sizeBytes: size, sha256: sha, filename: sanitizeFilename(input.filename), ttlSeconds: UPLOAD_TTL_SECONDS,
  }, grant.actorUserId)
  // The path comes from the database and is project-prefixed; re-check before asking storage to sign anything.
  if (!reservation.storagePath.startsWith(`${grant.projectId}/`)) throw new AccessError('unavailable', 'upload path')
  try {
    const { signedUrl, token } = await files.createSignedUploadUrl(reservation.storagePath)
    return { uploadId: reservation.uploadId, signedUrl, token, expiresAt: reservation.expiresAt }
  } catch (e) {
    await store.failUpload(grant.projectId, reservation.uploadId).catch(() => undefined)
    throw e
  }
}

export type FinishResult =
  | { ok: true; replaced: boolean }
  | { ok: false; problem: 'not_uploaded_yet' | 'wrong_type' | 'size_mismatch' | 'hash_mismatch' | 'too_large' }

/**
 * Checks the stored object and points the document at it. A replaced object is
 * NOT removed here: another language may still share it — the daily sweep
 * removes it once no language uses it (migration 052/054 trash rules). It is
 * unreachable from the moment no file row points at it.
 */
export async function finishDocumentFileUpload(store: SiteAccessStore, files: SiteAccessFiles, grant: DocumentsGrant, uploadId: unknown): Promise<FinishResult> {
  requireManage(grant)
  if (!isUuid(uploadId)) throw new AccessError('invalid_input', 'upload')
  const upload = await store.getUpload(grant.projectId, uploadId)
  if (!upload || upload.status !== 'pending' || Date.parse(upload.expiresAt) <= Date.now()) throw new AccessError('not_found', 'upload_unavailable')
  if (!upload.storagePath.startsWith(`${grant.projectId}/`)) throw new AccessError('unavailable', 'upload path')
  if (!isDocumentFileType(upload.mimeType)) throw new AccessError('unavailable', 'upload type')

  let bytes: Uint8Array | null
  try {
    bytes = await files.download(upload.storagePath, DOCUMENT_FILE_TYPES[upload.mimeType].maxBytes)
  } catch (e) {
    if (e instanceof AccessError && e.code === 'invalid_input') {
      await store.failUpload(grant.projectId, uploadId)
      return { ok: false, problem: 'too_large' }
    }
    throw e
  }
  if (bytes === null) return { ok: false, problem: 'not_uploaded_yet' } // the browser may still be sending; retry is allowed

  const check = inspectDocumentFile(bytes, { mimeType: upload.mimeType, declaredSize: upload.declaredSize, declaredSha256: upload.declaredSha256 })
  if (!check.ok) {
    await store.failUpload(grant.projectId, uploadId)
    return { ok: false, problem: check.problem }
  }
  const replaced = await store.finishUpload(grant.projectId, uploadId, { sizeBytes: check.sizeBytes, sha256: check.sha256 }, grant.actorUserId)
  return { ok: true, replaced: replaced !== null }
}
