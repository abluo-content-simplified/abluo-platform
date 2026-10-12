// ── Connections — persistence boundary ────────────────────────────────────────
//
// Everything that reads or writes the migration-040 tables goes through this
// interface. Two implementations:
//   - supabase-store.ts  production (service role, server-only)
//   - testing/memory-store.ts  tests: the SAME security logic runs against it
//
// Methods that guard a race are ATOMIC by contract (single conditional UPDATE
// in SQL): consumeCode, retireToken. Database invariants (hash shapes, S256
// only, ≤ 10-minute codes, one live connection per app × project, a revoked
// connection never comes back) are enforced by migration 040 itself and proven
// by supabase/verify/hardening-040.verify.mjs.

import type {
  ConnectionAuditEntry,
  ConnectionRow,
  ConnectionStatus,
  OAuthCodeRow,
  PartnerAppRow,
  ProjectRef,
  TokenKind,
  TokenRow,
} from './types'

export interface NewToken {
  connection_id: string
  kind: TokenKind
  token_hash: string
  token_prefix: string
  expires_at: string
}

export interface RevokeTokensFilter {
  connectionId: string
  /** Only these kinds (default: both). */
  kind?: TokenKind
  /** Only tokens created at or after this instant. */
  createdAtOrAfter?: string
  /** Only these ids. */
  ids?: string[]
}

export type ConsumeCodeResult =
  | { state: 'consumed'; row: OAuthCodeRow }
  | { state: 'replayed'; row: OAuthCodeRow }
  | { state: 'missing' }

export interface ConnectionsStore {
  // partner apps
  getAppByClientId(clientId: string): Promise<PartnerAppRow | null>
  getAppById(id: string): Promise<PartnerAppRow | null>
  /** Every registered app, newest first (Abluo admin screen). */
  listApps(): Promise<PartnerAppRow[]>
  insertApp(row: Omit<PartnerAppRow, 'id' | 'created_at' | 'approved_by' | 'approved_at'> & Partial<Pick<PartnerAppRow, 'approved_by' | 'approved_at'>>): Promise<PartnerAppRow>
  updateApp(id: string, patch: Partial<Pick<PartnerAppRow, 'status' | 'approved_by' | 'approved_at' | 'redirect_uris' | 'name' | 'client_secret_hash'>>): Promise<PartnerAppRow | null>

  // projects (read-only here)
  getProject(projectId: string): Promise<ProjectRef | null>

  // connections
  getConnection(id: string): Promise<ConnectionRow | null>
  findLiveConnection(appId: string, projectId: string): Promise<ConnectionRow | null>
  listConnectionsForProject(projectId: string): Promise<ConnectionRow[]>
  listConnectionsForApp(appId: string): Promise<ConnectionRow[]>
  insertConnection(row: Pick<ConnectionRow, 'app_id' | 'tenant_id' | 'project_id' | 'resources' | 'consent' | 'created_by' | 'sandbox'>): Promise<ConnectionRow>
  updateConnection(
    id: string,
    patch: Partial<{ status: ConnectionStatus; status_reason: string | null; resources: ConnectionRow['resources']; consent: ConnectionRow['consent']; revoked_at: string | null }>,
    /** Optimistic guard: only update while the status is one of these. */
    onlyIfStatusIn?: ConnectionStatus[],
  ): Promise<ConnectionRow | null>

  // codes
  insertCode(row: Omit<OAuthCodeRow, 'used_at' | 'created_at'> & { created_at?: string }): Promise<void>
  /** ATOMIC: mark used_at on the first call; later calls report 'replayed'. */
  consumeCode(codeHash: string, at: string): Promise<ConsumeCodeResult>
  /** Mark every unused code of a connection used (revoke / pause). */
  consumeCodesForConnection(connectionId: string, at: string): Promise<number>

  // tokens
  insertTokens(rows: NewToken[]): Promise<TokenRow[]>
  getTokenByHash(tokenHash: string): Promise<TokenRow | null>
  getTokenById(id: string): Promise<TokenRow | null>
  /** ATOMIC: retire a live refresh token; false when it was already retired/revoked. */
  retireToken(id: string, at: string): Promise<boolean>
  setReplacedBy(id: string, successorId: string): Promise<void>
  revokeTokens(filter: RevokeTokensFilter, at: string): Promise<number>
  touchToken(id: string, at: string): Promise<void>
  /** Most recent API use by any token of the connection (null = never used). */
  lastUsedAt(connectionId: string): Promise<string | null>

  // audit (best-effort: never throws)
  audit(entry: ConnectionAuditEntry): Promise<void>
}
