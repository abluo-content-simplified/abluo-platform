/**
 * Notification consumer — ADR-019.
 *
 * Processes `form.submitted` outbox rows and sends the notification email.
 * Called by BOTH triggers, keyed on event_id, so they never double-send:
 *   - the Supabase Database Webhook (near-instant, on insert)
 *   - the production cron recovery sweep (re-drives pending/failed)
 *
 * Idempotency: `deliverEvent` atomically CLAIMS a row (pending|failed →
 * delivering) with a guarded UPDATE. Only one caller's UPDATE matches; the
 * other gets 0 rows and no-ops. On success → delivered; on failure → failed
 * (retryable) or dead after MAX_ATTEMPTS.
 *
 * Environment gate: only environment='production' events are delivered; a
 * non-production event is marked 'skipped' (terminal). This is what stops
 * dev/preview submissions (which fire the same shared webhook) from emailing.
 *
 * Known V1 limitation: a process crash between claim and finalize leaves a row
 * in 'delivering' that the sweep does not re-pick (no claim timestamp yet).
 * Rare; the outbox preserves the data. A timestamp-based reclaim is a follow-up.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { isProductionEnvironment } from '@/lib/notifications/environment'
import { resolveRecipients } from '@/lib/notifications/recipients'
import { sendEmail } from '@/lib/notifications/resend'
import { renderNewSubmissionEmail } from '@/lib/notifications/templates'
import { resolveInternalEmailConfig, safeReplyTo } from '@/lib/notifications/branding'

const MAX_ATTEMPTS = 5
const SWEEP_BATCH = 50

export type DeliverOutcome = 'delivered' | 'failed' | 'dead' | 'skipped' | 'noop'

async function finalize(
  supabase: SupabaseClient,
  eventId: string,
  status: Exclude<DeliverOutcome, 'noop'>,
  attempts: number,
  lastError: string | null,
): Promise<void> {
  const terminal = status === 'delivered' || status === 'skipped' || status === 'dead'
  await supabase
    .from('form_events')
    .update({
      status,
      attempts,
      last_error: lastError,
      processed_at: terminal ? new Date().toISOString() : null,
    })
    .eq('event_id', eventId)
}

/**
 * Resolves the tenant/URL slug an event's notification is addressed to.
 *
 * Prefers the slug of the event's OWN `project_id` over the denormalized
 * `project_slug` column: the column is written at emit time from the request's
 * route, so a wrong or stale value there (e.g. rows written before the
 * completeStep tenant-isolation guard) would otherwise route a submission to
 * another tenant's recipients and branding. Falls back to `project_slug` only
 * for platform-level events (no project_id) or an unresolvable project.
 */
async function resolveEventProjectSlug(
  supabase: SupabaseClient,
  event: Record<string, unknown>,
): Promise<string | null> {
  const projectId = (event.project_id as string | null) ?? null
  if (projectId) {
    const { data } = await supabase
      .from('projects')
      .select('slug')
      .eq('id', projectId)
      .maybeSingle()
    const slug = (data?.slug as string | undefined) ?? null
    if (slug) return slug
  }
  return (event.project_slug as string | null) ?? null
}

