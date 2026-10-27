/**
 * Site Access — persistence port (ADR-040). The service talks to this
 * interface only; `createSupabaseSiteAccessStore()` is the one implementation
 * and calls the migration-050 functions with the SERVICE ROLE. Tests use an
 * in-memory fake that mirrors the SQL semantics.
 *
 * Every method takes the project id first and every query filters on it.
 * Migration 050 enforces the same thing with composite foreign keys, so a bug
 * here fails at the database rather than leaking.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { AccessError, type RevokeReason } from './model'
import type { AccessEnvironment } from './environment'
import type { AttemptReservation, RateLimits } from './rate-limit'

export type CandidateCredential = {
  credentialId: string
  secretVersion: number
  passwordHash: string
  groupIds: string[]
}

export type ResolvedSession = {
  sessionId: string
  expiresAt: string
  groupIds: string[]
  credentialIds: string[]
}

export type LocalizedName = Record<string, string>

export type GroupRow = {
  id: string
  name: LocalizedName
  description: string | null
  sortOrder: number
  archivedAt: string | null
}

/** Never carries a hash. */
export type CredentialRow = {
  id: string
  label: string
  secretVersion: number
  expiresAt: string | null
  disabledAt: string | null
  rotatedAt: string | null
  createdAt: string
  groupIds: string[]
}

export type DocumentVisibility = 'everyone' | 'groups'

/** The four file types a document may hold (migration 054; Office/SVG are backlog DOCS-1). */
export type DocumentMimeType = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'

export type DocumentFileRow = {
  locale: string
  mimeType: DocumentMimeType
  sizeBytes: number
  /** Two languages with the same sha256 share one stored file. */
  sha256: string
  originalFilename: string | null
  uploadedAt: string
}

/** One document as the dashboard lists it (R9, migration 054). */
export type DocumentRow = {
  id: string
  title: LocalizedName
  note: LocalizedName | null
  visibility: DocumentVisibility
  categoryTermId: string | null
  tagTermIds: string[]
  archivedAt: string | null
  createdAt: string
  /** LIVE groups only matter for access; all assigned groups are listed here. */
  groupIds: string[]
  files: DocumentFileRow[]
  /** Published Sanity page ids the document is placed on ("Show on"). */
  pageIds: string[]
  /** The document's position on each of those pages (0 = first). */
  pageOrder: Record<string, number>
}

/** One document placed on a page, as a Download section needs it (no storage paths). */
export type PageDocumentRow = {
  pageId: string
  sortOrder: number
  documentId: string
  visibility: DocumentVisibility
  title: LocalizedName
  note: LocalizedName | null
  categoryTermId: string | null
  tagTermIds: string[]
  /** LIVE groups only. */
  groupIds: string[]
  files: Array<{ locale: string; mimeType: DocumentMimeType; sizeBytes: number; uploadedAt: string }>
  updatedAt: string
}

/** What a file request needs: never more than this leaves the database. */
export type DeliverableFile = {
  archived: boolean
  visibility: DocumentVisibility
  title: LocalizedName
  /** LIVE (non-archived) groups only; always empty for `everyone`. */
  groupIds: string[]
  /** The file's REAL language (shown honestly when it differs from the page's). */
  locale: string
  storagePath: string
  sizeBytes: number
  sha256: string
  mimeType: DocumentMimeType
}

export type DocumentInput = {
  title: LocalizedName
  note: LocalizedName | null
  categoryTermId: string | null
  tagTermIds: string[]
}

/** How many visitors are signed in now (migration 053): per live group, and in total (each session once). */
export type SessionSummary = { total: number; byGroup: Record<string, number> }

export type UploadReservation = { uploadId: string; storagePath: string; expiresAt: string }

export type PendingUpload = {
  uploadId: string
  documentId: string
  /** The first language (B2.5 uploads have only this one). */
  locale: string
  /** Every language this upload is for. */
  locales: string[]
  mimeType: DocumentMimeType
  storagePath: string
  declaredSize: number
  declaredSha256: string
  status: 'pending' | 'finished' | 'failed' | 'expired'
  expiresAt: string
}

