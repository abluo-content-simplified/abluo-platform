import { NextRequest, NextResponse } from 'next/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/tenants/[tenantId]/invite — invite a tenant OWNER.
 *
 * ADR-017 slice 4 (client login + invitation flow). The acceptance leg
 * (`redirectTo` target, set-password flow) is built — see
 * src/app/invite/accept/page.tsx and src/app/auth/callback/route.ts. This
 * route is still inert until Tom has (a) configured Supabase Auth's
 * "Invite user" email template / confirmed it routes through the Resend
 * SMTP integration, and (b) added this deployment's `/invite/accept` URL to
 * the Supabase project's redirect allowlist (handoff §8) — both
 * Tom-decisions, not assumptions made here.
 *
 * Authorization: abluo_admin only. Tenant owners cannot invite other
 * tenant owners for the same tenant (ownership is an Abluo-admin
 * grant, not a self-service one) — mirrors how `tenant_members`
 * ownership rows are currently created only by admin-side signup
 * metadata (migration 004), never by another owner.
 *
 * Membership creation on acceptance happens via `handle_new_user()`
 * reading `{ tenant_id, role: 'owner' }` from the invited user's
 * signup metadata (migration 004, unchanged — this is the EXISTING
 * shipped path, not new). This route only sends the invite; it does
 * not, and must not, insert into `tenant_members` directly — that
 * would create a membership row before the invitee has verified
 * their email / set a password, which the trigger-based path avoids
 * by construction.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const actor = await requireAbluoAdmin()
  if (!actor) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const { tenantId } = await params

  let body: { email?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = body.email?.trim()
  if (!email) {
    return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 })
  }

  // Points at the invite-acceptance page (this slice — see
  // src/app/invite/accept/page.tsx), not /login. `request.nextUrl.origin`
  // is env-aware by construction — it resolves to whatever host actually
  // served the request, so dev/preview/prod each get the correct origin
  // without a hardcoded domain or a NEXT_PUBLIC_SITE_URL env var.
  const redirectTo = `${request.nextUrl.origin}/invite/accept`

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      tenant_id: tenantId,
      role: 'owner',
      invited_by: actor.userId,
    },
    redirectTo,
  })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: { userId: data.user?.id } })
}
