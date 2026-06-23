/**
 * POST /api/inquiries
 *
 * Creates a new inquiry record. Handles both partial submissions (step 1:
 * name + email only) and full submissions (both steps combined).
 *
 * Returns { id: string } on success so the client can PATCH later with step 2.
 *
 * Spam protection: honeypot → timing → rate limit (in order).
 * All spam rejections return 200 OK — never reveal which check fired.
 */

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runSpamChecks, extractIp } from '@/lib/forms/spam'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    // ── Request metadata (resolved server-side — not trusted from client) ────
    const ip      = extractIp(request.headers as unknown as Headers)
    // Vercel injects x-vercel-ip-country on all deployments (ISO 3166-1 alpha-2).
    // Falls back to null in local dev and non-Vercel environments.
    const country = (request.headers as unknown as Headers).get('x-vercel-ip-country') ?? null
    // Classify device from User-Agent — mobile / tablet / desktop only.
    // No npm dependency needed; regex covers all modern UA patterns.
    const ua          = (request.headers as unknown as Headers).get('user-agent') ?? ''
    const device_type = /iPad|tablet|(android(?!.*mobile))/i.test(ua)
      ? 'tablet'
      : /Mobi|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)
        ? 'mobile'
        : 'desktop'

    const supabase = createAdminClient()

    // ── Spam protection ──────────────────────────────────────────────────────

    const spamResult = await runSpamChecks(
      {
        honeypot: body.company_website,
        openedAt: body.openedAt,
        ip,
      },
      supabase
    )

    if (spamResult.blocked) {
      // Silent 200 — do not reveal which check fired or that we blocked
      return NextResponse.json({ id: null, ok: true })
    }

    // ── TURNSTILE CHECK GOES HERE (future) ───────────────────────────────────
    // if (body.turnstileToken) {
    //   const valid = await verifyTurnstile(body.turnstileToken)
    //   if (!valid) return NextResponse.json({ id: null, ok: true })
    // }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Validate required fields ─────────────────────────────────────────────
    const name  = (body.name  ?? '').trim()
    const email = (body.email ?? '').trim()

    if (!name || !email) {
      return NextResponse.json(
        { error: 'name and email are required' },
        { status: 400 }
      )
    }

    // Basic email format check (full validation is on the client)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: 'invalid email' },
        { status: 400 }
      )
    }

    // ── Resolve tenant_id from tenantSlug ────────────────────────────────────
    // The client passes tenantSlug (e.g. 'livener'). We resolve to UUID server-side.
    // If the slug doesn't exist, tenant_id stays null — inquiry is not lost.
    let tenantId: string | null = null
    let projectId: string | null = null

    if (body.tenantSlug) {
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .select('id')
        .eq('slug', body.tenantSlug)
        .single()

      if (tenant) {
        tenantId = tenant.id

        // Optionally resolve project_id from projectSlug
        if (body.projectSlug) {
          const { data: project } = await supabase
            .from('projects')
            .select('id')
            .eq('slug', body.projectSlug)
            .eq('tenant_id', tenantId)
            .single()

          if (project) projectId = project.id
        }
      }
    }

    // ── Build qualification data (step 2 fields + metadata) ──────────────────
    const data: Record<string, unknown> = {
      partial: body.partial ?? true,
      ip,
    }

    // ── Attribution fields ───────────────────────────────────────────────────
    // Stored in data JSONB for reporting and A/B testing.
    // cta_internal_name is normalized to a stable slug format on write so
    // reporting always sees clean identifiers regardless of editor input.
    // project_slug stored alongside project_id for direct JSONB queries.

    /**
     * Normalizes any string to a stable lowercase-hyphenated slug.
     * "Hero Investors"     → "hero-investors"
     * "hero-investors-a"  → "hero-investors-a" (already normalized — unchanged)
     * "Header CTA (V2)"   → "header-cta-v2"
     */
    function toAttributionSlug(value: unknown): string | null {
      if (typeof value !== 'string' || !value.trim()) return null
      return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    }

    if (body.cta_internal_name != null) {
      const normalized = toAttributionSlug(body.cta_internal_name)
      if (normalized) data['cta_internal_name'] = normalized
    }

    const plainAttributionFields = ['cta_label_snapshot', 'page_slug', 'referrer_url'] as const
    for (const field of plainAttributionFields) {
      if (body[field] != null && body[field] !== '') {
        data[field] = body[field]
      }
    }

    // project_slug — stored in data for direct reporting without a join
    if (body.projectSlug) data['project_slug'] = body.projectSlug

    // Locale — which language version the user was viewing (from client)
    if (body.locale) data['locale'] = body.locale

    // Country — derived from IP via Vercel header (server-side, not client-trusted)
    if (country) data['country'] = country

    // Device type — derived from User-Agent (server-side)
    data['device_type'] = device_type

    // Step 2 qualification fields — only set if provided
    const step2Fields = [
      'organization', 'role', 'website', 'country',
      'orgType', 'useCases', 'referralSource', 'message',
    ] as const

    for (const field of step2Fields) {
      if (body[field] !== undefined && body[field] !== '') {
        data[field] = body[field]
      }
    }

    // ── GDPR consent ─────────────────────────────────────────────────────────
    const gdprConsent = body.gdprConsent === true
    const gdprConsentAt = gdprConsent ? new Date().toISOString() : null

    // ── Insert ───────────────────────────────────────────────────────────────
    const { data: inquiry, error } = await supabase
      .from('inquiries')
      .insert({
        tenant_id:      tenantId,
        project_id:     projectId,
        inquiry_type:   body.inquiryType ?? 'early_access',
        name,
        email,
        phone:          body.phone ?? null,
        gdpr_consent:   gdprConsent,
        gdpr_consent_at: gdprConsentAt,
        data,
        source:         body.source ?? null,
      })
      .select('id')
      .single()

    if (error) {
      console.error('[inquiries POST] Supabase insert error:', error.code, error.message)
      return NextResponse.json(
        { error: 'Failed to save inquiry' },
        { status: 500 }
      )
    }

    // ── EMAIL NOTIFICATION HOOK ───────────────────────────────────────────────
    // TODO: trigger emails after a FULL submission (when partial is false).
    // Integration point: add your email provider call here (Resend, SendGrid, etc.)
    // Available: inquiry.id, name, email, body.inquiryType, body.source
    //
    // if (!data.partial) {
    //   await sendConfirmationEmail({ to: email, name })
    //   await sendAdminNotification({ inquiry })
    // }
    // ─────────────────────────────────────────────────────────────────────────

    return NextResponse.json({ id: inquiry.id, ok: true })
  } catch (err) {
    console.error('[inquiries] unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