export interface SiteAccessStore {
  // visitor plane
  /** Atomic count-and-reserve (site_access_reserve_attempt). */
  reserveAttempt(projectId: string, ipHash: string, limits: RateLimits): Promise<AttemptReservation>
  /** Finishes a reservation as a failure (success is recorded by unlock). */
  failAttempt(projectId: string, attemptId: number): Promise<void>
  candidateCredentials(projectId: string, groupIds: string[] | null): Promise<CandidateCredential[]>
  unlock(input: {
    projectId: string
    environment: AccessEnvironment
    credentialId: string
    credentialVersion: number
    currentTokenHash: string | null
    newTokenHash: string
    sessionSeconds: number
    /** The reservation to mark succeeded; null for the 2nd+ password of one prompt. */
    attemptId: number | null
    deviceLabel: string | null
  }): Promise<string>
  resolve(projectId: string, environment: AccessEnvironment, tokenHash: string): Promise<ResolvedSession | null>
  revokeSessions(projectId: string, sessionId: string | null, reason: RevokeReason, actorUserId: string | null): Promise<number>
  /** Counts only (053). Sessions of ONE environment. */
  sessionSummary(projectId: string, environment: AccessEnvironment): Promise<SessionSummary>
  // management plane
  listGroups(projectId: string): Promise<GroupRow[]>
  createGroup(projectId: string, input: { name: LocalizedName; description: string | null }, actorUserId: string): Promise<string>
  updateGroup(projectId: string, groupId: string, input: { name?: LocalizedName; description?: string | null; sortOrder?: number }, actorUserId: string): Promise<void>
  setGroupArchived(projectId: string, groupId: string, archived: boolean, actorUserId: string): Promise<void>
  listCredentials(projectId: string): Promise<CredentialRow[]>
  createCredential(projectId: string, input: { label: string; passwordHash: string; groupIds: string[]; expiresAt: string | null }, actorUserId: string): Promise<string>
  setCredentialGroups(projectId: string, credentialId: string, groupIds: string[], actorUserId: string): Promise<void>
  rotateCredential(projectId: string, credentialId: string, passwordHash: string, actorUserId: string): Promise<number>
  setCredentialDisabled(projectId: string, credentialId: string, disabled: boolean, actorUserId: string): Promise<number>
  // documents (migrations 052 + 054)
  listDocuments(projectId: string): Promise<DocumentRow[]>
  createDocument(projectId: string, input: DocumentInput & { visibility: DocumentVisibility; groupIds: string[] }, actorUserId: string): Promise<string>
  /** Full replace of title, note, category and tags. */
  updateDocument(projectId: string, documentId: string, input: DocumentInput, actorUserId: string): Promise<void>
  /** Everyone XOR one or more live groups, set together. */
  setDocumentAccess(projectId: string, documentId: string, input: { visibility: DocumentVisibility; groupIds: string[] }, actorUserId: string): Promise<void>
  /** The full set of pages ("Show on"). Kept pages keep their position; new ones append. */
  setDocumentPlacements(projectId: string, documentId: string, pageIds: string[], actorUserId: string): Promise<void>
  /** Exactly the documents placed on the page, in the new order. */
  reorderPageDocuments(projectId: string, pageId: string, documentIds: string[], actorUserId: string): Promise<void>
  /** Never the last language. Returns how many language files were removed. */
  removeDocumentLanguages(projectId: string, documentId: string, locales: string[], actorUserId: string): Promise<number>
  setDocumentArchived(projectId: string, documentId: string, archived: boolean, actorUserId: string): Promise<void>
  /** Deletes ARCHIVED documents of this project for good (all or none, ≤ 100); their objects go to the sweep. Migration 055. */
  deleteDocuments(projectId: string, documentIds: string[], actorUserId: string): Promise<number>
  beginUpload(projectId: string, input: { documentId: string; locales: string[]; mimeType: DocumentMimeType; sizeBytes: number; sha256: string; filename: string | null; ttlSeconds: number }, actorUserId: string): Promise<UploadReservation>
  getUpload(projectId: string, uploadId: string): Promise<PendingUpload | null>
  /** Returns the storage path the first language's new file replaced (queued for removal), or null. */
  finishUpload(projectId: string, uploadId: string, measured: { sizeBytes: number; sha256: string }, actorUserId: string): Promise<string | null>
  failUpload(projectId: string, uploadId: string): Promise<void>
  /** First of `locales` with a file; null for unknown / other project / no file. */
  documentForDelivery(projectId: string, documentId: string, locales: string[]): Promise<DeliverableFile | null>
  /** Live documents with a file, placed on these pages, in page order. */
  pageDocuments(projectId: string, pageIds: string[]): Promise<PageDocumentRow[]>
  // sweep (cron)
  expireUploads(limit: number): Promise<number>
  trashBatch(limit: number): Promise<Array<{ storagePath: string; projectId: string }>>
  trashDone(paths: string[]): Promise<number>
}

