/**
 * POST /api/forms/[projectSlug]/[formId]/submissions
 *
 * ADR-018 slice 1 — the ANONYMOUS create path. No session; the submitter is a
 * website visitor. Runs spam + server validation, resolves tenant/project
 * server-side from the route's projectSlug (never the body), pins
 * form_version + definition_snapshot at creation, and either finalizes
 * (single-step) or returns a rotating single-use completion token (multi-step).
 *
 * This route shares NO endpoint with the authenticated dashboard path — which is
 * exactly what retires the #88 dual-purpose collision.
 */
import { NextResponse } from 'next/server'
import { extractIp } from '@/lib/forms/spam'
import { readJsonBodyWithLimit } from '@/lib/forms/request-limits'
import { createSubmission } from '@/lib/forms/submissions'
import { serverSourceEnrichment, SERVER_SOURCE_KEYS } from '@/lib/forms/server-source'
import { asSupabaseProjectSlug } from '@/lib/tenancy/ids'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectSlug: string; formId: string }> },
) {
  try {
    const { projectSlug, formId } = await params

    // Bound the write BEFORE anything else touches it. This endpoint is public
    // and unauthenticated; without a cap of our own the only ceiling is Vercel's
    // 4.5 MB. Oversized bodies are refused on `content-length` where possible and
    // aborted mid-stream where the header is missing or lying.
    const read = await readJsonBodyWithLimit(request)
    if (!read.ok) return NextResponse.json({ error: read.error }, { status: read.status })
    const body = read.body
    const headers = request.headers

    const ip = extractIp(headers)

    // NOTE the `source` object is key/value-whitelisted in the submission
    // service (`sanitizeSource`), not here — so any caller of createSubmission
    // gets the same treatment `context` already had. The server-derived keys
    // (device_type, country, region, city) are applied AFTER the client's, and
    // a client-sent value for any of them is dropped first — so a client can
    // never supply them, even when the header is absent.
    const clientSource: Record<string, unknown> =
      body.source && typeof body.source === 'object' && !Array.isArray(body.source)
        ? { ...(body.source as Record<string, unknown>) }
        : {}
    for (const k of SERVER_SOURCE_KEYS) delete clientSource[k]
    const source: Record<string, unknown> = { ...clientSource, ...serverSourceEnrichment(headers) }

    const result = await createSubmission({
      // Trust boundary: the `[projectSlug]` URL segment IS a project slug, and
      // this is the one place it is branded as one. The owning tenant is
      // resolved from it server-side — it is never used as a tenant slug.
      projectSlug: asSupabaseProjectSlug(projectSlug),
      formId,
      locale: typeof body.locale === 'string' ? body.locale : undefined,
      source,
      context: isPlainObject(body.context) ? body.context : undefined,
      data: isPlainObject(body.data) ? body.data : undefined,
      gdprConsent: body.gdprConsent === true,
      ip,
      // Forwarded raw: an ABSENT honeypot is a distinct signal from an empty
      // one (see evaluateHoneypot) and must not be normalised away here.
      honeypot: body.company_website,
      openedAt: body.openedAt,
    })

    if ('spam' in result) return NextResponse.json({ ok: true })
    if (!result.ok) {
      return NextResponse.json({ error: result.error, errors: result.errors }, { status: result.status })
    }
    return NextResponse.json({
      ok: true,
      submissionId: result.submissionId,
      done: result.done,
      completionToken: result.completionToken,
      nextStepKey: result.nextStepKey,
    })
  } catch (err) {
    console.error('[forms submissions POST] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Arrays are objects in JS; a JSON array is never a valid data/context payload. */
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}
