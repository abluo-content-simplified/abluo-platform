import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedActor } from '@/lib/api/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const INVITABLE_ROLES = new Set(['editor', 'viewer'])

/**
 * POST /api/projects/[projectId]/invite — invite an EDITOR or VIEWER to a
 * single project.
 *
 * ADR-017 slice 4 (client login + invitation flow). Handles the "tenant
 * owner invites editor/viewer to one of their projects" leg. The
 * acceptance leg (`redirectTo` target, set-password flow) is built — see
 * src/app/invite/accept/page.tsx and src/app/auth/callback/route.ts. Same
 * operational caveat as the tenant-owner invite route: inert until Tom
 * configures the Supabase Auth email template / SMTP routing and the
 * redirect allowlist (handoff §8).
 *
 * Authorization: the caller must hold `owner` on the TENANT that owns this
 * project (ADR-017 Decision 2 — ownership is tenant-level; there is no
 * project-level owner to delegate from). This mirrors the RLS policy
 * already shipped on `project_members` writes (migration 007, "Tenant
 * owners can add members to their projects") — this route performs the
 * equivalent check application-side, via the caller's own RLS-scoped
 * session client (never the service-role admin client), before touching
 * the admin client for the invite-send call only.
 *
 * Membership creation on acceptance is the one open fork this ADR/handoff
 * flags (handoff §5.1, §8, decision 1): a `handle_new_user()` trigger
 * extension (drafted, NOT applied —
 * supabase/migrations/010_project_member_invite_trigger.sql.draft) vs a
 * server action run after the invited user's first login. This route
 * sends the invite either way; until the membership-creation mechanism is
 * built, an accepted invite authenticates the user but does not yet grant
 * a `project_members` row.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  const actor = await getAuthenticatedActor()
  if (!actor) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const { projectId } = await params

  let body: { email?: string; role?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = body.email?.trim()
  const role = body.role
  if (!email) {
    return NextResponse.json({ success: false, error: 'email is required' }, { status: 400 })
  }
  if (!role || !INVITABLE_ROLES.has(role)) {
    return NextResponse.json(
      { success: false, error: "role must be 'editor' or 'viewer'" },
      { status: 400 }
    )
  }

  // Authorize via the caller's own RLS-scoped session — never the
  // service-role client — mirroring ADR-017's "resolve fresh from the
  // database, never from the JWT" principle (Decision 3).
  const supabase = await createClient()

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, tenant_id')
    .eq('id', projectId)
    .maybeSingle()

  if (projectError) {
    return NextResponse.json({ success: false, error: projectError.message }, { status: 500 })
  }
  if (!project) {
    // RLS-invisible or nonexistent — collapsed to one response, same
    // fail-closed convention as requireAbluoAdmin (auth.ts header).
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  }

  const { data: ownerMembership, error: ownerError } = await supabase
    .from('tenant_members')
    .select('id')
    .eq('tenant_id', project.tenant_id)
    .eq('user_id', actor.userId)
    .eq('role', 'owner')
    .maybeSingle()

  if (ownerError) {
    return NextResponse.json({ success: false, error: ownerError.message }, { status: 500 })
  }
  if (!ownerMembership) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  // Same target and same env-aware-origin rationale as the tenant-owner
  // invite route — see src/app/api/tenants/[tenantId]/invite/route.ts.
  const redirectTo = `${request.nextUrl.origin}/invite/accept`

  const admin = createAdminClient()
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: {
      project_id: projectId,
      role,
      invited_by: actor.userId,
    },
    redirectTo,
  })

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: { userId: data.user?.id } })
}
