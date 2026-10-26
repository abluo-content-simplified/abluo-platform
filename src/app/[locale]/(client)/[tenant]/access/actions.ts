'use server'

/**
 * Client dashboard — Access actions (ADR-040 B2.5).
 *
 * Every action re-resolves the caller server-side (resolveProjectAction: the
 * URL's projectSlug only picks one of the caller's own grants; support-mode
 * write stripping applies), then `authorizeAccessManagement` checks that the
 * Access module is installed for THAT project and that the caller holds
 * `members.access.manage` there. The grant it returns is bound to the one
 * project, so an id from another project is simply not found.
 *
 * Abluo support never manages passwords or groups, even with live-edit
 * approval: `members.access.manage` is in SUPPORT_NEVER_WRITES, and a support
 * visit is refused here before anything else (`support_mode`).
 *
 * Failures collapse to opaque codes the screen translates. Passwords are
 * never returned, logged or echoed.
 */
import { resolveProjectAction } from '@/lib/api/project-action'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import {
  authorizeAccessManagement,
  beginDocumentUpload,
  createDocument,
  createGroupWithPassword,
  finishDocumentUpload,
  renameDocument,
  renameGroup,
  revokeAllVisitorSessions,
  setDocumentArchived,
  setDocumentGroups,
  setGroupArchived,
  setGroupPassword,
  listGroups,
  listDocuments,
  type AccessManagementGrant,
  type FinishResult,
  type UploadTicket,
} from '@/lib/access/management'
import { setPageAccess } from '@/lib/access/page-visibility'
import { toAccessActionError, type AccessActionResult } from '@/lib/access/action-errors'
import { tenantScopedSanityClient } from '@/lib/api/tenant-scoped-sanity'
import { withSiteAccessStore } from '@/lib/access/server'
import { AccessError } from '@/lib/access/model'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import type { SiteAccessFiles } from '@/lib/access/file-storage'
import type { SiteAccessStore } from '@/lib/access/store'

type Ctx = { grant: AccessManagementGrant; projectSlug: string; store: SiteAccessStore; files: SiteAccessFiles; defaultLocale: string }

