/**
 * PATCH /api/inquiries/[id]
 *
 * Updates an existing (partial) inquiry with step 2 qualification data.
 * Used when the footer CTA created a partial record and the user
 * completes the modal.
 *
 * Only the `data`, `gdpr_consent`, `gdpr_consent_at` fields are updated.
 * Core identity fields (name, email, source) are immutable after creation.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()

    if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
      return NextResponse.json({ error: 'invalid id' }, { status: 400 })
    }

    const supabase = createAdminClient()

    // ── Fetch the existing record ─────────────────────────────────────────────
    const { data: existing, error: fetchError } = await supabase
      .from('inquiries')
      .select('id, data, email')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
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
    const { error: updateError } = await supabase
      .from('inquiries')
      .update({
        data:            updatedData,
        gdpr_consent:    gdprConsent,
        gdpr_consent_at: gdprConsentAt,
      })
      .eq('id', id)

    if (updateError) {
      console.error('[inquiries/patch] update error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update inquiry' },
        { status: 500 }
      )
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
    console.error('[inquiries/patch] unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
