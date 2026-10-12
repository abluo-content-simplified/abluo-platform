// ── Connections — the authorization (consent) step, entirely ours ─────────────
//
// The library's authorize handler is NOT used: Abluo's own consent screen
// (`/connect/authorize`, UI in step 4c) calls these functions.
//
//   validateAuthorizeRequest  what the partner sent in the browser redirect
//   approveConnect            the signed-in person approved → Connection + code
//   denyConnect               the person said no → access_denied to the partner
//
// Rules (ADR-031 D2, Amendment B):
//   - approved apps only; redirect URI must equal a registered one exactly;
//   - PKCE S256 required (no plain, no missing challenge);
//   - the person must hold `connections.manage` on THAT project (server-side
//     `can()`), and support mode can never consent;
//   - the person may share less than the app asked for, never more;
//   - a localhost redirect URI (a partner's dev build) can only connect a
//     sandbox project; a sandbox project marks its Connection `sandbox`;
//   - the form is never trusted: everything is re-validated on approve.

import { can, type AuthzSubject } from '@/lib/authz/check'
import { generateSecret, isSecretOfKind, isValidS256Challenge, sha256Hex } from './crypto'
import { AUTHORIZATION_CODE_TTL_MS, systemClock, type Clock } from './policy'
import { defaultFields, isShareableResource, normalizeResources, type ShareableResource } from './resources'
import type { ConnectionsStore } from './store'
import type { PartnerAppRow, SharedResources } from './types'

export interface AuthorizeParams {
  response_type?: string | null
  client_id?: string | null
  redirect_uri?: string | null
  code_challenge?: string | null
  code_challenge_method?: string | null
  state?: string | null
  /** Space-separated `<resource>:read`, e.g. "event:read eventVenue:read". */
  scope?: string | null
}

export interface ConsentDeps {
  store: ConnectionsStore
  clock?: Clock
  /** Projects that are demo/sandbox sites (env CONNECTIONS_SANDBOX_PROJECT_IDS). */
  sandboxProjectIds?: readonly string[]
}

export type AuthorizeValidation =
  | {
      ok: true
      app: PartnerAppRow
      redirectUri: string
      codeChallenge: string
      state: string | null
      requested: ShareableResource[]
      /** What the consent screen ticks by default. */
      defaults: SharedResources
    }
  /** `redirect: false` → show an error page; NEVER redirect to an unverified URI (RFC 6749 §4.1.2.1). */
  | { ok: false; error: string; redirect: false }
  | { ok: false; error: string; redirect: true; redirectTo: string }

