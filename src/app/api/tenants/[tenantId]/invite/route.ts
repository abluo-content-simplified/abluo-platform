import { NextRequest, NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { createInvitation } from '@/lib/invitations/service'

/**
 * POST /api/tenants/[tenantId]/invite — Super Admin invites a person to a
 * client (tenant) as Owner or Member (ADR-028 §6). Body:
 * `{ email, role?: 'owner' | 'member', extras?: string[], locale?: string }`.
 *
 * Authorization: requireAbluoAdmin() (Abluo admin with a 2FA session) — the
 * only way a client gets its first Owner. The invitation record, the email
 * and the acceptance (with a fresh no-escalation check) are handled by
 * src/lib/invitations. No membership is created here: only accepting the
 * emailed link does that.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const actor = await requireAbluoAdmin()
  if (!actor) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  const ctx = await getTenantAuthorizationContext()
  if (!ctx) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })

  const { tenantId } = await params
  let body: { email?: unknown; role?: unknown; extras?: unknown; locale?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await createInvitation(ctx, {
    target: { scope: 'tenant', tenantId },
    email: body.email,
    role: body.role ?? 'owner',
    extras: body.extras,
    locale: typeof body.locale === 'string' ? body.locale : 'en',
    requestOrigin: request.nextUrl.origin,
    adminAssured: true,
  })
  if (!result.ok) {
    const status = result.error === 'forbidden' ? 403 : result.error === 'not_found' ? 404 : result.error === 'failed' ? 500 : 400
    return NextResponse.json({ success: false, error: result.error }, { status })
  }
  return NextResponse.json({ success: true, data: { invitationId: result.id, emailSent: result.emailSent } })
}