/** Delivers a single event, idempotently. Safe to call from webhook AND sweep. */
export async function deliverEvent(eventId: string): Promise<{ outcome: DeliverOutcome; reason?: string }> {
  return runAsTrustedSystemOperation(
    'Form notification delivery (ADR-019) — claim a form_events row and send the owner notification email.',
    async (supabase): Promise<{ outcome: DeliverOutcome; reason?: string }> => {
      // Atomic claim: only pending|failed rows are claimable. Whoever's UPDATE
      // runs first wins; the other caller gets 0 rows → noop (no double-send).
      const { data: claimedRows } = await supabase
        .from('form_events')
        .update({ status: 'delivering' })
        .eq('event_id', eventId)
        .in('status', ['pending', 'failed'])
        .select('*')
      const event = claimedRows?.[0]
      if (!event) return { outcome: 'noop', reason: 'not claimable (already processed/missing)' }

      const attempts = (event.attempts as number) ?? 0

      // Environment gate — only production delivers.
      if (!isProductionEnvironment(event.environment as string | null)) {
        await finalize(supabase, eventId, 'skipped', attempts, `non-production (environment=${event.environment ?? 'null'})`)
        return { outcome: 'skipped', reason: 'non-production' }
      }

      const topic = (event.topic as string) || (event.form_id as string)
      const projectSlug = await resolveEventProjectSlug(supabase, event as Record<string, unknown>)
      if (!projectSlug) {
        await finalize(supabase, eventId, 'skipped', attempts, 'no project_slug on event')
        return { outcome: 'skipped', reason: 'no project_slug' }
      }

      const recipients = await resolveRecipients(projectSlug, topic)
      if (recipients.length === 0) {
        await finalize(supabase, eventId, 'skipped', attempts, `no recipients configured for topic "${topic}"`)
        return { outcome: 'skipped', reason: 'no recipients' }
      }

      // Load submission content for the email body.
      const { data: sub } = await supabase
        .from('form_submissions')
        .select('submission_data, source, created_at, form_id, locale')
        .eq('id', event.submission_id as string)
        .maybeSingle()

      const locale = (event.locale as string) || (sub?.locale as string) || 'en'

      // Tenant/project-level personalization (ADR-019 Amendment A), read at send
      // time. Never throws — a miss yields the generic default.
      const cfg = await resolveInternalEmailConfig(projectSlug, locale)
      const submitterEmail = cfg.replyToSubmitter
        ? safeReplyTo((sub?.submission_data as Record<string, unknown> | undefined)?.email)
        : undefined

      const email = renderNewSubmissionEmail({
        formId: event.form_id as string,
        topic,
        locale,
        submissionId: event.submission_id as string,
        submissionData: (sub?.submission_data as Record<string, unknown>) ?? {},
        source: (sub?.source as Record<string, unknown>) ?? {},
        createdAt: sub?.created_at as string | undefined,
        fromName: cfg.fromName,
        intro: cfg.intro,
        subjectTemplate: cfg.subjectTemplate,
        logoUrl: cfg.logoUrl,
      })

      // Send a SEPARATE email per recipient — better privacy (recipients never
      // see each other) and a cleaner single-recipient signal to strict filters.
      const sendResults = await Promise.all(
        recipients.map((to) =>
          sendEmail({ to: [to], subject: email.subject, html: email.html, text: email.text, fromName: cfg.fromName, replyTo: submitterEmail }).then((res) => ({ to, res })),
        ),
      )
      const failures = sendResults.filter((r) => !r.res.ok)
      if (failures.length === 0) {
        await finalize(supabase, eventId, 'delivered', attempts, null)
        return { outcome: 'delivered' }
      }

      // Partial or total failure — retry (the sweep re-sends; already-accepted
      // recipients may get a duplicate on retry, which is acceptable vs. losing one).
      const errMsg = failures.map((f) => `${f.to}: ${f.res.error}`).join('; ')
      const nextAttempts = attempts + 1
      const nextStatus = nextAttempts >= MAX_ATTEMPTS ? 'dead' : 'failed'
      await finalize(supabase, eventId, nextStatus, nextAttempts, errMsg)
      return { outcome: nextStatus, reason: errMsg }
    },
  )
}

/** Recovery sweep — re-drives production events left pending/failed. */
export async function sweepFormEvents(limit: number = SWEEP_BATCH): Promise<{
  processed: number
  outcomes: Record<string, number>
}> {
  const ids = await runAsTrustedSystemOperation(
    'Form notification recovery sweep (ADR-019) — list production events still pending/failed to retry.',
    async (supabase) => {
      const { data } = await supabase
        .from('form_events')
        .select('event_id')
        .eq('environment', 'production')
        .in('status', ['pending', 'failed'])
        .lt('attempts', MAX_ATTEMPTS)
        .order('occurred_at', { ascending: true })
        .limit(limit)
      return (data ?? []).map((r) => r.event_id as string)
    },
  )

  const outcomes: Record<string, number> = {}
  for (const id of ids) {
    const { outcome } = await deliverEvent(id)
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
  }
  return { processed: ids.length, outcomes }
}
