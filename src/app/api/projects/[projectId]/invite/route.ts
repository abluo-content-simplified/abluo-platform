import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedActor } from '@/lib/api/auth'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { checkGrant, granterForProject } from '@/lib/authz'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'

// ADR-028: Viewer is retired. Site admin ('admin') becomes invitable once
// migration 029 widens project_members.role; until then the database accepts
// only 'editor' | 'viewer', so this route offers 'editor' alone.
const INVITABLE_NOW = new Set(['editor'])

/**
 * POST /api/projects/[projectId]/invite — invite an EDITOR to a single
 * project (ADR-028: Viewer retired; Site admin after migration 029).
 *
 * ADR-017 slice 4 (client login + invitation flow). Handles the "tenant
 * owner invites editor/viewer to one of their projects" leg. The
 * acceptance leg (`redirectTo` target, set-password flow) is built — see
 * src/app/invite/accept/page.tsx and src/app/auth/callback/route.ts. Same
 * operational caveat as the tenant-owner invite route: inert until Tom
 * configures the Supabase Auth email template / SMTP routing and the
 * redirect allowlist (handoff §8).
 *
 * Authorization (ADR-028): the caller must hold `users.invite` on this
 * project in their resolved grants (Owner of the tenant, or Site admin of
 * the project) and pass the no-escalation rules (`checkGrant`). Grants are
 * resolved fresh from the database through the caller's own RLS-scoped
 * session; the service role is used for the invite-send call only.
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
  if (!role || !INVITABLE_NOW.has(role)) {
    return NextResponse.json({ success: false, error: "role must be 'editor'" }, { status: 400 })
  }

  // Authorize from the caller's resolved grants (fresh from the database via
  // their own RLS-scoped session — ADR-017 Decision 3) and the no-escalation
  // rules (ADR-028 §4): the caller must hold users.invite on THIS project and
  // may only invite at or below their own level. A project the caller holds
  // no grant on is refused the same way as one they may not invite into.
  const authz = await getTenantAuthorizationContext()
  const granter = authz ? granterForProject(authz, projectId) : null
  const decision = granter
    ? checkGrant(granter, { scope: 'project', action: 'invite', role: role as 'editor', extras: [] })
    : null
  if (!decision?.ok) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  // Same target and same env-aware-origin rationale as the tenant-owner
  // invite route — see src/app/api/tenants/[tenantId]/invite/route.ts.
  const redirectTo = `${request.nextUrl.origin}/invite/accept`

  const { data, error } = await runAsTrustedSystemOperation(
    `user ${actor.userId} inviting a project ${role} (project ${projectId}) — ` +
      'auth.admin.inviteUserByEmail requires the service role; caller authorization was ' +
      'already verified above (resolved grant + ADR-028 no-escalation rules).',
    (admin) =>
      admin.auth.admin.inviteUserByEmail(email, {
        data: {
          project_id: projectId,
          role,
          invited_by: actor.userId,
        },
        redirectTo,
      })
  )

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, data: { userId: data.user?.id } })
}
