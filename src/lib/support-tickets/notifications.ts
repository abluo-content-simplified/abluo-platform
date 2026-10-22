// Server-only.
/**
 * Ticket email delivery — ADR-039 D13, ADR-019 mechanics (claim/finalize
 * idempotency, production-only, MAX_ATTEMPTS) on `support_ticket_outbox`.
 * Emails carry the reference, project name and a link — never the title,
 * description, replies or screenshots.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { isProductionEnvironment } from '@/lib/notifications/environment'
import { sendEmail } from '@/lib/notifications/resend'
import { formatTicketNumber } from './model'
import { chooseAdminEmails, chooseEmailLocale, recipientKindFor, renderTicketEmail, ticketUrl, type TicketEventType } from './email'

export const MAX_ATTEMPTS = 5
const SWEEP_BATCH = 10

export type TicketDeliverOutcome = 'delivered' | 'failed' | 'dead' | 'skipped' | 'noop'

async function finalize(db: SupabaseClient, eventId: string, status: Exclude<TicketDeliverOutcome, 'noop'>, attempts: number, lastError: string | null) {
  await db
    .from('support_ticket_outbox')
    .update({ status, attempts, last_error: lastError, delivered_at: status === 'delivered' ? new Date().toISOString() : null })
    .eq('event_id', eventId)
}

/** Retryable failure: failed until MAX_ATTEMPTS, then dead. */
async function retryOrDie(db: SupabaseClient, eventId: string, attempts: number, message: string) {
  const next = attempts + 1
  const status = next >= MAX_ATTEMPTS ? 'dead' : 'failed'
  await finalize(db, eventId, status, next, message.slice(0, 500))
  return { outcome: status as 'dead' | 'failed', reason: message }
}

async function adminEmails(db: SupabaseClient): Promise<string[]> {
  const envList = process.env.SUPPORT_NOTIFY_EMAILS
  const fromEnv = chooseAdminEmails(envList, [])
  if (fromEnv.length > 0) return fromEnv
  const users: Array<{ email?: string | null; app_metadata?: Record<string, unknown> | null }> = []
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw new Error(`listUsers failed: ${error.message}`)
    users.push(...data.users)
    if (data.users.length < 200) break
  }
  return chooseAdminEmails(undefined, users)
}

/** Delivers one outbox event, idempotently. Safe to call from request and sweep. */
export async function deliverTicketEvent(eventId: string): Promise<{ outcome: TicketDeliverOutcome; reason?: string }> {
  return runAsTrustedSystemOperation(
    'Support ticket notification delivery (ADR-039 D13) — claim a support_ticket_outbox row and send the ticket email.',
    async (db): Promise<{ outcome: TicketDeliverOutcome; reason?: string }> => {
      const { data: claimed } = await db
        .from('support_ticket_outbox')
        .update({ status: 'delivering' })
        .eq('event_id', eventId)
        .in('status', ['pending', 'failed'])
        .select('*')
      const event = claimed?.[0] as { ticket_id: string; event_type: TicketEventType; environment: string | null; attempts: number | null } | undefined
      if (!event) return { outcome: 'noop', reason: 'not claimable (already processed/missing)' }
      const attempts = event.attempts ?? 0

      if (!isProductionEnvironment(event.environment)) {
        await finalize(db, eventId, 'skipped', attempts, `non-production (environment=${event.environment ?? 'null'})`)
        return { outcome: 'skipped', reason: 'non-production' }
      }

      try {
        const { data: ticket } = await db.from('support_tickets').select('id, number, project_id, created_by, context').eq('id', event.ticket_id).maybeSingle()
        if (!ticket) {
          await finalize(db, eventId, 'skipped', attempts, 'ticket no longer exists')
          return { outcome: 'skipped', reason: 'ticket gone' }
        }
        const { data: project } = await db.from('projects').select('slug, name, default_locale').eq('id', ticket.project_id as string).maybeSingle()
        if (!project) {
          await finalize(db, eventId, 'skipped', attempts, 'project no longer exists')
          return { outcome: 'skipped', reason: 'project gone' }
        }

        const kind = recipientKindFor(event.event_type)
        let recipients: string[]
        if (kind === 'admins') {
          recipients = await adminEmails(db)
          if (recipients.length === 0) return await retryOrDie(db, eventId, attempts, 'no admin recipients (set SUPPORT_NOTIFY_EMAILS or give a user platform_role abluo_admin)')
        } else {
          const creatorId = ticket.created_by as string | null
          let email: string | null = null
          if (creatorId) {
            const { data: u } = await db.auth.admin.getUserById(creatorId)
            email = u?.user?.email ?? null
          }
          if (!email) {
            await finalize(db, eventId, 'delivered', attempts, 'no recipient: the ticket creator no longer exists or has no email')
            return { outcome: 'delivered', reason: 'no recipient' }
          }
          recipients = [email]
        }

        const locale = chooseEmailLocale({
          interfaceLocale: (ticket.context as Record<string, unknown> | null)?.interfaceLocale,
          projectDefaultLocale: project.default_locale,
        })
        const mail = renderTicketEmail({
          eventType: event.event_type,
          locale,
          reference: formatTicketNumber(ticket.number as number),
          projectName: project.name as string,
          url: ticketUrl(kind, ticket.id as string, project.slug as string),
        })

        const results = await Promise.all(recipients.map((to) => sendEmail({ to: [to], subject: mail.subject, html: mail.html, text: mail.text }).then((res) => ({ to, res }))))
        const failures = results.filter((r) => !r.res.ok)
        if (failures.length === 0) {
          await finalize(db, eventId, 'delivered', attempts, null)
          return { outcome: 'delivered' }
        }
        return await retryOrDie(db, eventId, attempts, failures.map((f) => `${f.to}: ${f.res.error}`).join('; '))
      } catch (err) {
        return await retryOrDie(db, eventId, attempts, err instanceof Error ? err.message : String(err))
      }
    },
  )
}

/** Re-drives production rows left pending/failed, oldest first. */
export async function sweepTicketOutbox(limit: number = SWEEP_BATCH): Promise<{ processed: number; outcomes: Record<string, number> }> {
  const ids = await runAsTrustedSystemOperation(
    'Support ticket notification sweep (ADR-039 D13) — list production outbox rows still pending/failed.',
    async (db) => {
      const { data } = await db
        .from('support_ticket_outbox')
        .select('event_id')
        .eq('environment', 'production')
        .in('status', ['pending', 'failed'])
        .lt('attempts', MAX_ATTEMPTS)
        .order('created_at', { ascending: true })
        .limit(limit)
      return (data ?? []).map((r) => r.event_id as string)
    },
  )
  const outcomes: Record<string, number> = {}
  for (const id of ids) {
    const { outcome } = await deliverTicketEvent(id)
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1
  }
  return { processed: ids.length, outcomes }
}
