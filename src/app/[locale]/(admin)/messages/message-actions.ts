'use server'

/**
 * Admin Messages actions (ADR-050). Each one calls `requireAbluoAdmin()`
 * (abluo_admin + two-factor) first, then the service. The Abluo side is a
 * team inbox (D1): any admin may write, reply and archive. Failures come back
 * as a stable reason; nothing is thrown at the browser.
 */
import { revalidatePath } from 'next/cache'
import { requireAbluoAdmin } from '@/lib/api/auth'
import { listAdminUsers } from '@/lib/api/admin-dashboard/users'
import { allowedPairs, buildMessageDirectory } from '@/lib/messages/directory'
import type { IncomingFile } from '@/lib/messages/files'
import { cleanLibraryPicks, fetchLibraryImages } from '@/lib/messages/library'
import { listSitePages, type SitePageOption } from '@/lib/messages/site-pages'
import { cleanIds, type MessageFailure, type MessageInputError, type Recipient } from '@/lib/messages/model'
import type { RedactionRange } from '@/lib/support-tickets/redaction'
import {
  adminConversationActivity,
  countAdminUnreadMessages,
  deleteConversations,
  deleteMessageFile,
  projectSiteRef,
  redactMessageParts,
  purgeConversations,
  replyAsAbluo,
  restoreConversations,
  sendNewMessage,
  setConversationArchived,
  setConversationsArchived,
} from '@/lib/messages/service'

export type AdminMessageResult<T = undefined> = { ok: true; value: T } | { ok: false; reason: MessageFailure; field?: MessageInputError }

async function actorId(): Promise<string | null> {
  const actor = await requireAbluoAdmin()
  return actor ? actor.userId : null
}

