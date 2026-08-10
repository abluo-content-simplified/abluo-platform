/**
 * POST /api/form-submissions
 *
 * Receives a form submission from the Form System and stores it in the
 * inquiries table. Shares the same storage shape as /api/inquiries:
 *
 *   name, email, phone → top-level columns
 *   gdprConsent        → gdpr_consent / gdpr_consent_at
 *   everything else    → data JSONB
 *
 * Spam protection: honeypot → timing → rate limit (same as /api/inquiries).
 * All spam rejections return 200 — never reveal which check fired.
 *
 * The route does NOT require tenant/project context — the form renderer
 * passes tenantSlug + projectSlug from page context if available. If not
 * provided, tenant_id and project_id stay null (inquiry is not lost).
 */

import { NextResponse } from 'next/server'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { runSpamChecks, extractIp } from '@/lib/forms/spam'

export async function POST(request: Request) {
  try {
    const body = await request.json()

    // ── Spam protection ──────────────────────────────────────────────────────
    const ip = extractIp(request.headers as unknown as Headers)

    return await runAsTrustedSystemOperation(
      'Anonymous public form-submission POST — no user session exists (the submitter is a ' +
        'website visitor, never an authenticated tenant/project member). Covers: the ' +
        'isRateLimited() per-IP count query, the tenants/projects slug lookups, and the ' +
        'inquiries INSERT itself.',
      async (supabase) => {
        const spamResult = await runSpamChecks(
          {
            honeypot: body.company_website,
            openedAt: body.openedAt,
            ip,
          },
          supabase
        )

        if (spamResult.blocked) {
          return NextResponse.json({ ok: true })
        }

        // ── Validate required fields ───────────────────────────────────────
        const name = (body.name ?? '').trim()
        const email = (body.email ?? '').trim()

        // Name and email are optional for forms that don't include them —
        // but if provided, email must be valid.
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return NextResponse.json({ error: 'invalid email' }, { status: 400 })
        }

        // ── Resolve tenant_id and project_id (optional) ────────────────────
        let tenantId: string | null = null
        let projectId: string | null = null

        if (body.tenantSlug) {
          const { data: tenant } = await supabase
            .from('tenants')
            .select('id')
            .eq('slug', body.tenantSlug)
            .single()

          if (tenant) {
            tenantId = tenant.id

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

        // ── Build data payload ──────────────────────────────────────────────
        // Skip known top-level / metadata keys — everything else is form data
        const SKIP_KEYS = new Set([
          'name', 'email', 'phone',
          'gdprConsent', 'gdpr_consent',
          'inquiryType', 'tenantSlug', 'projectSlug',
          'openedAt', 'company_website',
        ])

        const data: Record<string, unknown> = { ip }

        for (const [key, val] of Object.entries(body)) {
          if (!SKIP_KEYS.has(key) && val !== undefined && val !== '') {
            data[key] = val
          }
        }

        // ── GDPR consent ─────────────────────────────────────────────────────
        const gdprConsent = body.gdprConsent === true || body.gdpr_consent === true
        const gdprConsentAt = gdprConsent ? new Date().toISOString() : null

        // ── Insert ───────────────────────────────────────────────────────────
        const { data: inquiry, error } = await supabase
          .from('inquiries')
          .insert({
            tenant_id: tenantId,
            project_id: projectId,
            inquiry_type: body.inquiryType ?? 'contact',
            name: name || null,
            email: email || null,
            phone: body.phone ?? null,
            gdpr_consent: gdprConsent,
            gdpr_consent_at: gdprConsentAt,
            data,
            source: body.source ?? null,
          })
          .select('id')
          .single()

        if (error) {
          console.error('[form-submissions POST] Supabase insert error:', error.code, error.message)
          return NextResponse.json({ error: 'Failed to save submission' }, { status: 500 })
        }

        return NextResponse.json({ id: inquiry.id, ok: true })
      }
    )
  } catch (err) {
    console.error('[form-submissions POST] unexpected error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
