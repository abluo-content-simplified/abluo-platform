'use server'

/**
 * Admin Support Tickets actions (ADR-039). Each one calls `requireAbluoAdmin()`
 * (abluo_admin + two-factor) first, then the service. Failures come back as a
 * stable reason the screen words; nothing is thrown at the browser.
 */
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { DEFAULT_SUPPORT_ROLE } from '@/lib/support/constants'
import { startSupportVisit } from '@/lib/support/server'
import {
  addNote,
  deleteAttachment,
  recordSupportVisitFromTicket,
  redactMessage,
  replyAsSupport,
  setTicketSeverity,
  setTicketStatus,
  ticketProject,
} from '@/lib/support-tickets/service'
import type { TicketFailure, TicketResult, TicketSeverity, TicketStatus } from '@/lib/support-tickets/model'

export type TicketActionResult = { ok: true } | { ok: false; reason: TicketFailure }

async function actorId(): Promise<string | null> {
  const actor = await requireAbluoAdmin()
  return actor ? actor.userId : null
}

function refresh(result: TicketResult, ticketId?: string): TicketActionResult {
  if (!result.ok) return { ok: false, reason: result.reason }
  revalidatePath('/[locale]/support', 'page')
  if (ticketId) revalidatePath('/[locale]/support/[ticketId]', 'page')
  return { ok: true }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export async function replyAsSupportAction(ticketId: unknown, body: unknown): Promise<TicketActionResult> {
  const id = await actorId()
  if (!id) return { ok: false, reason: 'forbidden' }
  return refresh(await replyAsSupport(id, str(ticketId), str(body)), str(ticketId))
}

export async function addNoteAction(ticketId: unknown, body: unknown): Promise<TicketActionResult> {
  const id = await actorId()
  if (!id) return { ok: false, reason: 'forbidden' }
  return refresh(await addNote(id, str(ticketId), str(body)), str(ticketId))
}

export async function setTicketStatusAction(ticketId: unknown, status: unknown): Promise<TicketActionResult> {
  const id = await actorId()
  if (!id) return { ok: false, reason: 'forbidden' }
  return refresh(await setTicketStatus(id, str(ticketId), str(status) as TicketStatus), str(ticketId))
}

export async function setTicketSeverityAction(ticketId: unknown, severity: unknown): Promise<TicketActionResult> {
  const id = await actorId()
  if (!id) return { ok: false, reason: 'forbidden' }
  return refresh(await setTicketSeverity(id, str(ticketId), str(severity) as TicketSeverity), str(ticketId))
}

export async function redactMessageAction(ticketId: unknown, messageId: unknown): Promise<TicketActionResult> {
  const id = await actorId()
  if (!id) return { ok: false, reason: 'forbidden' }
  return refresh(await redactMessage(id, str(messageId)), str(ticketId))
}

export async function deleteAttachmentAction(ticketId: unknown, attachmentId: unknown): Promise<TicketActionResult> {
  const id = await actorId()
  if (!id) return { ok: false, reason: 'forbidden' }
  return refresh(await deleteAttachment(id, str(attachmentId)), str(ticketId))
}

/**
 * "View as Client" from a ticket (D16): the same support-mode start flow as the
 * admin project page, then the visit is logged on the ticket. Failures land back
 * on the ticket with `?support=unavailable|failed` (same wording as the project page).
 */
export async function viewAsClientAction(formData: FormData): Promise<void> {
  const id = await actorId()
  if (!id) redirect('/unauthorized')
  const locale = await getLocale()
  const ticketId = str(formData.get('ticketId'))
  const back = (code: string) => redirect(`/${locale}/support/${encodeURIComponent(ticketId)}?support=${code}`)

  const project = await ticketProject(ticketId)
  if (!project) back('failed')
  else {
    const result = await startSupportVisit({ userId: id }, project.id, DEFAULT_SUPPORT_ROLE)
    if (!result.ok) back(result.error === 'unavailable' ? 'unavailable' : 'failed')
    else {
      await recordSupportVisitFromTicket(id, ticketId)
      redirect(`/${locale}/${encodeURIComponent(result.project.slug)}/home`)
    }
  }
}
