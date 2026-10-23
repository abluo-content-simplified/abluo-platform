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
  adminTicketActivity,
  countAdminUnread,
  deleteAttachment,
  recordSupportVisitFromTicket,
  redactMessage,
  redactMessageParts,
  replyAsSupport,
  setTicketSeverity,
  setTicketStatus,
  ticketProject,
  type NewTicketFile,
} from '@/lib/support-tickets/service'
import type { RedactionRange } from '@/lib/support-tickets/redaction'
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

/** The reply form: `ticketId`, `body` and up to 3 `files` (already shrunk by the browser). */
export async function replyAsSupportAction(form: FormData): Promise<TicketActionResult> {
  try {
    const id = await actorId()
    if (!id) return { ok: false, reason: 'forbidden' }
    const files: NewTicketFile[] = []
    for (const entry of form.getAll('files')) {
      if (typeof entry === 'string' || entry.size === 0) continue
      files.push({ name: entry.name, type: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) })
    }
    const ticketId = str(form.get('ticketId'))
    return refresh(await replyAsSupport(id, ticketId, str(form.get('body')), files), ticketId)
  } catch (e) {
    console.error('[support-tickets] admin reply failed', e instanceof Error ? e.message : e)
    return { ok: false, reason: 'error' }
  }
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

/** Hides chosen parts of a message for good. `ranges` are [start, end) offsets in the current text. */
export async function redactMessagePartsAction(ticketId: unknown, messageId: unknown, ranges: unknown): Promise<TicketActionResult> {
  const id = await actorId()
  if (!id) return { ok: false, reason: 'forbidden' }
  if (!Array.isArray(ranges) || ranges.length > 500) return { ok: false, reason: 'invalid' }
  const clean: RedactionRange[] = []
  for (const r of ranges) {
    const start = (r as RedactionRange | null)?.start
    const end = (r as RedactionRange | null)?.end
    if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, reason: 'invalid' }
    clean.push({ start, end })
  }
  const result = await redactMessageParts(id, str(messageId), clean)
  return refresh(result.ok ? { ok: true, value: undefined } : result, str(ticketId))
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

/** Live updates: the ticket's last-activity time (the open page polls it). null = unknown / not allowed. */
export async function adminTicketActivityAction(ticketId: unknown): Promise<string | null> {
  const id = await actorId()
  if (!id) return null
  return adminTicketActivity(str(ticketId))
}

/** Live updates: the number on the admin sidebar's Support entry. */
export async function adminUnreadCountAction(): Promise<number> {
  const id = await actorId()
  if (!id) return 0
  return countAdminUnread(id).catch(() => 0)
}
