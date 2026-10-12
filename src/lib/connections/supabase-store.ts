// ── Connections — production store (service role, server-only) ───────────────
//
// The migration-040 tables have RLS on and NO grants for anon/authenticated:
// only the service role reaches them, after the checks in this module's
// callers. Atomic guards are single conditional UPDATEs (`… is null` filters
// + `returning`), so two concurrent requests can never both win.

import type { SupabaseClient } from '@supabase/supabase-js'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import type { ConnectionsStore, ConsumeCodeResult, NewToken, RevokeTokensFilter } from './store'
import type { ConnectionAuditEntry, ConnectionRow, OAuthCodeRow, PartnerAppRow, ProjectRef, TokenRow } from './types'

const REASON = 'ADR-031 connections: partner OAuth + Connection state (server-only tables, migration 040)'

function fail(op: string, error: { message: string } | null): never {
  throw new Error(`connections store: ${op} failed${error ? `: ${error.message}` : ''}`)
}

export function createSupabaseConnectionsStore(): ConnectionsStore {
  const run = <T>(fn: (db: SupabaseClient) => Promise<T>) => runAsTrustedSystemOperation(REASON, fn)

  return {
    getAppByClientId: (clientId) =>
      run(async (db) => {
        const { data, error } = await db.from('partner_apps').select('*').eq('client_id', clientId).maybeSingle()
        if (error) fail('getAppByClientId', error)
        return (data as PartnerAppRow | null) ?? null
      }),

    getAppById: (id) =>
      run(async (db) => {
        const { data, error } = await db.from('partner_apps').select('*').eq('id', id).maybeSingle()
        if (error) fail('getAppById', error)
        return (data as PartnerAppRow | null) ?? null
      }),

    insertApp: (row) =>
      run(async (db) => {
        const { data, error } = await db.from('partner_apps').insert(row).select('*').single()
        if (error || !data) fail('insertApp', error)
        return data as PartnerAppRow
      }),

    updateApp: (id, patch) =>
      run(async (db) => {
        const { data, error } = await db.from('partner_apps').update(patch).eq('id', id).select('*').maybeSingle()
        if (error) fail('updateApp', error)
        return (data as PartnerAppRow | null) ?? null
      }),

    getProject: (projectId) =>
      run(async (db) => {
        const { data, error } = await db.from('projects').select('id, tenant_id, name, status').eq('id', projectId).maybeSingle()
        if (error) fail('getProject', error)
        if (!data) return null
        const p = data as { id: string; tenant_id: string; name: string; status: string }
        return { id: p.id, tenantId: p.tenant_id, name: p.name, status: p.status } satisfies ProjectRef
      }),

    getConnection: (id) =>
      run(async (db) => {
        const { data, error } = await db.from('connections').select('*').eq('id', id).maybeSingle()
        if (error) fail('getConnection', error)
        return (data as ConnectionRow | null) ?? null
      }),

    findLiveConnection: (appId, projectId) =>
      run(async (db) => {
        const { data, error } = await db
          .from('connections')
          .select('*')
          .eq('app_id', appId)
          .eq('project_id', projectId)
          .neq('status', 'revoked')
          .maybeSingle()
        if (error) fail('findLiveConnection', error)
        return (data as ConnectionRow | null) ?? null
      }),

    listConnectionsForProject: (projectId) =>
      run(async (db) => {
        const { data, error } = await db.from('connections').select('*').eq('project_id', projectId).order('created_at', { ascending: false })
        if (error) fail('listConnectionsForProject', error)
        return (data ?? []) as ConnectionRow[]
      }),

    listConnectionsForApp: (appId) =>
      run(async (db) => {
        const { data, error } = await db.from('connections').select('*').eq('app_id', appId)
        if (error) fail('listConnectionsForApp', error)
        return (data ?? []) as ConnectionRow[]
      }),

    insertConnection: (row) =>
      run(async (db) => {
        const { data, error } = await db.from('connections').insert(row).select('*').single()
        if (error || !data) fail('insertConnection', error)
        return data as ConnectionRow
      }),

    updateConnection: (id, patch, onlyIfStatusIn) =>
      run(async (db) => {
        let q = db.from('connections').update(patch).eq('id', id)
        if (onlyIfStatusIn) q = q.in('status', onlyIfStatusIn)
        const { data, error } = await q.select('*').maybeSingle()
        if (error) fail('updateConnection', error)
        return (data as ConnectionRow | null) ?? null
      }),

    insertCode: (row) =>
      run(async (db) => {
        const { error } = await db.from('oauth_codes').insert(row)
        if (error) fail('insertCode', error)
      }),

    consumeCode: (codeHash, at) =>
      run(async (db): Promise<ConsumeCodeResult> => {
        // Atomic: only the first caller sees a row come back.
        const { data, error } = await db
          .from('oauth_codes')
          .update({ used_at: at })
          .eq('code_hash', codeHash)
          .is('used_at', null)
          .select('*')
          .maybeSingle()
        if (error) fail('consumeCode', error)
        if (data) return { state: 'consumed', row: data as OAuthCodeRow }
        const { data: seen, error: e2 } = await db.from('oauth_codes').select('*').eq('code_hash', codeHash).maybeSingle()
        if (e2) fail('consumeCode(read)', e2)
        return seen ? { state: 'replayed', row: seen as OAuthCodeRow } : { state: 'missing' }
      }),

    consumeCodesForConnection: (connectionId, at) =>
      run(async (db) => {
        const { data, error } = await db
          .from('oauth_codes')
          .update({ used_at: at })
          .eq('connection_id', connectionId)
          .is('used_at', null)
          .select('code_hash')
        if (error) fail('consumeCodesForConnection', error)
        return (data ?? []).length
      }),

    insertTokens: (rows: NewToken[]) =>
      run(async (db) => {
        const { data, error } = await db.from('connection_tokens').insert(rows).select('*')
        if (error || !data) fail('insertTokens', error)
        // Preserve the caller's order (access, refresh).
        const byHash = new Map((data as TokenRow[]).map((t) => [t.token_hash, t]))
        return rows.map((r) => byHash.get(r.token_hash)!)
      }),

    getTokenByHash: (tokenHash) =>
      run(async (db) => {
        const { data, error } = await db.from('connection_tokens').select('*').eq('token_hash', tokenHash).maybeSingle()
        if (error) fail('getTokenByHash', error)
        return (data as TokenRow | null) ?? null
      }),

    getTokenById: (id) =>
      run(async (db) => {
        const { data, error } = await db.from('connection_tokens').select('*').eq('id', id).maybeSingle()
        if (error) fail('getTokenById', error)
        return (data as TokenRow | null) ?? null
      }),

    retireToken: (id, at) =>
      run(async (db) => {
        const { data, error } = await db
          .from('connection_tokens')
          .update({ retired_at: at })
          .eq('id', id)
          .eq('kind', 'refresh')
          .is('retired_at', null)
          .is('revoked_at', null)
          .select('id')
          .maybeSingle()
        if (error) fail('retireToken', error)
        return Boolean(data)
      }),

    setReplacedBy: (id, successorId) =>
      run(async (db) => {
        const { error } = await db.from('connection_tokens').update({ replaced_by: successorId }).eq('id', id)
        if (error) fail('setReplacedBy', error)
      }),

    revokeTokens: (f: RevokeTokensFilter, at) =>
      run(async (db) => {
        let q = db.from('connection_tokens').update({ revoked_at: at }).eq('connection_id', f.connectionId).is('revoked_at', null)
        if (f.kind) q = q.eq('kind', f.kind)
        if (f.ids) q = q.in('id', f.ids)
        if (f.createdAtOrAfter) q = q.gte('created_at', f.createdAtOrAfter)
        const { data, error } = await q.select('id')
        if (error) fail('revokeTokens', error)
        return (data ?? []).length
      }),

    touchToken: (id, at) =>
      run(async (db) => {
        await db.from('connection_tokens').update({ last_used_at: at }).eq('id', id)
      }),

    audit: (entry: ConnectionAuditEntry) =>
      run(async (db) => {
        try {
          const { error } = await db
            .from('admin_audit_log')
            .insert({ actor_id: entry.actorId, action: entry.action, project_id: entry.projectId, detail: entry.detail })
          if (error) console.warn(`connections audit: not recorded (${entry.action}): ${error.message}`)
        } catch (e) {
          console.warn(`connections audit: not recorded (${entry.action}): ${e instanceof Error ? e.message : String(e)}`)
        }
      }),
  }
}
