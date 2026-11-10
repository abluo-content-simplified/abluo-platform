// Server-only.
/**
 * Support tickets → the Notification Center bell (ADR-050 D9). The ticket
 * emails (ADR-039 D13) stay as they are; this only adds a bell row. Rows carry
 * the ticket number and the site name — never the title or the text (a title
 * can contain a patient's name). Never throws.
 */
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { abluoTeamIds, notify } from '@/lib/notification-center/service'
import type { NotificationInput, NotificationKind } from '@/lib/notification-center/model'
import { formatTicketNumber } from './model'

type TicketBellKind = Extract<NotificationKind, `ticket.${string}`>

export async function ringTicketBell(kind: TicketBellKind, ticketId: string): Promise<void> {
  try {
    const ticket = await runAsTrustedSystemOperation('notification center: read a ticket’s number, project and creator for its bell row', async (db) => {
      const { data } = await db.from('support_tickets').select('id, number, project_id, created_by').eq('id', ticketId).maybeSingle()
      const t = data as { id: string; number: number; project_id: string; created_by: string | null } | null
      if (!t) return null
      const { data: p } = await db.from('projects').select('slug, name').eq('id', t.project_id).maybeSingle()
      const project = p as { slug: string; name: string | null } | null
      return { ...t, slug: project?.slug ?? '', projectName: (project?.name ?? '').trim() || project?.slug || '' }
    })
    if (!ticket) return
    const params = { reference: formatTicketNumber(ticket.number), project: ticket.projectName }
    const toTeam = kind === 'ticket.created' || kind === 'ticket.client_replied'
    const inputs: NotificationInput[] = toTeam
      ? (await abluoTeamIds()).map((userId) => ({ userId, side: 'abluo' as const, projectId: ticket.project_id, kind, sourceType: 'ticket' as const, sourceId: ticket.id, href: `/support/${ticket.id}`, params }))
      : ticket.created_by && ticket.slug
        ? [{ userId: ticket.created_by, side: 'client' as const, projectId: ticket.project_id, kind, sourceType: 'ticket' as const, sourceId: ticket.id, href: `/${ticket.slug}/support/${ticket.id}`, params }]
        : []
    await notify(inputs)
  } catch (e) {
    console.error('[support-tickets] bell failed', e instanceof Error ? e.message : e)
  }
}
