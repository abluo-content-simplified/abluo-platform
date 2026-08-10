/**
 * PATCH /api/inquiries/[id]
 *
 * Updates an existing (partial) inquiry with step 2 qualification data.
 * Used when the footer CTA created a partial record and the user
 * completes the modal.
 *
 * Only the `data`, `gdpr_consent`, `gdpr_consent_at` fields are updated.
 * Core identity fields (name, email, source) are immutable after creation.
 *
 * ── AUTHORIZATION (ADR-017 slice 5 P0 fix) ──────────────────────────────
 * This route previously used `createAdminClient()` (service role — bypasses
 * RLS entirely) with NO authentication check, keyed only on the
 * request-supplied `id`: any unauthenticated caller who could guess/
 * enumerate a UUID could read and modify any tenant's inquiry data.
 *
 * Fixed by requiring an authenticated actor and switching to the
 * RLS-scoped session client (`src/lib/supabase/server.ts`) so migration
 * 014's policies — "Members can read inquiries for their tenants and
 * projects" (SELECT) and "Contributors can update inquiries for their
 * tenants and projects" (UPDATE, owner/editor only, viewer excluded) —
 * actually enforce the scoping. An unauthenticated request now fails
 * closed at 401 before touching the database at all. A cross-tenant
 * authenticated caller fails closed too: RLS filters the row out of both
 * the SELECT and the UPDATE, which this route deliberately reports as a
 * plain 404 (never a 403 that would confirm the row exists for another
 * tenant) — same "don't leak existence to an unauthorized caller"
 * convention already used by
 * src/app/api/projects/[projectId]/invite/route.ts.
 *
 * Anonymous inquiry SUBMITTERS are unaffected — this route is the step-2
 * qualification-completion PATCH used from the (already-authenticated)
 * dashboard/admin surfaces, never the public form's own POST (which stays
 * service-role — see POST /api/inquiries, wrapped in
 * `runAsTrustedSystemOperation`).
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthenticatedActor } from '@/lib/api/auth'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await getAuthenticatedActor()
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await request.json()

    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 })
    }

    // RLS-scoped session client — never the service-role admin client for
    // this route. Migration 014's policies do the actual tenant/project
    // scoping from here on.
    const supabase = await createClient()

    // ── Fetch the existing record ─────────────────────────────────────────────
    // `maybeSingle()` (not `.single()`): RLS silently filters an
    // out-of-scope row out of the result set — that is 0 rows, not an
    // error — and this route treats "0 rows" and "genuinely doesn't
    // exist" identically (fail closed, no existence leak).
    const { data: existing, error: fetchError } = await supabase
      .from('inquiries')
      .select('id, data, email')
      .eq('id', id)
      .maybeSingle()

    if (fetchError) {
      console.error('[inquiries PATCH] Supabase fetch error:', fetchError.code, fetchError.message)
      return NextResponse.json({ error: 'Failed to load inquiry' }, { status: 500 })
    }

    if (!existing) {
      return NextResponse.json({ error: 'not found' }, { status: 404 })
    }

    // ── Merge qualification data ──────────────────────────────────────────────
    const existingData = (existing.data ?? {}) as Record<string, unknown>

    const step2Fields = [
      'organization', 'role', 'website', 'country',
      'orgType', 'useCases', 'referralSource', 'message',
    ] as const

    const updatedData: Record<string, unknown> = { ...existingData, partial: false }

    for (const field of step2Fields) {
      if (body[field] !== undefined && body[field] !== '') {
        updatedData[field] = body[field]
      }
    }

    // ── GDPR consent ─────────────────────────────────────────────────────────
    const gdprConsent = body.gdprConsent === true
    const gdprConsentAt = gdprConsent
      ? new Date().toISOString()
      : (existingData.gdprConsentAt as string | undefined) ?? null

    // ── Update ───────────────────────────────────────────────────────────────
    const updatePayload = { data: updatedData, gdpr_consent: gdprConsent, gdpr_consent_at: gdprConsentAt }
    const { data: updatedRows, error: updateError } = await supabase
      .from('inquiries')
      .update(updatePayload)
      .eq('id', id)
      .select('id')

    if (updateError) {
      console.error('[inquiries PATCH] Supabase update error:', updateError.code, updateError.message)
      return NextResponse.json(
        { error: 'Failed to update inquiry' },
        { status: 500 }
      )
    }

    if (!updatedRows || updatedRows.length === 0) {
      // Passed the SELECT above (so the row exists and was visible a
      // moment ago) but the UPDATE policy — owner/editor only, viewer
      // excluded (migration 014) — denied the write. A real, distinguishable
      // "you can see this but can't edit it" case, unlike the SELECT-stage
      // 404 above, so 403 is correct here (no existence leak — the caller
      // already confirmed existence via the successful SELECT/200-eligible
      // fetch above).
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // ── EMAIL NOTIFICATION HOOK ───────────────────────────────────────────────
    // TODO: trigger emails after successful step 2 completion.
    // Integration point: add your email provider call here (Resend, SendGrid, etc.)
    // Available: id, existing.email, body fields
    //
    // await sendConfirmationEmail({ to: existing.email, name: existing.name })
    // await sendAdminNotification({ inquiryId: id })
    // ─────────────────────────────────────────────────────────────────────────

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[inquiries PATCH] unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
