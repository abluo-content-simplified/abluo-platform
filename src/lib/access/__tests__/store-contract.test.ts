/**
 * Contract between the Supabase store and migrations 050–054: every RPC the store
 * calls exists in the migration with exactly the parameter names it sends,
 * every table query filters on project_id, no select ever asks for a hash
 * outside the candidate function, and the visitor plane never imports the
 * dashboard's session/auth layer.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import { createSupabaseSiteAccessStore, toAccessError } from '../store'

const ROOT = resolve(__dirname, '../../../..')
const SQL = readFileSync(join(ROOT, 'supabase/migrations/050_site_access.sql'), 'utf8')
  + readFileSync(join(ROOT, 'supabase/migrations/052_site_access_documents.sql'), 'utf8')
  + readFileSync(join(ROOT, 'supabase/migrations/053_site_access_session_summary.sql'), 'utf8')
  + readFileSync(join(ROOT, 'supabase/migrations/054_documents_module.sql'), 'utf8')
  + readFileSync(join(ROOT, 'supabase/migrations/055_documents_delete.sql'), 'utf8')

function sqlParams(fn: string): string[] {
  const m = SQL.match(new RegExp(`create (?:or replace )?function public\\.${fn}\\(([\\s\\S]*?)\\)\\s*returns`, 'm'))
  if (!m) throw new Error(`function ${fn} not in migrations 050–054`)
  return m[1].split(',').map((p) => p.trim().split(/\s+/)[0]).filter(Boolean)
}

type Call = { kind: 'rpc' | 'from'; name: string; args?: Record<string, unknown>; filters: string[]; select?: string; op?: string }
function recordingClient(rpcResult: unknown = null) {
  const calls: Call[] = []
  const builder = (call: Call) => {
    const b: Record<string, unknown> = {}
    const chain = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => { fn(...a); return b }
    Object.assign(b, {
      select: chain((s) => { call.select = String(s) }),
      insert: chain(() => { call.op = 'insert' }),
      update: chain(() => { call.op = 'update' }),
      eq: chain((k) => { call.filters.push(String(k)) }),
      is: chain((k) => { call.filters.push(String(k)) }),
      in: chain((k) => { call.filters.push(String(k)) }),
      order: chain(() => {}),
      single: chain(() => {}),
      then: (res: (v: unknown) => void) => res({ data: call.op === 'update' ? [{ id: 'x' }] : call.op === 'insert' ? { id: 'x' } : [], error: null }),
    })
    return b
  }
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ kind: 'rpc', name, args, filters: [] })
      return Promise.resolve({ data: rpcResult, error: null })
    },
    from: (name: string) => {
      const call: Call = { kind: 'from', name, filters: [] }
      calls.push(call)
      return builder(call)
    },
  }
  return { client, calls }
}

describe('store ↔ migration 050', () => {
  it('every RPC exists with exactly the parameter names the store sends', async () => {
    const { client, calls } = recordingClient([{ allowed: true, attempt_id: 1, under_pressure: false, retry_after_seconds: 0 }])
    const s = createSupabaseSiteAccessStore(client as never)
    const P = '00000000-0000-4000-8000-000000000000'
    await s.reserveAttempt(P, 'h', { windowSeconds: 900, perIpProject: 5, perIpProjectUnderPressure: 2, perIpAllProjects: 30, projectPressure: 50 })
    await s.failAttempt(P, 1)
    await s.candidateCredentials(P, null)
    await s.unlock({ projectId: P, environment: 'production', credentialId: P, credentialVersion: 1, currentTokenHash: null, newTokenHash: 'h', sessionSeconds: 60, attemptId: 1, deviceLabel: null })
    await s.resolve(P, 'production', 'h')
    await s.revokeSessions(P, null, 'revoked_all', null)
    await s.createCredential(P, { label: 'l', passwordHash: 'scrypt$', groupIds: [], expiresAt: null }, 'a')
    await s.setCredentialGroups(P, P, [], 'a')
    await s.rotateCredential(P, P, 'scrypt$', 'a')
    await s.setCredentialDisabled(P, P, true, 'a')
    // 052 / 054 — documents
    const input = { title: { en: 't' }, note: null, categoryTermId: null, tagTermIds: [] }
    await s.createDocument(P, { ...input, visibility: 'everyone', groupIds: [] }, 'a')
    await s.updateDocument(P, P, input, 'a')
    await s.setDocumentAccess(P, P, { visibility: 'groups', groupIds: [P] }, 'a')
    await s.setDocumentPlacements(P, P, ['page-1'], 'a')
    await s.reorderPageDocuments(P, 'page-1', [P], 'a')
    await s.removeDocumentLanguages(P, P, ['it'], 'a')
    await s.setDocumentArchived(P, P, true, 'a')
    await s.deleteDocuments(P, [P], 'a') // 055
    await s.finishUpload(P, P, { sizeBytes: 1, sha256: 'a'.repeat(64) }, 'a')
    await s.failUpload(P, P)
    await s.documentForDelivery(P, P, ['en'])
    await s.pageDocuments(P, ['page-1'])
    // 053 — signed-in summary
    await s.sessionSummary(P, 'production')
    const rpcs = calls.filter((c) => c.kind === 'rpc')
    expect(rpcs).toHaveLength(23)
    // R9: the v2 functions, never the 052 ones they replace
    expect(rpcs.map((c) => c.name)).not.toContain('site_access_create_document')
    expect(rpcs.map((c) => c.name)).not.toContain('site_access_document_for_delivery')
    for (const c of rpcs) {
      expect(Object.keys(c.args!).sort(), c.name).toEqual([...sqlParams(c.name)].sort())
      if ('p_environment' in c.args!) expect(c.args!.p_environment, c.name).toBe('production')
      expect(c.args!.p_project_id, c.name).toBe(P)
    }
  })

  it('052/054: begin upload (v2) and the sweep RPCs match the migration (the sweep alone is cross-project)', async () => {
    const { client, calls } = recordingClient([{ upload_id: 'u', storage_path: 'p/x.pdf', expires_at: 'e' }])
    const s = createSupabaseSiteAccessStore(client as never)
    const P = '00000000-0000-4000-8000-000000000000'
    await s.beginUpload(P, { documentId: P, locales: ['en', 'it'], mimeType: 'image/png', sizeBytes: 1, sha256: 'a'.repeat(64), filename: null, ttlSeconds: 3600 }, 'a')
    await s.expireUploads(10)
    await s.trashBatch(10)
    await s.trashDone([])
    const rpcs = calls.filter((c) => c.kind === 'rpc')
    expect(rpcs.map((c) => c.name)).toEqual(['site_access_begin_upload_v2', 'site_access_expire_uploads', 'site_access_trash_batch', 'site_access_trash_done'])
    for (const c of rpcs) expect(Object.keys(c.args!).sort(), c.name).toEqual([...sqlParams(c.name)].sort())
    expect(rpcs[0].args!.p_project_id).toBe(P)
  })

  it('every table read/update filters on project_id and never selects a hash', async () => {
    const { client, calls } = recordingClient()
    const s = createSupabaseSiteAccessStore(client as never)
    const P = '00000000-0000-4000-8000-000000000000'
    await s.listGroups(P)
    await s.listCredentials(P)
    await s.updateGroup(P, P, { name: { en: 'x' } }, 'a')
    await s.setGroupArchived(P, P, true, 'a')
    await s.listDocuments(P)
    await s.getUpload(P, P)
    for (const c of calls.filter((x) => x.kind === 'from' && x.op !== 'insert')) {
      expect(c.filters, c.name).toContain('project_id')
      expect(c.select ?? '', c.name).not.toMatch(/password_hash|token_hash|_secrets/)
    }
    expect(calls.some((c) => c.name === 'site_access_credential_secrets')).toBe(false)
  })

  it('maps database errors to stable codes', () => {
    expect(toAccessError({ message: 'site_access:credential_unavailable' }).code).toBe('credential_unavailable')
    expect(toAccessError({ message: 'ERROR: site_access:too_many_groups' }).code).toBe('limit_reached')
    expect(toAccessError({ code: '42P01', message: 'relation does not exist' }).code).toBe('unavailable')
    expect(toAccessError({ code: 'PGRST202', message: 'no function' }).code).toBe('unavailable')
    expect(toAccessError({ code: '23503', message: 'fk' }).code).toBe('invalid_input')
    expect(toAccessError({ code: 'XX000', message: 'boom' }).code).toBe('unavailable')
  })
})

describe('separation of planes', () => {
  const dir = resolve(__dirname, '..')
  const src = readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(join(dir, f), 'utf8')] as const)

  it('no site-access file reads the dashboard session or Supabase Auth', () => {
    for (const [f, code] of src) {
      expect(code, f).not.toMatch(/@\/lib\/supabase\/server|supabase\/ssr|auth\.getUser|auth\.admin/)
    }
  })
  it('the visitor plane does not import the management plane or the dashboard context', () => {
    const visitor = src.find(([f]) => f === 'visitor.ts')![1]
    expect(visitor).not.toMatch(/management|tenant-context|module-action-guard/)
  })
  it('the service role is reached only through withSiteAccessStore (grep-auditable)', () => {
    for (const [f, code] of src) {
      if (f === 'server.ts') continue
      expect(code, f).not.toMatch(/createAdminClient|runAsTrustedSystemOperation|SERVICE_ROLE/)
    }
  })
})

describe('store ↔ migration 053', () => {
  it('maps the summary rows: the null-group row is the total, the rest are per group', async () => {
    const G = '11111111-1111-4111-8111-111111111111'
    const { client } = recordingClient([{ group_id: G, signed_in: 3 }, { group_id: null, signed_in: 4 }])
    const s = createSupabaseSiteAccessStore(client as never)
    expect(await s.sessionSummary('00000000-0000-4000-8000-000000000000', 'production')).toEqual({ total: 4, byGroup: { [G]: 3 } })
  })
  it('no rows means nobody is signed in', async () => {
    const { client } = recordingClient([])
    const s = createSupabaseSiteAccessStore(client as never)
    expect(await s.sessionSummary('00000000-0000-4000-8000-000000000000', 'production')).toEqual({ total: 0, byGroup: {} })
  })
})
