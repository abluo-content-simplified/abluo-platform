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
import { createSubmission } from '@/lib/forms/submissions'
import { asProjectSlug } from '@/lib/tenancy/ids'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectSlug: string; formId: string }> },
) {
  try {
    const { projectSlug, formId } = await params
    const body = await request.json().catch(() => ({}))
    const headers = request.headers

    const ip = extractIp(headers)
    const country = headers.get('x-vercel-ip-country') ?? null
    const ua = headers.get('user-agent') ?? ''
    const deviceType = /iPad|tablet|(android(?!.*mobile))/i.test(ua)
      ? 'tablet'
      : /Mobi|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
        ? 'mobile'
        : 'desktop'

    const source: Record<string, unknown> = {
      ...(body.source && typeof body.source === 'object' ? body.source : {}),
      device_type: deviceType,
    }
    if (country) source.country = country

    const result = await createSubmission({
      // Trust boundary: the `[projectSlug]` URL segment IS a project slug, and
      // this is the one place it is branded as one. The owning tenant is
      // resolved from it server-side — it is never used as a tenant slug.
      projectSlug: asProjectSlug(projectSlug),
      formId,
      locale: typeof body.locale === 'string' ? body.locale : undefined,
      source,
      context: body.context && typeof body.context === 'object' ? body.context : undefined,
      data: body.data && typeof body.data === 'object' ? body.data : undefined,
      gdprConsent: body.gdprConsent === true,
      ip,
      honeypot: body.company_website,
      openedAt: typeof body.openedAt === 'number' ? body.openedAt : undefined,
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
