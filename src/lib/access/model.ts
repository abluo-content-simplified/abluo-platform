/**
 * Site Access — shared vocabulary (ADR-040). Pure and client-safe: no I/O, no
 * server imports. Migration 050 is the authority for the database rules; the
 * constants here mirror it for the service, the UI (B2) and the tests.
 *
 * Two identity planes, never mixed:
 *   - the DASHBOARD plane: Supabase Auth users, tenant/project memberships,
 *     `can()` (ADR-028). Who may MANAGE access.
 *   - the VISITOR plane (this module): cookie → site_access_sessions → grants →
 *     groups. Who may OPEN a restricted page or file. Nothing on this plane is a
 *     Supabase Auth user, and nothing on it can satisfy a dashboard check.
 */

/**
 * The owning module id. Matches the `members.*` permission prefix ADR-028
 * reserved for ADR-024 (superseded by ADR-040). The user-facing name is
 * "Access" — the id stays `members` so the reservation keeps holding.
 */
export const ACCESS_MODULE_ID = 'members'

/** Dashboard permissions (declared in the module manifest in B2). */
export const ACCESS_PERMISSIONS = {
  /** See the Access screens: groups, password labels, documents, session counts. */
  read: 'members.access.read',
  /** Create/rename/archive groups, create/rotate/disable passwords, upload files, revoke. */
  manage: 'members.access.manage',
} as const

/**
 * The Documents module (ADR-040 §15, R9): the document library. Any project may
 * install it; with Access (`members`) also installed, a document may be limited
 * to groups. Shown as "Documents".
 */
export const DOCUMENTS_MODULE_ID = 'documents'

export const DOCUMENTS_PERMISSIONS = {
  /** See the documents and on which pages they show. */
  read: 'documents.document.read',
  /** Add, change, place and archive documents — never groups or passwords. */
  manage: 'documents.document.manage',
  /** Delete ARCHIVED documents for good (R9.3). Owner only; never an extra, never support. */
  delete: 'documents.document.delete',
} as const

export const ACCESS_LIMITS = {
  /** Default "remember me" (Tom, 2026-10-24: 30 days, revocable). */
  sessionDays: 30,
  passwordMinLength: 10,
  passwordMaxLength: 200,
  labelMax: 80,
  groupNameMax: 80,
  groupsPerProject: 100,
  credentialsPerProject: 50,
  documentsPerProject: 500,
  grantsPerSession: 20,
  /** The largest file of any type (PDF). Bucket limit and DB check agree; images are capped at 10 MB. */
  fileBytesMax: 20 * 1024 * 1024,
  /** A short note shown to visitors under a document's title. */
  noteMax: 200,
  documentTitleMax: 120,
  tagsPerDocument: 20,
  pagesPerDocument: 50,
  /** Documents changed or deleted in one go from the list (055 refuses more than 100). */
  documentsPerBatch: 100,
  /** Signed storage URLs are bearer links: usable WITHOUT a session until they expire. */
  signedUrlSeconds: 60,
} as const

export const ACCESS_BUCKET = 'site-access-files'

/**
 * Stable codes the API returns. Visitor-facing sentences come from locale
 * dictionaries (B2), never from here.
 */
export type AccessErrorCode =
  | 'unavailable'          // module off, tables missing, secret missing
  | 'wrong_password'
  | 'too_many_attempts'
  | 'try_later'            // rate-limit store unreadable → fail closed
  | 'credential_unavailable'
  | 'not_found'
  | 'invalid_input'
  | 'limit_reached'

export class AccessError extends Error {
  constructor(public readonly code: AccessErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'AccessError'
  }
}

/** Why a session was revoked — mirrors the migration 050 check constraint. */
export type RevokeReason = 'logout' | 'credential_rotated' | 'credential_disabled' | 'revoked_by_admin' | 'revoked_all'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}