async function filesOf(form: FormData): Promise<IncomingFile[]> {
  const files: IncomingFile[] = []
  for (const entry of form.getAll('files')) {
    if (typeof entry === 'string' || entry.size === 0) continue
    files.push({ name: entry.name, type: entry.type, bytes: new Uint8Array(await entry.arrayBuffer()) })
  }
  return files
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** Uploads plus Media Library pictures (`library`: JSON [{url,name}]); null when a library picture cannot be fetched. */
async function allFilesOf(form: FormData): Promise<IncomingFile[] | null> {
  let picks: unknown = []
  try {
    picks = JSON.parse(str(form.get('library')) || '[]')
  } catch {
    picks = []
  }
  const library = await fetchLibraryImages(cleanLibraryPicks(picks))
  if (!library) return null
  return [...(await filesOf(form)), ...library]
}

/** The recipient site's language and published pages, for the link and Media Library choosers. */
export async function recipientSiteAction(projectId: unknown): Promise<{ slug: string; defaultLocale: string; pages: SitePageOption[] } | null> {
  try {
    if (!(await actorId())) return null
    const site = await projectSiteRef(str(projectId))
    if (!site) return null
    return { slug: site.slug, defaultLocale: site.defaultLocale, pages: await listSitePages(site.slug, site.defaultLocale) }
  } catch (e) {
    console.error('[messages] recipient site failed', e instanceof Error ? e.message : e)
    return null
  }
}

function refresh(id?: string) {
  revalidatePath('/[locale]/messages', 'page')
  if (id) revalidatePath('/[locale]/messages/[conversationId]', 'page')
}

/** New Message: `mode`, `recipients` (JSON [{projectId,userId}]), `subject`, `body`, `links` (JSON: dashboard ids or {page,label}), `files`, `library` (JSON [{url,name}]). */
export async function sendNewMessageAction(form: FormData): Promise<AdminMessageResult<{ ids: string[] }>> {
  try {
    const id = await actorId()
    if (!id) return { ok: false, reason: 'forbidden' }
    let recipients: Recipient[] = []
    let links: unknown = []
    try {
      const raw = JSON.parse(str(form.get('recipients')) || '[]') as unknown
      recipients = Array.isArray(raw) ? raw.flatMap((r) => (r && typeof r === 'object' ? [{ projectId: str((r as Recipient).projectId), userId: str((r as Recipient).userId) }] : [])) : []
      links = JSON.parse(str(form.get('links')) || '[]')
    } catch {
      return { ok: false, reason: 'invalid' }
    }
    const directory = await listAdminUsers()
    if (directory.error) return { ok: false, reason: 'error' }
    const allowed = allowedPairs(buildMessageDirectory(directory.people, directory.projects))
    const files = await allFilesOf(form)
    if (!files) return { ok: false, reason: 'libraryUnavailable' }
    const result = await sendNewMessage(id, { mode: str(form.get('mode')), recipients, subject: str(form.get('subject')), body: str(form.get('body')), links, files }, allowed)
    if (result.ok) refresh()
    return result
  } catch (e) {
    console.error('[messages] send failed', e instanceof Error ? e.message : e)
    return { ok: false, reason: 'error' }
  }
}

export async function replyAsAbluoAction(form: FormData): Promise<AdminMessageResult> {
  try {
    const id = await actorId()
    if (!id) return { ok: false, reason: 'forbidden' }
    const conversationId = str(form.get('conversationId'))
    let links: unknown = []
    try {
      links = JSON.parse(str(form.get('links')) || '[]')
    } catch {
      links = []
    }
    const files = await allFilesOf(form)
    if (!files) return { ok: false, reason: 'libraryUnavailable' }
    const result = await replyAsAbluo(id, conversationId, str(form.get('body')), files, links)
    if (result.ok) refresh(conversationId)
    return result
  } catch (e) {
    console.error('[messages] admin reply failed', e instanceof Error ? e.message : e)
    return { ok: false, reason: 'error' }
  }
}

export async function setArchivedAction(conversationId: unknown, archived: unknown): Promise<AdminMessageResult> {
  const id = await actorId()
  if (!id) return { ok: false, reason: 'forbidden' }
  const result = await setConversationArchived(id, str(conversationId), archived === true)
  if (result.ok) refresh(str(conversationId))
  return result
}

export async function redactMessagePartsAction(messageId: unknown, ranges: unknown): Promise<AdminMessageResult<{ removed: number }>> {
  const id = await actorId()
  if (!id) return { ok: false, reason: 'forbidden' }
  const clean: RedactionRange[] = Array.isArray(ranges)
    ? ranges.flatMap((r) => (r && typeof r === 'object' && Number.isInteger((r as RedactionRange).start) && Number.isInteger((r as RedactionRange).end) ? [{ start: (r as RedactionRange).start, end: (r as RedactionRange).end }] : []))
    : []
  const result = await redactMessageParts(id, str(messageId), clean)
  if (result.ok) refresh()
  return result
}

export async function deleteMessageFileAction(attachmentId: unknown): Promise<AdminMessageResult> {
  const id = await actorId()
  if (!id) return { ok: false, reason: 'forbidden' }
  const result = await deleteMessageFile(id, str(attachmentId))
  if (result.ok) refresh()
  return result
}

export async function adminConversationActivityAction(conversationId: string): Promise<string | null> {
  const id = await actorId()
  return id ? adminConversationActivity(str(conversationId)) : null
}

export async function adminMessagesUnreadAction(): Promise<number> {
  try {
    const id = await actorId()
    return id ? await countAdminUnreadMessages(id) : 0
  } catch {
    return 0
  }
}

/** Bulk on the Messages list (Tom 2026-11-11): what to do with the selected conversations. */
export type BulkConversationOp = 'archive' | 'unarchive' | 'delete' | 'restore' | 'purge'

export async function bulkConversationsAction(ids: unknown, op: unknown): Promise<AdminMessageResult<{ changed: number }>> {
  try {
    const id = await actorId()
    if (!id) return { ok: false, reason: 'forbidden' }
    const list = cleanIds(ids)
    if (!list.length) return { ok: false, reason: 'invalid' }
    const result =
      op === 'archive' || op === 'unarchive'
        ? await setConversationsArchived(id, list, op === 'archive')
        : op === 'delete'
          ? await deleteConversations(id, list)
          : op === 'restore'
            ? await restoreConversations(id, list)
            : op === 'purge'
              ? await purgeConversations(list)
              : ({ ok: false, reason: 'invalid' } as const)
    if (result.ok) refresh()
    return result
  } catch (e) {
    console.error('[messages] bulk action failed', e instanceof Error ? e.message : e)
    return { ok: false, reason: 'error' }
  }
}
