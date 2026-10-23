'use server'

/**
 * Support tickets — the client's two writes (ADR-039): send a request, reply.
 * Each call re-resolves the person from the session and the project from the
 * slug (never from the form), builds the TicketAccess and hands over to the
 * service, which enforces D3 again. Returns stable failure reasons; the screen
 * words them. Never throws to the browser.
 */
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { ticketAccess } from '@/lib/support-tickets/access'
import { clientTicketActivity, countClientUnread, createTicket, deleteOwnAttachment, replyAsClient, type NewTicketFile } from '@/lib/support-tickets/service'
import type { TicketFailure, TicketInputError } from '@/lib/support-tickets/model'

export type TicketActionResult<T = undefined> = { ok: true; value: T } | { ok: false; reason: TicketFailure; field?: TicketInputError }

const FAIL: TicketActionResult<never> = { ok: false, reason: 'error' }

async function accessFor(projectSlug: unknown) {
  if (typeof projectSlug !== 'string' || !projectSlug) return null
  const ctx = await getTenantAuthorizationContext({ project: projectSlug })
  return ticketAccess(ctx, projectSlug)
}

const text = (form: FormData, key: string) => {
  const v = form.get(key)
  return typeof v === 'string' ? v : ''
}

export async function createTicketAction(projectSlug: string, form: FormData): Promise<TicketActionResult<{ id: string; reference: string }>> {
  try {
    const access = await accessFor(projectSlug)
    if (!access) return { ok: false, reason: 'forbidden' }
    const files: NewTicketFile[] = []
    for (const entry of form.getAll('files')) {
      if (typeof entry === 'string' || entry.size === 0) continue
      files.push({ name: entry.name, type: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) })
    }
    const result = await createTicket(access, {
      title: text(form, 'title'),
      body: text(form, 'body'),
      files,
      submitToken: text(form, 'submitToken') || null,
      from: text(form, 'from') || undefined,
      userAgent: text(form, 'userAgent') || undefined,
      viewport: text(form, 'viewport') || undefined,
      interfaceLocale: text(form, 'interfaceLocale') || undefined,
      relatedTo: text(form, 'relatedTo') || undefined,
    })
    if (!result.ok) return { ok: false, reason: result.reason, field: result.field }
    return { ok: true, value: { id: result.value.id, reference: result.value.reference } }
  } catch (e) {
    console.error('[support-tickets] create failed', e instanceof Error ? e.message : e)
    return FAIL
  }
}

export async function replyToTicketAction(projectSlug: string, ticketId: string, form: FormData): Promise<TicketActionResult> {
  try {
    const access = await accessFor(projectSlug)
    if (!access) return { ok: false, reason: 'forbidden' }
    const files: NewTicketFile[] = []
    for (const entry of form.getAll('files')) {
      if (typeof entry === 'string' || entry.size === 0) continue
      files.push({ name: entry.name, type: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) })
    }
    const result = await replyAsClient(access, ticketId, text(form, 'body'), files)
    return result.ok ? { ok: true, value: undefined } : { ok: false, reason: result.reason, field: result.field }
  } catch (e) {
    console.error('[support-tickets] reply failed', e instanceof Error ? e.message : e)
    return FAIL
  }
}

/** Delete a screenshot the person uploaded themselves (round 3). Access is re-resolved from the session. */
export async function deleteOwnScreenshotAction(projectSlug: string, attachmentId: string): Promise<TicketActionResult> {
  try {
    const access = await accessFor(projectSlug)
    if (!access) return { ok: false, reason: 'forbidden' }
    if (typeof attachmentId !== 'string' || !attachmentId) return { ok: false, reason: 'notFound' }
    const result = await deleteOwnAttachment(access, attachmentId)
    return result.ok ? { ok: true, value: undefined } : { ok: false, reason: result.reason, field: result.field }
  } catch (e) {
    console.error('[support-tickets] delete own screenshot failed', e instanceof Error ? e.message : e)
    return FAIL
  }
}

/** Live sidebar number: requests waiting for the person's reply plus unread replies from Abluo Support. Fail-safe 0. */
export async function clientSupportCountAction(projectSlug: string): Promise<number> {
  try {
    const access = await accessFor(projectSlug)
    return access ? await countClientUnread(access) : 0
  } catch {
    return 0
  }
}

/** Last public activity of one request (screens poll it to refresh themselves). Access is re-resolved from the session. */
export async function clientTicketActivityAction(projectSlug: string, ticketId: string): Promise<string | null> {
  try {
    const access = await accessFor(projectSlug)
    if (!access || typeof ticketId !== 'string') return null
    return await clientTicketActivity(access, ticketId)
  } catch {
    return null
  }
}