// ── Error mapping ─────────────────────────────────────────────────────────────

type PgError = { code?: string; message?: string } | null | undefined

/** Missing table / function / PostgREST schema cache miss → the module is simply not there yet. */
const MISSING = new Set(['42P01', '42883', 'PGRST202', 'PGRST205'])

export function toAccessError(error: PgError): AccessError {
  const message = error?.message ?? ''
  const coded = message.match(/site_access:([a-z_]+)/)
  if (coded) {
    const c = coded[1]
    if (c === 'credential_unavailable') return new AccessError('credential_unavailable')
    if (c === 'not_found' || c === 'upload_unavailable') return new AccessError('not_found', c)
    if (c.startsWith('too_many_')) return new AccessError('limit_reached', c)
    return new AccessError('invalid_input', c)
  }
  if (error?.code && MISSING.has(error.code)) return new AccessError('unavailable', 'site access tables are not installed')
  // 23503 FK (e.g. another project's group), 23514 check, 23505 unique, 22P02 bad uuid
  if (error?.code && ['23503', '23514', '23505', '22P02'].includes(error.code)) return new AccessError('invalid_input', error.code)
  return new AccessError('unavailable', 'site access store error')
}

function check<T>(res: { data: T; error: PgError }): T {
  if (res.error) throw toAccessError(res.error)
  return res.data
}

// ── Supabase implementation ───────────────────────────────────────────────────

