/**
 * Signed, short-lived tokens for the private draft preview (ADR-025 · preview).
 *
 * A token binds ONE draft of ONE project to the user who asked for it, until
 * a near expiry (15 minutes). It is the only thing that unlocks
 * `/{locale}/{project}/preview/post/{id}` — the route renders nothing without
 * a valid token whose draft and project match the URL, and 404s otherwise.
 *
 * Format: `base64url(JSON payload) "." base64url(HMAC-SHA256(payload))`.
 *
 * Secret: `PREVIEW_SECRET` (recommended; ≥ 32 random characters). When it is
 * not set, a key is DERIVED from `SUPABASE_SERVICE_ROLE_KEY` (HMAC with a
 * fixed label, so the service key itself never signs anything). With neither,
 * minting throws and every token is rejected — the preview fails closed.
 */
import { createHmac, timingSafeEqual } from 'crypto'

export const PREVIEW_TOKEN_TTL_SECONDS = 15 * 60
/** Clock skew tolerated between the minting and the rendering server. */
const SKEW_SECONDS = 60

/** What a token previews: a blog post draft, or a gallery draft (optionally inside one page). */
export type DraftPreviewKind = 'post' | 'gallery'

export type DraftPreviewClaims = {
  /** Public document id (no `drafts.` prefix): the post, or the gallery. */
  draftId: string
  /** 'post' for every token minted before galleries existed. */
  kind: DraftPreviewKind
  /** Gallery previews only: the page to render with the draft gallery in it (null = gallery alone). */
  pageId: string | null
  /** The project (Supabase `projects.slug` = Sanity `projectSlug`). */
  projectSlug: string
  /** Who asked for it (audit only — the token is the capability). */
  userId: string
  /** Expiry, seconds since the epoch. */
  exp: number
}

type Payload = { v: 1; d: string; p: string; u: string; e: number; k?: 'g'; pg?: string }

const b64 = (buf: Buffer) => buf.toString('base64url')

export function previewSecret(env: Record<string, string | undefined> = process.env): Buffer | null {
  const explicit = env.PREVIEW_SECRET?.trim()
  if (explicit && explicit.length >= 16) return Buffer.from(explicit, 'utf8')
  const service = env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (service) return createHmac('sha256', service).update('abluo/draft-preview/v1').digest()
  return null
}

function sign(body: string, secret: Buffer): string {
  return b64(createHmac('sha256', secret).update(body).digest())
}

export function signDraftPreviewToken(
  claims: Omit<DraftPreviewClaims, 'exp' | 'kind' | 'pageId'> & { kind?: DraftPreviewKind; pageId?: string | null },
  opts: { secret?: Buffer | null; now?: number; ttlSeconds?: number } = {}
): { token: string; exp: number } {
  const secret = opts.secret === undefined ? previewSecret() : opts.secret
  if (!secret) throw new Error('Draft preview is not configured (PREVIEW_SECRET).')
  const now = Math.floor((opts.now ?? Date.now()) / 1000)
  const exp = now + Math.min(opts.ttlSeconds ?? PREVIEW_TOKEN_TTL_SECONDS, PREVIEW_TOKEN_TTL_SECONDS)
  const payload: Payload = {
    v: 1,
    d: claims.draftId,
    p: claims.projectSlug,
    u: claims.userId,
    e: exp,
    ...(claims.kind === 'gallery' && { k: 'g' as const }),
    ...(claims.kind === 'gallery' && claims.pageId && { pg: claims.pageId }),
  }
  const body = b64(Buffer.from(JSON.stringify(payload), 'utf8'))
  return { token: `${body}.${sign(body, secret)}`, exp }
}

/** The claims of a genuine, unexpired token — or null. Never throws. */
export function verifyDraftPreviewToken(
  token: unknown,
  opts: { secret?: Buffer | null; now?: number } = {}
): DraftPreviewClaims | null {
  try {
    if (typeof token !== 'string' || token.length > 2048) return null
    const secret = opts.secret === undefined ? previewSecret() : opts.secret
    if (!secret) return null
    const parts = token.split('.')
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null
    const [body, mac] = parts
    const expected = Buffer.from(sign(body, secret), 'utf8')
    const given = Buffer.from(mac, 'utf8')
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null

    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<Payload>
    if (p.v !== 1 || typeof p.d !== 'string' || typeof p.p !== 'string' || typeof p.u !== 'string') return null
    if (typeof p.e !== 'number' || !Number.isFinite(p.e)) return null
    const now = Math.floor((opts.now ?? Date.now()) / 1000)
    if (p.e <= now) return null
    // A token can never live longer than the TTL, even if a key leaked into a
    // minting bug: reject anything expiring further out than mint could set.
    if (p.e > now + PREVIEW_TOKEN_TTL_SECONDS + SKEW_SECONDS) return null
    if (p.k !== undefined && p.k !== 'g') return null
    if (p.pg !== undefined && (p.k !== 'g' || typeof p.pg !== 'string' || !p.pg)) return null
    return {
      draftId: p.d,
      projectSlug: p.p,
      userId: p.u,
      exp: p.e,
      kind: p.k === 'g' ? 'gallery' : 'post',
      pageId: typeof p.pg === 'string' ? p.pg : null,
    }
  } catch {
    return null
  }
}
