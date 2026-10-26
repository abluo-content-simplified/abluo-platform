/**
 * Site Access — protected file delivery (ADR-040 §10, B2.4). Server only.
 *
 *   GET|HEAD /{locale}/{project}/site-access/documents/{documentId}
 *            (own domain: /{locale}/site-access/documents/{documentId})
 *     → the PDF, inline, streamed from the private bucket, with HTTP Range
 *       support. EVERY request — each range a PDF viewer asks for included —
 *       re-checks authorization from scratch.
 *   …?download=1
 *     → 303 to a signed storage URL of at most 60 seconds, as an attachment.
 *
 * Refusal is uniform: an unknown id, another project's id, an archived
 * document, a document whose groups the visitor lacks, a malformed id, the
 * module switched off, an expired / revoked session or none at all all get
 * THE SAME response — 303 to the sign-in page for a browser navigation, 401
 * otherwise. Nothing distinguishes "does not exist" from "not for you".
 *
 * Language: the URL's language, then the site's default, then nothing.
 */
import { evaluateAccess, type AccessPolicy, type VisitorGrants } from './policy'
import type { AccessEnvironment } from './environment'
import type { DeliverableFile, SiteAccessStore } from './store'
import type { SiteAccessFiles } from './file-storage'
import { isUuid } from './model'
import { downloadFilename } from './pdf'

// ── Range ────────────────────────────────────────────────────────────────────

export type RangeDecision =
  | { kind: 'full' }
  | { kind: 'partial'; start: number; end: number } // inclusive
  | { kind: 'unsatisfiable' }

/**
 * One byte range (RFC 9110 §14). Absent, malformed, multi-range or a
 * non-matching If-Range → the whole file (allowed: a server may ignore Range).
 * A range starting at or beyond the end → 416.
 */
