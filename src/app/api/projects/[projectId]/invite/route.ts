import { NextRequest, NextResponse } from 'next/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { createInvitation } from '@/lib/invitations/service'

/**
 * POST /api/projects/[projectId]/invite — invite a person to one site
 * (project) as Site admin or Editor (ADR-028 §6). Body:
 * `{ email, role: 'admin' | 'editor', extras?: string[], locale?: string }`.
 *
 * Authorization (ADR-028 §4): from the caller's resolved grants — the caller
 * must hold users.invite on THIS project (Owner of the client, or Site admin
 * of the site) and pass the no-escalation rules (a Site admin may invite
 * Editors only, and give only extras it holds). A project the caller holds no
 * grant on is refused exactly like one they may not invite into. No
 * membership is created here: only accepting the emailed link does that.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })

  const { projectId } = await params
  let body: { email?: unknown; role?: unknown; extras?: unknown; locale?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await createInvitation(ctx, {
    target: { scope: 'project', projectId },
    email: body.email,
    role: body.role,
    extras: body.extras,
    locale: typeof body.locale === 'string' ? body.locale : 'en',
    requestOrigin: request.nextUrl.origin,
  })
  if (!result.ok) {
    const status = result.error === 'forbidden' ? 403 : result.error === 'not_found' ? 404 : result.error === 'failed' ? 500 : 400
    return NextResponse.json({ success: false, error: result.error }, { status })
  }
  return NextResponse.json({ success: true, data: { invitationId: result.id, emailSent: result.emailSent } })
}
