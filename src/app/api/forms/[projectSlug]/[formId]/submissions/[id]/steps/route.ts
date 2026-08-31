/**
 * POST /api/forms/[projectSlug]/[formId]/submissions/[id]/steps
 *
 * ADR-018 slice 1 — the ANONYMOUS step-completion path. Advances a partial
 * multi-step submission using a single-use rotating token. Only whitelisted
 * fields of the presented step, on a still-partial submission, are accepted;
 * the token is spent and (on a non-final step) a fresh one is returned. The
 * final step finalizes the submission and emits `form.submitted`.
 *
 * form_id / form_version / definition_snapshot / tenant / project are already
 * pinned on the row and are never re-read from the body (§18).
 */
import { NextResponse } from 'next/server'
import { completeStep } from '@/lib/forms/submissions'
import { asProjectSlug } from '@/lib/tenancy/ids'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectSlug: string; formId: string; id: string }> },
) {
  try {
    const { projectSlug, formId, id } = await params
    const body = await request.json().catch(() => ({}))

    if (typeof body.stepKey !== 'string' || !body.stepKey) {
      return NextResponse.json({ error: 'stepKey required' }, { status: 400 })
    }

    const result = await completeStep({
      // Trust boundary — see the sibling create route: this segment is a
      // PROJECT slug and is branded here, once.
      projectSlug: asProjectSlug(projectSlug),
      formId,
      submissionId: id,
      completionToken: typeof body.completionToken === 'string' ? body.completionToken : undefined,
      stepKey: body.stepKey,
      data: body.data && typeof body.data === 'object' ? body.data : undefined,
      gdprConsent: body.gdprConsent === true,
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
    console.error('[forms submissions steps POST] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