export function decideRange(header: string | null, size: number, ifRange: string | null, etag: string): RangeDecision {
  if (!header) return { kind: 'full' }
  if (ifRange !== null && ifRange.trim() !== etag) return { kind: 'full' }
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return { kind: 'full' }
  if (m[1] === '') {
    const suffix = Number(m[2])
    if (!Number.isSafeInteger(suffix)) return { kind: 'full' }
    if (suffix === 0) return { kind: 'unsatisfiable' }
    return { kind: 'partial', start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(m[1])
  const end = m[2] === '' ? Number.MAX_SAFE_INTEGER : Number(m[2])
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return { kind: 'full' }
  if (start >= size) return { kind: 'unsatisfiable' }
  return { kind: 'partial', start, end: Math.min(end, size - 1) }
}

// ── Authorization ────────────────────────────────────────────────────────────

export type DocumentDecision = { kind: 'deny' } | { kind: 'file'; file: DeliverableFile }

export type DocumentDeps = {
  store: SiteAccessStore
  environment: AccessEnvironment | null
  resolveVisitor: (token: string) => Promise<VisitorGrants | null>
  moduleEnabled: () => Promise<boolean>
}

/** Pure decision over the injected reads. Any failure → deny. */
export async function decideDocument(
  input: { projectId: string; documentId: string; locales: string[]; token: string | null },
  deps: DocumentDeps
): Promise<DocumentDecision> {
  // No cookie: nothing to check, and nothing about the id is looked at.
  if (!input.token) return { kind: 'deny' }
  try {
    if (!(await deps.moduleEnabled())) return { kind: 'deny' }
    // Both reads always run (when there is a cookie), so a well-formed unknown
    // id costs what a real one does.
    const [visitor, file] = await Promise.all([
      deps.resolveVisitor(input.token),
      isUuid(input.documentId) ? deps.store.documentForDelivery(input.projectId, input.documentId.toLowerCase(), input.locales) : Promise.resolve(null),
    ])
    if (!visitor || !file || file.archived) return { kind: 'deny' }
    if (!file.storagePath.startsWith(`${input.projectId}/`)) return { kind: 'deny' }
    // No live group → nobody (evaluateAccess), never "everyone".
    const policy: AccessPolicy = { visibility: 'restricted', groupIds: file.groupIds }
    const decision = evaluateAccess({ chain: [policy], visitor, moduleEnabled: true })
    return decision.allowed ? { kind: 'file', file } : { kind: 'deny' }
  } catch {
    return { kind: 'deny' }
  }
}

/** The URL's language first, then the site's default; each once. */
export function deliveryLocales(requested: string, siteDefault: string | null | undefined): string[] {
  return [...new Set([requested, siteDefault].filter((l): l is string => typeof l === 'string' && l.length > 0))]
}

// ── Responses ────────────────────────────────────────────────────────────────

const PRIVATE = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

/** True for a top-level browser navigation (a person clicked a link). */
export function isNavigation(headers: Headers): boolean {
  const mode = headers.get('sec-fetch-mode')
  if (mode !== null) return mode === 'navigate'
  return (headers.get('accept') ?? '').includes('text/html')
}

/** The single refusal: identical for "unknown" and "not for you". */
export function denyResponse(headers: Headers, signInUrl: URL): Response {
  if (isNavigation(headers)) {
    return new Response(null, { status: 303, headers: { ...PRIVATE, Location: signInUrl.toString() } })
  }
  return new Response('Unauthorized', {
    status: 401,
    headers: { ...PRIVATE, 'Content-Type': 'text/plain; charset=utf-8', 'WWW-Authenticate': 'Cookie realm="site-access"' },
  })
}

function contentDisposition(kind: 'inline' | 'attachment', name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

export function etagOf(file: DeliverableFile): string {
  return `"${file.sha256}"`
}

function titleFor(file: DeliverableFile, locale: string): string | undefined {
  return file.title[locale] ?? file.title[file.locale] ?? Object.values(file.title)[0]
}

/**
 * The response for an authorised request. `fetchImpl` reads the object via a
 * signed URL (≤ 60 s) with the visitor's byte range — storage stays private
 * and no storage URL reaches the browser when viewing.
 */
export async function fileResponse(
  request: { method: string; headers: Headers; download: boolean; locale: string },
  file: DeliverableFile,
  files: SiteAccessFiles,
  fetchImpl: typeof fetch = fetch
): Promise<Response> {
  const name = downloadFilename(titleFor(file, request.locale))

  if (request.download) {
    const url = await files.signedUrl(file.storagePath, 60, name)
    return new Response(null, { status: 303, headers: { ...PRIVATE, Location: url } })
  }

  const etag = etagOf(file)
  const common = {
    ...PRIVATE,
    'Content-Type': 'application/pdf',
    'Content-Disposition': contentDisposition('inline', name),
    'Content-Language': file.locale,
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
  const range = decideRange(request.headers.get('range'), file.sizeBytes, request.headers.get('if-range'), etag)

  if (range.kind === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { ...common, 'Content-Range': `bytes */${file.sizeBytes}` } })
  }
  const partial = range.kind === 'partial'
  const start = partial ? range.start : 0
  const end = partial ? range.end : file.sizeBytes - 1
  const length = end - start + 1
  const headers = {
    ...common,
    'Content-Length': String(length),
    ...(partial ? { 'Content-Range': `bytes ${start}-${end}/${file.sizeBytes}` } : {}),
  }
  const status = partial ? 206 : 200
  if (request.method === 'HEAD') return new Response(null, { status, headers })

  let upstream: Response
  try {
    const url = await files.signedUrl(file.storagePath, 60)
    upstream = await fetchImpl(url, { headers: partial ? { Range: `bytes=${start}-${end}` } : {}, cache: 'no-store' })
  } catch {
    return storageUnavailable()
  }
  const upLength = Number(upstream.headers.get('content-length') ?? NaN)
  const okPartial = partial && upstream.status === 206 && upstream.headers.get('content-range') === `bytes ${start}-${end}/${file.sizeBytes}`
  const okFull = !partial && upstream.status === 200 && (Number.isNaN(upLength) || upLength === file.sizeBytes)
  if (!upstream.body || !(okPartial || okFull)) {
    // Storage answered something else (missing object, ignored range, a
    // different size than recorded): never pass it through.
    await upstream.body?.cancel().catch(() => undefined)
    return storageUnavailable()
  }
  return new Response(upstream.body, { status, headers })
}

function storageUnavailable(): Response {
  // Only ever reached AFTER authorisation, so it reveals nothing to a stranger.
  return new Response('Temporarily unavailable', {
    status: 503,
    headers: { ...PRIVATE, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30' },
  })
}
