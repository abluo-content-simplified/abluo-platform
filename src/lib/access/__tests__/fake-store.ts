/**
 * In-memory SiteAccessStore that mirrors the migration-050 SQL semantics
 * (project-keyed everything, composite-FK refusals, live group resolution,
 * rotation/disable dropping grants). The SQL itself is proven against a real
 * Postgres in supabase/verify/hardening-050.verify.mjs; this fake lets the
 * service be tested without one.
 */
import { randomUUID } from 'crypto'
import type { AccessEnvironment } from '../environment'
import { AccessError, type RevokeReason } from '../model'
import type { RateLimits } from '../rate-limit'
import type { CredentialRow, DeliverableFile, DocumentRow, GroupRow, PendingUpload, ResolvedSession, SiteAccessStore } from '../store'

type Group = GroupRow & { projectId: string }
type Cred = { id: string; projectId: string; label: string; version: number; hash: string; groupIds: string[]; expiresAt: string | null; disabledAt: string | null; rotatedAt: string | null; createdAt: string }
type Session = { id: string; projectId: string; environment: AccessEnvironment; tokenHash: string; expiresAt: number; revokedAt: number | null; revokedReason: RevokeReason | null; grants: Map<string, number> }
type Attempt = { id: number; projectId: string; ipHash: string; succeeded: boolean | null; at: number }
type Doc = { id: string; projectId: string; title: Record<string, string>; sortOrder: number; archivedAt: string | null; groupIds: string[] }
type DocFile = { documentId: string; projectId: string; locale: string; storagePath: string; sizeBytes: number; sha256: string; originalFilename: string | null; uploadedAt: string }
type Upload = PendingUpload & { projectId: string; filename: string | null }

export type FakeStore = SiteAccessStore & {
  groups: Group[]; creds: Cred[]; sessions: Session[]; attempts: Attempt[]; events: Array<{ projectId: string; action: string }>
  docs: Doc[]; files: DocFile[]; uploads: Upload[]; trash: Array<{ storagePath: string; projectId: string; reason: string }>
  calls: string[]
  failNext?: { method: string; error: Error }
}