export function createSupabaseSiteAccessStore(db: SupabaseClient): SiteAccessStore {
  const event = async (projectId: string, actor: string, action: string, targetId: string, detail: Record<string, unknown> = {}) => {
    check(await db.from('site_access_events').insert({ project_id: projectId, actor_user_id: actor, action, target_id: targetId, detail }))
  }

  return {
    async reserveAttempt(projectId, ipHash, limits) {
      const rows = check(await db.rpc('site_access_reserve_attempt', {
        p_project_id: projectId, p_ip_hash: ipHash, p_window_seconds: limits.windowSeconds,
        p_per_ip: limits.perIpProject, p_per_ip_pressure: limits.perIpProjectUnderPressure,
        p_per_ip_all: limits.perIpAllProjects, p_pressure: limits.projectPressure,
      })) as Array<{ allowed: boolean; attempt_id: number | null; under_pressure: boolean; retry_after_seconds: number }> | null
      const r = rows?.[0]
      if (!r) throw new AccessError('unavailable', 'attempt reservation empty')
      if (r.allowed && typeof r.attempt_id === 'number') return { allowed: true, attemptId: r.attempt_id, underPressure: r.under_pressure }
      if (r.allowed) throw new AccessError('unavailable', 'attempt reservation without id')
      return { allowed: false, retryAfterSeconds: r.retry_after_seconds, underPressure: r.under_pressure }
    },

    async failAttempt(projectId, attemptId) {
      check(await db.rpc('site_access_finish_attempt', { p_project_id: projectId, p_attempt_id: attemptId, p_succeeded: false }))
    },

    async candidateCredentials(projectId, groupIds) {
      const rows = check(await db.rpc('site_access_candidate_credentials', { p_project_id: projectId, p_group_ids: groupIds })) as
        Array<{ credential_id: string; secret_version: number; password_hash: string; group_ids: string[] }> | null
      return (rows ?? []).map((r) => ({ credentialId: r.credential_id, secretVersion: r.secret_version, passwordHash: r.password_hash, groupIds: r.group_ids ?? [] }))
    },

    async unlock(i) {
      return check(await db.rpc('site_access_unlock', {
        p_project_id: i.projectId,
        p_environment: i.environment,
        p_credential_id: i.credentialId,
        p_credential_version: i.credentialVersion,
        p_current_token_hash: i.currentTokenHash,
        p_new_token_hash: i.newTokenHash,
        p_session_seconds: i.sessionSeconds,
        p_attempt_id: i.attemptId,
        p_device_label: i.deviceLabel,
      })) as string
    },

    async resolve(projectId, environment, tokenHash) {
      const rows = check(await db.rpc('site_access_resolve', { p_project_id: projectId, p_token_hash: tokenHash, p_environment: environment, p_touch: true })) as
        Array<{ session_id: string; expires_at: string; group_ids: string[]; credential_ids: string[] }> | null
      const r = rows?.[0]
      return r ? { sessionId: r.session_id, expiresAt: r.expires_at, groupIds: r.group_ids ?? [], credentialIds: r.credential_ids ?? [] } : null
    },

    async revokeSessions(projectId, sessionId, reason, actor) {
      return check(await db.rpc('site_access_revoke_sessions', { p_project_id: projectId, p_session_id: sessionId, p_reason: reason, p_actor: actor })) as number
    },

    async sessionSummary(projectId, environment) {
      const rows = check(await db.rpc('site_access_session_summary', { p_project_id: projectId, p_environment: environment })) as
        Array<{ group_id: string | null; signed_in: number }> | null
      const out: SessionSummary = { total: 0, byGroup: {} }
      for (const r of rows ?? []) {
        if (r.group_id === null) out.total = r.signed_in
        else out.byGroup[r.group_id] = r.signed_in
      }
      return out
    },

    async listGroups(projectId) {
      const rows = check(await db.from('site_access_groups')
        .select('id, name, description, sort_order, archived_at')
        .eq('project_id', projectId)
        .order('sort_order').order('created_at')) as Array<{ id: string; name: LocalizedName; description: string | null; sort_order: number; archived_at: string | null }>
      return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, sortOrder: r.sort_order, archivedAt: r.archived_at }))
    },

    async createGroup(projectId, input, actor) {
      const row = check(await db.from('site_access_groups')
        .insert({ project_id: projectId, name: input.name, description: input.description, created_by: actor })
        .select('id').single()) as { id: string }
      await event(projectId, actor, 'group_created', row.id)
      return row.id
    },

    async updateGroup(projectId, groupId, input, actor) {
      const patch: Record<string, unknown> = {}
      if (input.name !== undefined) patch.name = input.name
      if (input.description !== undefined) patch.description = input.description
      if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder
      const rows = check(await db.from('site_access_groups').update(patch).eq('project_id', projectId).eq('id', groupId).select('id')) as unknown[]
      if (rows.length === 0) throw new AccessError('not_found')
      await event(projectId, actor, 'group_updated', groupId)
    },

    async setGroupArchived(projectId, groupId, archived, actor) {
      const rows = check(await db.from('site_access_groups')
        .update({ archived_at: archived ? new Date().toISOString() : null })
        .eq('project_id', projectId).eq('id', groupId).select('id')) as unknown[]
      if (rows.length === 0) throw new AccessError('not_found')
      await event(projectId, actor, archived ? 'group_archived' : 'group_restored', groupId)
    },

    async listCredentials(projectId) {
      const creds = check(await db.from('site_access_credentials')
        .select('id, label, secret_version, expires_at, disabled_at, rotated_at, created_at')
        .eq('project_id', projectId).order('created_at')) as Array<{ id: string; label: string; secret_version: number; expires_at: string | null; disabled_at: string | null; rotated_at: string | null; created_at: string }>
      const links = check(await db.from('site_access_credential_groups')
        .select('credential_id, group_id').eq('project_id', projectId)) as Array<{ credential_id: string; group_id: string }>
      return creds.map((c) => ({
        id: c.id, label: c.label, secretVersion: c.secret_version, expiresAt: c.expires_at, disabledAt: c.disabled_at,
        rotatedAt: c.rotated_at, createdAt: c.created_at,
        groupIds: links.filter((l) => l.credential_id === c.id).map((l) => l.group_id).sort(),
      }))
    },

    async createCredential(projectId, input, actor) {
      return check(await db.rpc('site_access_create_credential', {
        p_project_id: projectId, p_label: input.label, p_password_hash: input.passwordHash,
        p_group_ids: input.groupIds, p_expires_at: input.expiresAt, p_actor: actor,
      })) as string
    },

    async setCredentialGroups(projectId, credentialId, groupIds, actor) {
      check(await db.rpc('site_access_set_credential_groups', { p_project_id: projectId, p_credential_id: credentialId, p_group_ids: groupIds, p_actor: actor }))
    },

    async rotateCredential(projectId, credentialId, passwordHash, actor) {
      return check(await db.rpc('site_access_rotate_credential', { p_project_id: projectId, p_credential_id: credentialId, p_password_hash: passwordHash, p_actor: actor })) as number
    },

    async setCredentialDisabled(projectId, credentialId, disabled, actor) {
      return check(await db.rpc('site_access_set_credential_disabled', { p_project_id: projectId, p_credential_id: credentialId, p_disabled: disabled, p_actor: actor })) as number
    },

    // ── documents (052 + 054) ─────────────────────────────────────────────────
    async listDocuments(projectId) {
      const docs = check(await db.from('site_access_documents')
        .select('id, title, note, visibility, category_term_id, tag_term_ids, archived_at, created_at')
        .eq('project_id', projectId).order('created_at', { ascending: false })) as Array<{
          id: string; title: LocalizedName; note: LocalizedName | null; visibility: DocumentVisibility; category_term_id: string | null
          tag_term_ids: string[] | null; archived_at: string | null; created_at: string }>
      const [groups, files, placements] = await Promise.all([
        db.from('site_access_document_groups').select('document_id, group_id').eq('project_id', projectId),
        db.from('site_access_document_files').select('document_id, locale, mime_type, size_bytes, sha256, original_filename, uploaded_at').eq('project_id', projectId),
        db.from('site_access_document_placements').select('document_id, page_id, sort_order').eq('project_id', projectId),
      ])
      const g = check(groups) as Array<{ document_id: string; group_id: string }>
      const f = check(files) as Array<{ document_id: string; locale: string; mime_type: DocumentMimeType; size_bytes: number; sha256: string; original_filename: string | null; uploaded_at: string }>
      const p = check(placements) as Array<{ document_id: string; page_id: string; sort_order: number }>
      return docs.map((d) => ({
        id: d.id, title: d.title, note: d.note ?? null, visibility: d.visibility, categoryTermId: d.category_term_id,
        tagTermIds: d.tag_term_ids ?? [], archivedAt: d.archived_at, createdAt: d.created_at,
        groupIds: g.filter((x) => x.document_id === d.id).map((x) => x.group_id).sort(),
        files: f.filter((x) => x.document_id === d.id)
          .map((x) => ({ locale: x.locale, mimeType: x.mime_type, sizeBytes: x.size_bytes, sha256: x.sha256, originalFilename: x.original_filename, uploadedAt: x.uploaded_at }))
          .sort((a, b) => a.locale.localeCompare(b.locale)),
        pageIds: p.filter((x) => x.document_id === d.id).map((x) => x.page_id).sort(),
        pageOrder: Object.fromEntries(p.filter((x) => x.document_id === d.id).map((x) => [x.page_id, x.sort_order])),
      }))
    },

    async createDocument(projectId, input, actor) {
      return check(await db.rpc('site_access_create_document_v2', {
        p_project_id: projectId, p_title: input.title, p_note: input.note, p_visibility: input.visibility, p_group_ids: input.groupIds,
        p_category_term_id: input.categoryTermId, p_tag_term_ids: input.tagTermIds, p_actor: actor,
      })) as string
    },

    async updateDocument(projectId, documentId, input, actor) {
      check(await db.rpc('site_access_update_document_v2', {
        p_project_id: projectId, p_document_id: documentId, p_title: input.title, p_note: input.note,
        p_category_term_id: input.categoryTermId, p_tag_term_ids: input.tagTermIds, p_actor: actor,
      }))
    },

    async setDocumentAccess(projectId, documentId, input, actor) {
      check(await db.rpc('site_access_set_document_access', {
        p_project_id: projectId, p_document_id: documentId, p_visibility: input.visibility, p_group_ids: input.groupIds, p_actor: actor,
      }))
    },

    async setDocumentPlacements(projectId, documentId, pageIds, actor) {
      check(await db.rpc('site_access_set_document_placements', { p_project_id: projectId, p_document_id: documentId, p_page_ids: pageIds, p_actor: actor }))
    },

    async reorderPageDocuments(projectId, pageId, documentIds, actor) {
      check(await db.rpc('site_access_reorder_page_documents', { p_project_id: projectId, p_page_id: pageId, p_document_ids: documentIds, p_actor: actor }))
    },

    async removeDocumentLanguages(projectId, documentId, locales, actor) {
      return check(await db.rpc('site_access_remove_document_languages', { p_project_id: projectId, p_document_id: documentId, p_locales: locales, p_actor: actor })) as number
    },

    async setDocumentArchived(projectId, documentId, archived, actor) {
      check(await db.rpc('site_access_set_document_archived', { p_project_id: projectId, p_document_id: documentId, p_archived: archived, p_actor: actor }))
    },

    async deleteDocuments(projectId, documentIds, actor) {
      return check(await db.rpc('site_access_delete_documents', { p_project_id: projectId, p_document_ids: documentIds, p_actor: actor })) as number
    },

    async beginUpload(projectId, i, actor) {
      const rows = check(await db.rpc('site_access_begin_upload_v2', {
        p_project_id: projectId, p_document_id: i.documentId, p_locales: i.locales, p_mime: i.mimeType, p_size: i.sizeBytes,
        p_sha256: i.sha256, p_filename: i.filename, p_actor: actor, p_ttl_seconds: i.ttlSeconds,
      })) as Array<{ upload_id: string; storage_path: string; expires_at: string }> | null
      const r = rows?.[0]
      if (!r) throw new AccessError('unavailable', 'upload reservation empty')
      return { uploadId: r.upload_id, storagePath: r.storage_path, expiresAt: r.expires_at }
    },

    async getUpload(projectId, uploadId) {
      const rows = check(await db.from('site_access_uploads')
        .select('id, document_id, locale, locales, mime_type, storage_path, declared_size, declared_sha256, status, expires_at')
        .eq('project_id', projectId).eq('id', uploadId)) as Array<{ id: string; document_id: string; locale: string; locales: string[] | null; mime_type: DocumentMimeType; storage_path: string; declared_size: number; declared_sha256: string; status: PendingUpload['status']; expires_at: string }>
      const r = rows[0]
      return r ? {
        uploadId: r.id, documentId: r.document_id, locale: r.locale, locales: r.locales?.length ? r.locales : [r.locale], mimeType: r.mime_type,
        storagePath: r.storage_path, declaredSize: r.declared_size, declaredSha256: r.declared_sha256, status: r.status, expiresAt: r.expires_at,
      } : null
    },

    async finishUpload(projectId, uploadId, measured, actor) {
      return check(await db.rpc('site_access_finish_upload', { p_project_id: projectId, p_upload_id: uploadId, p_size: measured.sizeBytes, p_sha256: measured.sha256, p_actor: actor })) as string | null
    },

    async failUpload(projectId, uploadId) {
      check(await db.rpc('site_access_fail_upload', { p_project_id: projectId, p_upload_id: uploadId }))
    },

    async documentForDelivery(projectId, documentId, locales) {
      const rows = check(await db.rpc('site_access_document_for_delivery_v2', { p_project_id: projectId, p_document_id: documentId, p_locales: locales })) as
        Array<{ archived: boolean; visibility: DocumentVisibility; title: LocalizedName; group_ids: string[]; locale: string; storage_path: string; size_bytes: number; sha256: string; mime_type: DocumentMimeType }> | null
      const r = rows?.[0]
      return r ? {
        archived: r.archived, visibility: r.visibility, title: r.title, groupIds: r.group_ids ?? [], locale: r.locale,
        storagePath: r.storage_path, sizeBytes: r.size_bytes, sha256: r.sha256, mimeType: r.mime_type,
      } : null
    },

    async pageDocuments(projectId, pageIds) {
      if (pageIds.length === 0) return []
      const rows = check(await db.rpc('site_access_page_documents', { p_project_id: projectId, p_page_ids: pageIds })) as Array<{
        page_id: string; sort_order: number; document_id: string; visibility: DocumentVisibility; title: LocalizedName; note: LocalizedName | null
        category_term_id: string | null; tag_term_ids: string[] | null; group_ids: string[] | null
        files: Array<{ locale: string; mimeType: DocumentMimeType; sizeBytes: number; uploadedAt: string }> | null; updated_at: string }> | null
      return (rows ?? []).map((r) => ({
        pageId: r.page_id, sortOrder: r.sort_order, documentId: r.document_id, visibility: r.visibility, title: r.title, note: r.note ?? null,
        categoryTermId: r.category_term_id, tagTermIds: r.tag_term_ids ?? [], groupIds: r.group_ids ?? [], files: r.files ?? [], updatedAt: r.updated_at,
      }))
    },

    async expireUploads(limit) {
      return check(await db.rpc('site_access_expire_uploads', { p_limit: limit })) as number
    },

    async trashBatch(limit) {
      const rows = check(await db.rpc('site_access_trash_batch', { p_limit: limit })) as Array<{ storage_path: string; project_id: string }> | null
      return (rows ?? []).map((r) => ({ storagePath: r.storage_path, projectId: r.project_id }))
    },

    async trashDone(paths) {
      return check(await db.rpc('site_access_trash_done', { p_paths: paths })) as number
    },
  }
}
