// ── Connections — row shapes (migration 040) and the Connection grant ─────────

export type PartnerAppStatus = 'pending' | 'approved' | 'suspended'
export type ConnectionStatus = 'active' | 'paused' | 'needs_reconnect' | 'revoked'
export type TokenKind = 'access' | 'refresh'

/** What a Connection shares: { event: { fields: [...] } }. Validated by resources.ts. */
export type SharedResources = Record<string, { fields: string[] }>

export interface PartnerAppRow {
  id: string
  name: string
  client_id: string
  client_secret_hash: string
  redirect_uris: string[]
  status: PartnerAppStatus
  terms_version: string | null
  contact_email: string | null
  approved_by: string | null
  approved_at: string | null
  created_by: string | null
  created_at: string
}

export interface ConnectionRow {
  id: string
  app_id: string
  tenant_id: string
  project_id: string
  location_keys: string[]
  resources: SharedResources
  delivery: string[]
  status: ConnectionStatus
  status_reason: string | null
  sandbox: boolean
  consent: { by: string; at: string; resources: SharedResources; [k: string]: unknown }
  created_by: string | null
  revoked_at: string | null
  created_at: string
  updated_at: string
}

export interface TokenRow {
  id: string
  connection_id: string
  kind: TokenKind
  token_hash: string
  token_prefix: string
  expires_at: string
  replaced_by: string | null
  retired_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  created_at: string
}

export interface OAuthCodeRow {
  code_hash: string
  app_id: string
  connection_id: string
  code_challenge: string
  code_challenge_method: 'S256'
  redirect_uri: string
  expires_at: string
  used_at: string | null
  created_at: string
}

export interface ProjectRef {
  id: string
  tenantId: string
  name: string
  status: string
  /** `projects.slug` — also the value the project's Sanity documents carry. */
  slug?: string
  customDomain?: string | null
}

export type TombstoneReason = 'deleted' | 'unpublished' | 'unlisted' | 'websiteOnly'

export interface TombstoneRow {
  project_id: string
  resource: string
  public_id: string
  reason: TombstoneReason
  /** ISO, millisecond precision (written by us, so cursors compare exactly). */
  removed_at: string
}

export interface ApiUsageRow {
  connection_id: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  endpoint: string
  status: number
  duration_ms: number | null
  request_id: string | null
}

/**
 * What an authenticated partner request may touch — derived ONLY from the
 * access token's Connection. Exactly one project; nothing else is reachable.
 */
export interface ConnectionGrant {
  connectionId: string
  appId: string
  tenantId: string
  projectId: string
  locationKeys: string[]
  resources: SharedResources
  sandbox: boolean
}

export type ConnectionAuditAction =
  | 'connection.app.register'
  | 'connection.app.approve'
  | 'connection.app.suspend'
  | 'connection.app.secret_rotate'
  | 'connection.connect'
  | 'connection.consent.change'
  | 'connection.pause'
  | 'connection.resume'
  | 'connection.revoke'
  | 'connection.token.reuse'
  | 'connection.code.replay'
  | 'connection.token.revoke'

export interface ConnectionAuditEntry {
  action: ConnectionAuditAction
  /** The person who acted; null for the system (reuse detection) or the partner. */
  actorId: string | null
  projectId: string | null
  detail: Record<string, unknown>
}
