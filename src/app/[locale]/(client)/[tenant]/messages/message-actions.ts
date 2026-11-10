'use server'

/**
 * Messages — the client's writes (ADR-050): reply, delete a file they added.
 * Each call re-resolves the person from the session and the project from the
 * slug; the service checks participation again. Stable failure reasons; the
 * screen words them. Never throws to the browser.
 */
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { messageAccess } from '@/lib/messages/access'
import { clientConversationActivity, clientMessagesNav, deleteOwnMessageFile, replyAsClient } from '@/lib/messages/service'
import type { IncomingFile } from '@/lib/messages/files'
import type { MessageFailure, MessageInputError } from '@/lib/messages/model'

export type MessageActionResult = { ok: true } | { ok: false; reason: MessageFailure; field?: MessageInputError }

async function accessFor(projectSlug: unknown) {
  if (typeof projectSlug !== 'string' || !projectSlug) return null
  return messageAccess(await getTenantAuthorizationContext({ project: projectSlug }), projectSlug)
}

export async function replyToConversationAction(projectSlug: string, conversationId: string, form: FormData): Promise<MessageActionResult> {
  try {
    const access = await accessFor(projectSlug)
    if (!access) return { ok: false, reason: 'forbidden' }
    const files: IncomingFile[] = []
    for (const entry of form.getAll('files')) {
      if (typeof entry === 'string' || entry.size === 0) continue
      files.push({ name: entry.name, type: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) })
    }
    const body = form.get('body')
    const result = await replyAsClient(access, conversationId, typeof body === 'string' ? body : '', files)
    return result.ok ? { ok: true } : { ok: false, reason: result.reason, field: result.field }
  } catch (e) {
    console.error('[messages] client reply failed', e instanceof Error ? e.message : e)
    return { ok: false, reason: 'error' }
  }
}

export async function deleteOwnMessageFileAction(projectSlug: string, attachmentId: string): Promise<MessageActionResult> {
  try {
    const access = await accessFor(projectSlug)
    if (!access) return { ok: false, reason: 'forbidden' }
    const result = await deleteOwnMessageFile(access, typeof attachmentId === 'string' ? attachmentId : '')
    return result.ok ? { ok: true } : { ok: false, reason: result.reason }
  } catch {
    return { ok: false, reason: 'error' }
  }
}

/** Last activity of one conversation (the open page polls it). */
export async function clientConversationActivityAction(projectSlug: string, conversationId: string): Promise<string | null> {
  try {
    const access = await accessFor(projectSlug)
    return access && typeof conversationId === 'string' ? await clientConversationActivity(access, conversationId) : null
  } catch {
    return null
  }
}

/** The live Messages nav number; null = no conversations (no entry). */
export async function clientMessagesNavAction(projectSlug: string): Promise<{ unread: number } | null> {
  try {
    const access = await accessFor(projectSlug)
    return access && !access.supportMode ? await clientMessagesNav(access) : null
  } catch {
    return null
  }
}