async function run<T extends object>(input: { projectSlug?: unknown }, reason: string, fn: (c: Ctx) => Promise<T>): Promise<AccessActionResult<T>> {
  const access = await resolveProjectAction(input?.projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  if (access.ctx.support) return { ok: false, error: 'support_mode' }
  try {
    const grant = authorizeAccessManagement(access.ctx, access.grant.projectId, 'manage')
    const defaultLocale = await siteDefaultLocale(access.ctx, access.grant.projectId)
    return { ok: true, ...(await withSiteAccessStore(`dashboard Access: ${reason}`, (store, files) => fn({ grant, projectSlug: access.grant.projectSlug, store, files, defaultLocale }))) }
  } catch (error) {
    return { ok: false, error: toAccessActionError(error) }
  }
}

/** Group names and document titles are stored in the site's default language. */
async function siteDefaultLocale(ctx: TenantAuthorizationContext, projectId: string): Promise<string> {
  const c = await tenantScopedSanityClient(ctx, projectId).fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`
  )
  return c?.defaultLocale || c?.supportedLocales?.[0] || 'en'
}

const text = (v: unknown) => (typeof v === 'string' ? v : '')

// ── Groups ────────────────────────────────────────────────────────────────────

export async function createAccessGroupAction(input: { projectSlug: string; name: string; password: string }) {
  return run(input, 'create group', ({ store, grant, defaultLocale }) =>
    createGroupWithPassword(store, grant, { name: { [defaultLocale]: text(input.name) }, password: input.password }))
}

export async function renameAccessGroupAction(input: { projectSlug: string; groupId: string; name: string }) {
  return run(input, 'rename group', async ({ store, grant, defaultLocale }) => {
    const current = (await listGroups(store, grant)).find((g) => g.id === input.groupId)
    if (!current) throw new AccessError('not_found')
    await renameGroup(store, grant, input.groupId, { ...current.name, [defaultLocale]: text(input.name) })
    return {}
  })
}

/** Changes (credentialId) or sets (no credentialId) a group's password. Returns how many visitors were signed out. */
export async function setAccessGroupPasswordAction(input: { projectSlug: string; groupId: string; credentialId?: string | null; password: string }) {
  return run(input, 'set group password', ({ store, grant }) =>
    setGroupPassword(store, grant, { groupId: input.groupId, credentialId: input.credentialId ?? null, password: input.password }))
}

export async function setAccessGroupArchivedAction(input: { projectSlug: string; groupId: string; archived: boolean }) {
  return run(input, input.archived ? 'archive group' : 'restore group', async ({ store, grant }) => {
    await setGroupArchived(store, grant, input.groupId, input.archived === true)
    return {}
  })
}

export async function signOutEveryoneAction(input: { projectSlug: string }) {
  return run(input, 'sign out everyone', async ({ store, grant }) => ({ signedOut: await revokeAllVisitorSessions(store, grant) }))
}

// ── Documents ─────────────────────────────────────────────────────────────────

export async function createAccessDocumentAction(input: { projectSlug: string; title: string; groupIds: string[] }) {
  return run(input, 'create document', async ({ store, grant, defaultLocale }) => ({
    documentId: await createDocument(store, grant, { title: { [defaultLocale]: text(input.title) }, groupIds: input.groupIds }),
  }))
}

export async function renameAccessDocumentAction(input: { projectSlug: string; documentId: string; title: string }) {
  return run(input, 'rename document', async ({ store, grant, defaultLocale }) => {
    const current = (await listDocuments(store, grant)).find((d) => d.id === input.documentId)
    if (!current) throw new AccessError('not_found')
    await renameDocument(store, grant, input.documentId, { ...current.title, [defaultLocale]: text(input.title) })
    return {}
  })
}

export async function setAccessDocumentGroupsAction(input: { projectSlug: string; documentId: string; groupIds: string[] }) {
  return run(input, 'set document groups', async ({ store, grant }) => {
    await setDocumentGroups(store, grant, input.documentId, input.groupIds)
    return {}
  })
}

export async function setAccessDocumentArchivedAction(input: { projectSlug: string; documentId: string; archived: boolean }) {
  return run(input, input.archived ? 'archive document' : 'restore document', async ({ store, grant }) => {
    await setDocumentArchived(store, grant, input.documentId, input.archived === true)
    return {}
  })
}

/** Reserves an upload and returns a one-time signed URL for the browser to PUT the PDF to (never the bucket path). */
export async function beginAccessUploadAction(input: { projectSlug: string; documentId: string; locale: string; sizeBytes: number; sha256: string; filename: string }) {
  return run(input, 'begin upload', async ({ store, files, grant }): Promise<{ ticket: UploadTicket }> => ({
    ticket: await beginDocumentUpload(store, files, grant, input),
  }))
}

/** The server re-reads the stored object and checks it before the document points at it. */
export async function finishAccessUploadAction(input: { projectSlug: string; uploadId: string }) {
  return run(input, 'finish upload', async ({ store, files, grant }): Promise<{ result: FinishResult }> => ({
    result: await finishDocumentUpload(store, files, grant, input.uploadId),
  }))
}

// ── Pages ─────────────────────────────────────────────────────────────────────

export async function setPageAccessAction(input: {
  projectSlug: string
  pageId: string
  visibility: 'public' | 'restricted'
  groupIds: string[]
  navigation: 'hidden' | 'locked'
  rev: string
  draftRev: string | null
}) {
  return run(input, 'set page access', async ({ store, grant, projectSlug }) => {
    await setPageAccess(store, grant, projectSlug, input, { client: sanityWriteClient })
    return {}
  })
}
