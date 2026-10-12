// ── Removals → tombstones (ADR-031 D4) ────────────────────────────────────────
//
// Sanity keeps no trace of a deleted (or unpublished) document, so a partner
// polling with a cursor would never learn it is gone. ONE Sanity webhook (on
// delete of any published document that has a `publicId`) calls
// /api/webhooks/sanity-removals with its type, publicId and projectSlug; we
// record a tombstone that the partner API returns as `{ id, deleted: true }`.
//
// Generic by design: every shareable type (SHAREABLE_RESOURCES — events and
// venues today; posts, menus, dishes tomorrow) is covered as soon as it is
// registered there. Nothing changes in Sanity when a new type is added.
//
// Events made unlisted or website-only need no tombstone: they still exist,
// their `_updatedAt` moves, and the API reports them as removed inline.
//
// Signature: Sanity's GROQ-powered webhook format —
//   sanity-webhook-signature: t=<ms timestamp>,v1=<base64url HMAC-SHA256(secret, `${t}.${body}`)>

import { createHmac, timingSafeEqual } from 'node:crypto'
import { isShareableResource } from '../resources'
import type { ConnectionsStore } from '../store'

export const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function signWebhook(body: string, secret: string, timestampMs: number): string {
  const sig = createHmac('sha256', secret).update(`${timestampMs}.${body}`).digest('base64url')
  return `t=${timestampMs},v1=${sig}`
}

export function verifyWebhookSignature(header: string | null | undefined, body: string, secret: string, nowMs: number): boolean {
  if (!header || !secret) return false
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  )
  const t = Number(parts.t)
  if (!Number.isFinite(t) || Math.abs(nowMs - t) > SIGNATURE_TOLERANCE_MS) return false
  const given = typeof parts.v1 === 'string' ? parts.v1.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : ''
  const expected = createHmac('sha256', secret).update(`${t}.${body}`).digest('base64url')
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type RemovalResult = { ok: true; recorded: boolean } | { ok: false; error: 'invalid_payload' }

/** Record one removal. Unknown projects or documents without a publicId are ignored (nothing to tell partners). */
export async function recordRemoval(payload: unknown, deps: { store: ConnectionsStore; clock?: () => Date }): Promise<RemovalResult> {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'invalid_payload' }
  const p = payload as Record<string, unknown>
  const type = p.type ?? p._type
  // Only types partners can receive; anything else has nothing to tell them.
  if (!isShareableResource(type)) return { ok: true, recorded: false }
  const publicId = p.publicId
  const projectSlug = p.projectSlug
  if (typeof publicId !== 'string' || !UUID.test(publicId) || typeof projectSlug !== 'string' || !projectSlug) return { ok: true, recorded: false }
  const project = await deps.store.findProjectBySlug(projectSlug)
  if (!project) return { ok: true, recorded: false }
  await deps.store.insertTombstone({
    project_id: project.id,
    resource: type,
    public_id: publicId,
    reason: p.reason === 'unpublished' ? 'unpublished' : 'deleted',
    removed_at: (deps.clock ?? (() => new Date()))().toISOString(),
  })
  return { ok: true, recorded: true }
}
