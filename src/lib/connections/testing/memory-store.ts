// ── Connections — in-memory store for tests ───────────────────────────────────
//
// Same contract as supabase-store.ts, including the atomic guards
// (consumeCode, retireToken, updateConnection's status guard) and the
// migration-040 invariants that matter to the logic (hash shapes, one live
// connection per app × project, revoked never comes back, project ∈ tenant).
// Tests only — never imported by application code.

import { randomUUID } from 'node:crypto'
import type { ConnectionsStore, ConsumeCodeResult, NewToken, RevokeTokensFilter } from '../store'
import type { ConnectionAuditEntry, ConnectionRow, OAuthCodeRow, PartnerAppRow, ProjectRef, TokenRow } from '../types'

const HEX64 = /^[0-9a-f]{64}$/

export class MemoryConnectionsStore implements ConnectionsStore {
  apps = new Map<string, PartnerAppRow>()
  projects = new Map<string, ProjectRef>()
  connections = new Map<string, ConnectionRow>()
  codes = new Map<string, OAuthCodeRow>()
  tokens = new Map<string, TokenRow>()
  audits: ConnectionAuditEntry[] = []

  constructor(private now: () => Date = () => new Date()) {}

  private iso() {
    return this.now().toISOString()
  }

  addProject(p: ProjectRef) {
    this.projects.set(p.id, p)
  }

  async getAppByClientId(clientId: string) {
    return [...this.apps.values()].find((a) => a.client_id === clientId) ?? null
  }
  async getAppById(id: string) {
    return this.apps.get(id) ?? null
  }
  async insertApp(row: Parameters<ConnectionsStore['insertApp']>[0]) {
    if (!HEX64.test(row.client_secret_hash)) throw new Error('check violation: client_secret_hash')
    const app: PartnerAppRow = { approved_by: null, approved_at: null, ...row, id: randomUUID(), created_at: this.iso() }
    this.apps.set(app.id, app)
    return { ...app }
  }
  async updateApp(id: string, patch: Parameters<ConnectionsStore['updateApp']>[1]) {
    const a = this.apps.get(id)
    if (!a) return null
    Object.assign(a, patch)
    return { ...a }
  }

  async getProject(projectId: string) {
    return this.projects.get(projectId) ?? null
  }

  async getConnection(id: string) {
    const c = this.connections.get(id)
    return c ? structuredClone(c) : null
  }
  async findLiveConnection(appId: string, projectId: string) {
    const c = [...this.connections.values()].find((x) => x.app_id === appId && x.project_id === projectId && x.status !== 'revoked')
    return c ? structuredClone(c) : null
  }
  async listConnectionsForProject(projectId: string) {
    return [...this.connections.values()].filter((c) => c.project_id === projectId).map((c) => structuredClone(c))
  }
  async listConnectionsForApp(appId: string) {
    return [...this.connections.values()].filter((c) => c.app_id === appId).map((c) => structuredClone(c))
  }
  async insertConnection(row: Parameters<ConnectionsStore['insertConnection']>[0]) {
    const p = this.projects.get(row.project_id)
    if (!p || p.tenantId !== row.tenant_id) throw new Error('check violation: project not in tenant')
    if (await this.findLiveConnection(row.app_id, row.project_id)) throw new Error('unique violation: one live connection per app × project')
    const c: ConnectionRow = {
      ...structuredClone(row),
      id: randomUUID(),
      location_keys: [],
      delivery: ['pull'],
      status: 'active',
      status_reason: null,
      revoked_at: null,
      created_at: this.iso(),
      updated_at: this.iso(),
    }
    this.connections.set(c.id, c)
    return structuredClone(c)
  }
  async updateConnection(id: string, patch: Parameters<ConnectionsStore['updateConnection']>[1], onlyIfStatusIn?: ConnectionRow['status'][]) {
    const c = this.connections.get(id)
    if (!c) return null
    if (onlyIfStatusIn && !onlyIfStatusIn.includes(c.status)) return null
    if (c.status === 'revoked' && patch.status && patch.status !== 'revoked') throw new Error('check violation: revoked cannot be reactivated')
    Object.assign(c, structuredClone(patch), { updated_at: this.iso() })
    if ((c.status === 'revoked') !== (c.revoked_at !== null)) throw new Error('check violation: revoked ⇔ revoked_at')
    return structuredClone(c)
  }

  async insertCode(row: Parameters<ConnectionsStore['insertCode']>[0]) {
    if (!HEX64.test(row.code_hash)) throw new Error('check violation: code_hash')
    if (!/^[A-Za-z0-9_-]{43}$/.test(row.code_challenge)) throw new Error('check violation: code_challenge')
    const created = row.created_at ?? this.iso()
    if (new Date(row.expires_at).getTime() - new Date(created).getTime() > 10 * 60 * 1000) throw new Error('check violation: code > 10 min')
    this.codes.set(row.code_hash, { ...row, created_at: created, used_at: null })
  }
  async consumeCode(codeHash: string, at: string): Promise<ConsumeCodeResult> {
    const c = this.codes.get(codeHash)
    if (!c) return { state: 'missing' }
    if (c.used_at) return { state: 'replayed', row: { ...c } }
    c.used_at = at
    return { state: 'consumed', row: { ...c } }
  }
  async consumeCodesForConnection(connectionId: string, at: string) {
    let n = 0
    for (const c of this.codes.values()) {
      if (c.connection_id === connectionId && !c.used_at) {
        c.used_at = at
        n++
      }
    }
    return n
  }

  async insertTokens(rows: NewToken[]) {
    const out: TokenRow[] = []
    for (const r of rows) {
      if (!HEX64.test(r.token_hash)) throw new Error('check violation: token_hash')
      if (!/^abluo_(at|rt)_[A-Za-z0-9]{4}$/.test(r.token_prefix)) throw new Error('check violation: token_prefix')
      if ([...this.tokens.values()].some((t) => t.token_hash === r.token_hash)) throw new Error('unique violation: token_hash')
      const t: TokenRow = { ...r, id: randomUUID(), replaced_by: null, retired_at: null, revoked_at: null, last_used_at: null, created_at: this.iso() }
      this.tokens.set(t.id, t)
      out.push({ ...t })
    }
    return out
  }
  async getTokenByHash(tokenHash: string) {
    const t = [...this.tokens.values()].find((x) => x.token_hash === tokenHash)
    return t ? { ...t } : null
  }
  async getTokenById(id: string) {
    const t = this.tokens.get(id)
    return t ? { ...t } : null
  }
  async retireToken(id: string, at: string) {
    const t = this.tokens.get(id)
    if (!t || t.kind !== 'refresh' || t.retired_at || t.revoked_at) return false
    t.retired_at = at
    return true
  }
  async setReplacedBy(id: string, successorId: string) {
    const t = this.tokens.get(id)
    if (t) t.replaced_by = successorId
  }
  async revokeTokens(f: RevokeTokensFilter, at: string) {
    let n = 0
    for (const t of this.tokens.values()) {
      if (t.connection_id !== f.connectionId || t.revoked_at) continue
      if (f.kind && t.kind !== f.kind) continue
      if (f.ids && !f.ids.includes(t.id)) continue
      if (f.createdAtOrAfter && t.created_at < f.createdAtOrAfter) continue
      t.revoked_at = at
      n++
    }
    return n
  }
  async touchToken(id: string, at: string) {
    const t = this.tokens.get(id)
    if (t) t.last_used_at = at
  }

  async audit(entry: ConnectionAuditEntry) {
    this.audits.push(structuredClone(entry))
  }
}