export function sandboxProjectIdsFromEnv(value = process.env.CONNECTIONS_SANDBOX_PROJECT_IDS): string[] {
  return (value ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

function isLocalhost(uri: string): boolean {
  return /^http:\/\/localhost(:[0-9]{2,5})?(\/|$)/.test(uri)
}

export function redirectWith(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v)
  return url.toString()
}

function parseScope(scope: string | null | undefined): ShareableResource[] | null {
  const parts = (scope ?? '').split(' ').filter(Boolean)
  if (parts.length === 0) return null
  const out: ShareableResource[] = []
  for (const p of parts) {
    const m = /^([A-Za-z]+):read$/.exec(p)
    if (!m || !isShareableResource(m[1])) return null
    if (!out.includes(m[1])) out.push(m[1])
  }
  return out
}

export async function validateAuthorizeRequest(params: AuthorizeParams, deps: ConsentDeps): Promise<AuthorizeValidation> {
  const clientId = params.client_id
  if (!isSecretOfKind(clientId, 'clientId')) return { ok: false, error: 'invalid_client', redirect: false }
  const app = await deps.store.getAppByClientId(clientId)
  if (!app || app.status !== 'approved') return { ok: false, error: 'invalid_client', redirect: false }
  const redirectUri = params.redirect_uri ?? ''
  if (!app.redirect_uris.includes(redirectUri)) return { ok: false, error: 'invalid_redirect_uri', redirect: false }

  // From here on the redirect URI is trusted: errors go back to the partner.
  const fail = (error: string): AuthorizeValidation => ({
    ok: false,
    error,
    redirect: true,
    redirectTo: redirectWith(redirectUri, { error, state: params.state }),
  })
  if (params.response_type !== 'code') return fail('unsupported_response_type')
  if (params.code_challenge_method !== 'S256' || !isValidS256Challenge(params.code_challenge)) return fail('invalid_request')
  if (params.state != null && params.state.length > 500) return fail('invalid_request')
  const requested = parseScope(params.scope)
  if (!requested) return fail('invalid_scope')

  const defaults: SharedResources = {}
  for (const r of requested) defaults[r] = { fields: defaultFields(r) }
  const normalized = normalizeResources(defaults)
  if (!normalized.ok) return fail('invalid_scope')

  return {
    ok: true,
    app,
    redirectUri,
    codeChallenge: params.code_challenge as string,
    state: params.state ?? null,
    requested,
    defaults: normalized.resources,
  }
}

export type ConsentResult =
  | { ok: true; redirectTo: string; connectionId: string }
  | { ok: false; error: 'forbidden' | 'support_mode' | 'project_not_found' | 'sandbox_only' | 'resources_invalid' | string; redirectTo?: string }

/**
 * The person approved. Creates (or updates) the Connection for this app ×
 * project, records the consent, and returns the partner redirect carrying a
 * single-use code.
 */
export async function approveConnect(
  subject: (AuthzSubject & { userId: string }) | null | undefined,
  input: { params: AuthorizeParams; projectId: string; resources: unknown },
  deps: ConsentDeps,
): Promise<ConsentResult> {
  const v = await validateAuthorizeRequest(input.params, deps)
  if (!v.ok) return { ok: false, error: v.error, redirectTo: v.redirect ? v.redirectTo : undefined }
  if (!subject) return { ok: false, error: 'forbidden' }
  // Support mode can view Connections, never create or widen one (ADR-031 D2).
  if (subject.support) return { ok: false, error: 'support_mode' }
  if (!can(subject, 'connections.manage', { kind: 'project', projectId: input.projectId })) return { ok: false, error: 'forbidden' }

  const { store } = deps
  const project = await store.getProject(input.projectId)
  if (!project) return { ok: false, error: 'project_not_found' }

  const sandboxIds = deps.sandboxProjectIds ?? sandboxProjectIdsFromEnv()
  const sandbox = sandboxIds.includes(project.id)
  if (isLocalhost(v.redirectUri) && !sandbox) return { ok: false, error: 'sandbox_only' }

  const chosen = normalizeResources(input.resources)
  if (!chosen.ok) return { ok: false, error: 'resources_invalid' }
  // Never a resource the app did not ask for. (Within a requested resource the
  // person picks the fields, including opt-in personal ones.)
  if (Object.keys(chosen.resources).some((r) => !v.requested.includes(r as ShareableResource))) {
    return { ok: false, error: 'resources_invalid' }
  }

  const clock = deps.clock ?? systemClock
  const now = clock()
  const consent = {
    by: subject.userId,
    at: now.toISOString(),
    resources: chosen.resources,
    app: { id: v.app.id, name: v.app.name },
    scope: v.requested.map((r) => `${r}:read`).join(' '),
  }

  const existing = await store.findLiveConnection(v.app.id, project.id)
  let connectionId: string
  if (existing) {
    const updated = await store.updateConnection(
      existing.id,
      { resources: chosen.resources, consent, status: 'active', status_reason: null },
      ['active', 'paused', 'needs_reconnect'],
    )
    if (!updated) return { ok: false, error: 'forbidden' }
    connectionId = updated.id
    await store.audit({
      action: 'connection.consent.change',
      actorId: subject.userId,
      projectId: project.id,
      detail: { connectionId, appId: v.app.id, resources: chosen.resources, previousStatus: existing.status },
    })
  } else {
    const created = await store.insertConnection({
      app_id: v.app.id,
      tenant_id: project.tenantId,
      project_id: project.id,
      resources: chosen.resources,
      consent,
      created_by: subject.userId,
      sandbox,
    })
    connectionId = created.id
    await store.audit({
      action: 'connection.connect',
      actorId: subject.userId,
      projectId: project.id,
      detail: { connectionId, appId: v.app.id, resources: chosen.resources, sandbox },
    })
  }

  const code = generateSecret('authorizationCode')
  await store.insertCode({
    code_hash: sha256Hex(code),
    app_id: v.app.id,
    connection_id: connectionId,
    code_challenge: v.codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: v.redirectUri,
    expires_at: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_MS).toISOString(),
    created_at: now.toISOString(),
  })
  return { ok: true, connectionId, redirectTo: redirectWith(v.redirectUri, { code, state: v.state }) }
}

/** The person declined: tell the partner, change nothing. */
export async function denyConnect(params: AuthorizeParams, deps: ConsentDeps): Promise<{ redirectTo: string | null }> {
  const v = await validateAuthorizeRequest(params, deps)
  if (v.ok) return { redirectTo: redirectWith(v.redirectUri, { error: 'access_denied', state: v.state }) }
  return { redirectTo: v.redirect ? v.redirectTo : null }
}