export function createFakeStore(now: () => number = Date.now): FakeStore {
  const s: FakeStore = {
    groups: [], creds: [], sessions: [], attempts: [], events: [], calls: [],
    docs: [], files: [], uploads: [], trash: [],
  } as unknown as FakeStore

  const call = (m: string) => {
    s.calls.push(m)
    if (s.failNext?.method === m) { const e = s.failNext.error; s.failNext = undefined; throw e }
  }
  const credUsable = (c: Cred) => !c.disabledAt && (!c.expiresAt || Date.parse(c.expiresAt) > now())
  const liveGroup = (projectId: string, id: string) => s.groups.find((g) => g.id === id && g.projectId === projectId && !g.archivedAt)
  const sameProjectGroups = (projectId: string, ids: string[]) => {
    for (const id of ids) if (!s.groups.some((g) => g.id === id && g.projectId === projectId)) throw new AccessError('invalid_input', '23503')
  }
  const dropGrants = (projectId: string, credId: string, reason: RevokeReason) => {
    let n = 0
    for (const sess of s.sessions.filter((x) => x.projectId === projectId)) {
      if (sess.grants.delete(credId) && sess.grants.size === 0 && sess.revokedAt === null) {
        sess.revokedAt = now(); sess.revokedReason = reason; n++
      }
    }
    return n
  }

  Object.assign(s, {
    // Mirrors site_access_reserve_attempt(): the body runs without awaiting, so
    // like the advisory lock it is atomic with respect to parallel callers.
    async reserveAttempt(projectId: string, ipHash: string, limits: RateLimits) {
      call('reserveAttempt')
      const since = now() - limits.windowSeconds * 1000
      const counted = s.attempts.filter((a) => a.succeeded !== true && a.at > since)
      const ipProject = counted.filter((a) => a.ipHash === ipHash && a.projectId === projectId).length
      const ipAll = counted.filter((a) => a.ipHash === ipHash).length
      const underPressure = counted.filter((a) => a.projectId === projectId).length >= limits.projectPressure
      const limit = underPressure ? limits.perIpProjectUnderPressure : limits.perIpProject
      if (ipProject >= limit || ipAll >= limits.perIpAllProjects) return { allowed: false as const, retryAfterSeconds: limits.windowSeconds, underPressure }
      const id = s.attempts.length + 1
      s.attempts.push({ id, projectId, ipHash, succeeded: null, at: now() })
      return { allowed: true as const, attemptId: id, underPressure }
    },
    async failAttempt(projectId: string, attemptId: number) {
      call('failAttempt')
      const a = s.attempts.find((x) => x.id === attemptId && x.projectId === projectId && x.succeeded === null)
      if (a) a.succeeded = false
    },
    async candidateCredentials(projectId: string, groupIds: string[] | null) {
      call('candidateCredentials')
      return s.creds
        .filter((c) => c.projectId === projectId && credUsable(c))
        .map((c) => ({ c, live: c.groupIds.filter((g) => liveGroup(projectId, g)) }))
        .filter(({ live }) => groupIds === null || live.some((g) => groupIds.includes(g)))
        .map(({ c, live }) => ({ credentialId: c.id, secretVersion: c.version, passwordHash: c.hash, groupIds: [...live].sort() }))
    },
    async unlock(i: Parameters<SiteAccessStore['unlock']>[0]) {
      call('unlock')
      const c = s.creds.find((x) => x.id === i.credentialId && x.projectId === i.projectId)
      if (!c || !credUsable(c) || c.version !== i.credentialVersion) throw new AccessError('credential_unavailable')
      let sess = i.currentTokenHash
        ? s.sessions.find((x) => x.tokenHash === i.currentTokenHash && x.projectId === i.projectId && x.environment === i.environment && x.revokedAt === null && x.expiresAt > now())
        : undefined
      if (sess) { sess.tokenHash = i.newTokenHash; sess.expiresAt = Math.max(sess.expiresAt, now() + i.sessionSeconds * 1000) }
      else {
        sess = { id: randomUUID(), projectId: i.projectId, environment: i.environment, tokenHash: i.newTokenHash, expiresAt: now() + i.sessionSeconds * 1000, revokedAt: null, revokedReason: null, grants: new Map() }
        s.sessions.push(sess)
      }
      if (!sess.grants.has(c.id) && sess.grants.size >= 20) throw new AccessError('limit_reached', 'too_many_grants')
      sess.grants.set(c.id, c.version)
      const att = i.attemptId === null ? undefined : s.attempts.find((x) => x.id === i.attemptId && x.projectId === i.projectId && x.succeeded === null)
      if (att) att.succeeded = true
      return sess.id
    },
    async resolve(projectId: string, environment: AccessEnvironment, tokenHash: string): Promise<ResolvedSession | null> {
      call('resolve')
      const sess = s.sessions.find((x) => x.tokenHash === tokenHash && x.projectId === projectId && x.environment === environment && x.revokedAt === null && x.expiresAt > now())
      if (!sess) return null
      const creds = [...sess.grants].map(([id, v]) => s.creds.find((c) => c.id === id && c.projectId === projectId && credUsable(c) && c.version === v)).filter(Boolean) as Cred[]
      const groups = new Set(creds.flatMap((c) => c.groupIds.filter((g) => liveGroup(projectId, g))))
      return { sessionId: sess.id, expiresAt: new Date(sess.expiresAt).toISOString(), groupIds: [...groups], credentialIds: creds.map((c) => c.id) }
    },
    async revokeSessions(projectId: string, sessionId: string | null, reason: RevokeReason) {
      call('revokeSessions')
      let n = 0
      for (const sess of s.sessions) {
        if (sess.projectId === projectId && sess.revokedAt === null && (sessionId === null || sess.id === sessionId)) {
          sess.revokedAt = now(); sess.revokedReason = reason; n++
        }
      }
      if (reason !== 'logout') s.events.push({ projectId, action: 'sessions_revoked' })
      return n
    },
    // Mirrors site_access_session_summary() (053).
    async sessionSummary(projectId: string, environment: AccessEnvironment) {
      call('sessionSummary')
      const byGroup: Record<string, number> = {}
      let total = 0
      for (const sess of s.sessions) {
        if (sess.projectId !== projectId || sess.environment !== environment || sess.revokedAt !== null || sess.expiresAt <= now()) continue
        const groups = new Set<string>()
        for (const [credId, v] of sess.grants) {
          const c = s.creds.find((x) => x.id === credId && x.projectId === projectId && credUsable(x) && x.version === v)
          for (const g of c?.groupIds ?? []) if (liveGroup(projectId, g)) groups.add(g)
        }
        if (groups.size === 0) continue
        total++
        for (const g of groups) byGroup[g] = (byGroup[g] ?? 0) + 1
      }
      return { total, byGroup }
    },
    async listGroups(projectId: string) {
      call('listGroups')
      return s.groups.filter((g) => g.projectId === projectId).map((g) => ({ id: g.id, name: g.name, description: g.description, sortOrder: g.sortOrder, archivedAt: g.archivedAt }))
    },
    async createGroup(projectId: string, input: { name: Record<string, string>; description: string | null }) {
      call('createGroup')
      if (s.groups.filter((g) => g.projectId === projectId).length >= 100) throw new AccessError('limit_reached', 'too_many_groups')
      const id = randomUUID()
      s.groups.push({ id, projectId, name: input.name, description: input.description, sortOrder: 0, archivedAt: null })
      s.events.push({ projectId, action: 'group_created' })
      return id
    },
    async updateGroup(projectId: string, groupId: string, input: { name?: Record<string, string> }) {
      call('updateGroup')
      const g = s.groups.find((x) => x.id === groupId && x.projectId === projectId)
      if (!g) throw new AccessError('not_found')
      if (input.name) g.name = input.name
    },
    async setGroupArchived(projectId: string, groupId: string, archived: boolean) {
      call('setGroupArchived')
      const g = s.groups.find((x) => x.id === groupId && x.projectId === projectId)
      if (!g) throw new AccessError('not_found')
      g.archivedAt = archived ? new Date(now()).toISOString() : null
    },
    async listCredentials(projectId: string): Promise<CredentialRow[]> {
      call('listCredentials')
      return s.creds.filter((c) => c.projectId === projectId).map((c) => ({
        id: c.id, label: c.label, secretVersion: c.version, expiresAt: c.expiresAt, disabledAt: c.disabledAt, rotatedAt: c.rotatedAt, createdAt: c.createdAt, groupIds: [...c.groupIds].sort(),
      }))
    },
    async createCredential(projectId: string, input: { label: string; passwordHash: string; groupIds: string[]; expiresAt: string | null }) {
      call('createCredential')
      sameProjectGroups(projectId, input.groupIds)
      const id = randomUUID()
      s.creds.push({ id, projectId, label: input.label, version: 1, hash: input.passwordHash, groupIds: [...input.groupIds], expiresAt: input.expiresAt, disabledAt: null, rotatedAt: null, createdAt: new Date(now()).toISOString() })
      s.events.push({ projectId, action: 'credential_created' })
      return id
    },
    async setCredentialGroups(projectId: string, credentialId: string, groupIds: string[]) {
      call('setCredentialGroups')
      const c = s.creds.find((x) => x.id === credentialId && x.projectId === projectId)
      if (!c) throw new AccessError('not_found')
      sameProjectGroups(projectId, groupIds)
      c.groupIds = [...groupIds]
    },
    async rotateCredential(projectId: string, credentialId: string, passwordHash: string) {
      call('rotateCredential')
      const c = s.creds.find((x) => x.id === credentialId && x.projectId === projectId)
      if (!c) throw new AccessError('not_found')
      c.version++; c.hash = passwordHash; c.rotatedAt = new Date(now()).toISOString()
      s.events.push({ projectId, action: 'credential_rotated' })
      return dropGrants(projectId, credentialId, 'credential_rotated')
    },
    async setCredentialDisabled(projectId: string, credentialId: string, disabled: boolean) {
      call('setCredentialDisabled')
      const c = s.creds.find((x) => x.id === credentialId && x.projectId === projectId)
      if (!c) throw new AccessError('not_found')
      c.disabledAt = disabled ? (c.disabledAt ?? new Date(now()).toISOString()) : null
      return disabled ? dropGrants(projectId, credentialId, 'credential_disabled') : 0
    },

    // ── documents: mirrors migration 052 (proven in hardening-052.verify.mjs) ──
    async listDocuments(projectId: string): Promise<DocumentRow[]> {
      call('listDocuments')
      return s.docs.filter((d) => d.projectId === projectId).map((d) => ({
        id: d.id, title: d.title, sortOrder: d.sortOrder, archivedAt: d.archivedAt, groupIds: [...d.groupIds].sort(),
        files: s.files.filter((f) => f.documentId === d.id && f.projectId === projectId).map((f) => ({ locale: f.locale, sizeBytes: f.sizeBytes, sha256: f.sha256, originalFilename: f.originalFilename, uploadedAt: f.uploadedAt })),
      }))
    },
    async createDocument(projectId: string, input: { title: Record<string, string>; groupIds: string[] }) {
      call('createDocument')
      sameProjectGroups(projectId, input.groupIds)
      const id = randomUUID()
      s.docs.push({ id, projectId, title: input.title, sortOrder: 0, archivedAt: null, groupIds: [...new Set(input.groupIds)] })
      s.events.push({ projectId, action: 'document_created' })
      return id
    },
    async updateDocument(projectId: string, documentId: string, input: { title?: Record<string, string>; sortOrder?: number }) {
      call('updateDocument')
      const d = s.docs.find((x) => x.id === documentId && x.projectId === projectId)
      if (!d) throw new AccessError('not_found')
      if (input.title) d.title = input.title
      if (input.sortOrder !== undefined) d.sortOrder = input.sortOrder
    },
    async setDocumentGroups(projectId: string, documentId: string, groupIds: string[]) {
      call('setDocumentGroups')
      const d = s.docs.find((x) => x.id === documentId && x.projectId === projectId)
      if (!d) throw new AccessError('not_found')
      sameProjectGroups(projectId, groupIds)
      d.groupIds = [...new Set(groupIds)]
      s.events.push({ projectId, action: 'document_groups_changed' })
    },
    async setDocumentArchived(projectId: string, documentId: string, archived: boolean) {
      call('setDocumentArchived')
      const d = s.docs.find((x) => x.id === documentId && x.projectId === projectId)
      if (!d) throw new AccessError('not_found')
      d.archivedAt = archived ? (d.archivedAt ?? new Date(now()).toISOString()) : null
    },
    async beginUpload(projectId: string, i: { documentId: string; locale: string; sizeBytes: number; sha256: string; filename: string | null; ttlSeconds: number }) {
      call('beginUpload')
      const d = s.docs.find((x) => x.id === i.documentId && x.projectId === projectId && !x.archivedAt)
      if (!d) throw new AccessError('not_found')
      if (i.sizeBytes <= 0 || i.sizeBytes > 20 * 1024 * 1024 || !/^[0-9a-f]{64}$/.test(i.sha256) || !/^[a-z]{2}(-[A-Z]{2})?$/.test(i.locale)) throw new AccessError('invalid_input', '23514')
      if (s.uploads.filter((u) => u.projectId === projectId && u.status === 'pending' && Date.parse(u.expiresAt) > now()).length >= 20) throw new AccessError('limit_reached', 'too_many_uploads')
      const uploadId = randomUUID()
      const storagePath = `${projectId}/${randomUUID()}.pdf`
      const expiresAt = new Date(now() + i.ttlSeconds * 1000).toISOString()
      s.uploads.push({ uploadId, projectId, documentId: i.documentId, locale: i.locale, storagePath, declaredSize: i.sizeBytes, declaredSha256: i.sha256, status: 'pending', expiresAt, filename: i.filename })
      return { uploadId, storagePath, expiresAt }
    },
    async getUpload(projectId: string, uploadId: string) {
      call('getUpload')
      const u = s.uploads.find((x) => x.uploadId === uploadId && x.projectId === projectId)
      if (!u) return null
      const { projectId: _p, filename: _f, ...rest } = u
      void _p; void _f
      return { ...rest }
    },
    async finishUpload(projectId: string, uploadId: string, m: { sizeBytes: number; sha256: string }) {
      call('finishUpload')
      const u = s.uploads.find((x) => x.uploadId === uploadId && x.projectId === projectId)
      if (!u || u.status !== 'pending' || Date.parse(u.expiresAt) <= now()) throw new AccessError('not_found', 'upload_unavailable')
      if (m.sizeBytes !== u.declaredSize || m.sha256 !== u.declaredSha256) throw new AccessError('invalid_input', 'upload_mismatch')
      const d = s.docs.find((x) => x.id === u.documentId && x.projectId === projectId && !x.archivedAt)
      if (!d) throw new AccessError('not_found')
      const existing = s.files.find((f) => f.documentId === u.documentId && f.projectId === projectId && f.locale === u.locale)
      let old: string | null = null
      const row = { documentId: u.documentId, projectId, locale: u.locale, storagePath: u.storagePath, sizeBytes: m.sizeBytes, sha256: m.sha256, originalFilename: u.filename, uploadedAt: new Date(now()).toISOString() }
      if (existing) { old = existing.storagePath; Object.assign(existing, row); s.trash.push({ storagePath: old, projectId, reason: 'replaced' }) }
      else s.files.push(row)
      u.status = 'finished'
      s.events.push({ projectId, action: old ? 'document_file_replaced' : 'document_file_uploaded' })
      return old
    },
    async failUpload(projectId: string, uploadId: string) {
      call('failUpload')
      const u = s.uploads.find((x) => x.uploadId === uploadId && x.projectId === projectId && x.status === 'pending')
      if (u) { u.status = 'failed'; s.trash.push({ storagePath: u.storagePath, projectId, reason: 'failed_upload' }) }
    },
    async documentForDelivery(projectId: string, documentId: string, locales: string[]): Promise<DeliverableFile | null> {
      call('documentForDelivery')
      const d = s.docs.find((x) => x.id === documentId && x.projectId === projectId)
      if (!d) return null
      for (const l of locales) {
        const f = s.files.find((x) => x.documentId === d.id && x.projectId === projectId && x.locale === l)
        if (f) return { archived: d.archivedAt !== null, title: d.title, groupIds: d.groupIds.filter((g) => liveGroup(projectId, g)).sort(), locale: f.locale, storagePath: f.storagePath, sizeBytes: f.sizeBytes, sha256: f.sha256 }
      }
      return null
    },
    async expireUploads() {
      call('expireUploads')
      let n = 0
      for (const u of s.uploads) if (u.status === 'pending' && Date.parse(u.expiresAt) <= now()) { u.status = 'expired'; s.trash.push({ storagePath: u.storagePath, projectId: u.projectId, reason: 'expired_upload' }); n++ }
      return n
    },
    async trashBatch(limit: number) {
      call('trashBatch')
      const active = new Set(s.files.map((f) => f.storagePath))
      s.trash = s.trash.filter((t) => !active.has(t.storagePath))
      const pending = new Set(s.uploads.filter((u) => u.status === 'pending' && Date.parse(u.expiresAt) > now()).map((u) => u.storagePath))
      return s.trash.filter((t) => !pending.has(t.storagePath)).slice(0, limit).map((t) => ({ storagePath: t.storagePath, projectId: t.projectId }))
    },
    async trashDone(paths: string[]) {
      call('trashDone')
      const active = new Set(s.files.map((f) => f.storagePath))
      const before = s.trash.length
      s.trash = s.trash.filter((t) => !(paths.includes(t.storagePath) && !active.has(t.storagePath)))
      return before - s.trash.length
    },
  })
  return s
}
