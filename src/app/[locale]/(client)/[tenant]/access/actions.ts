'use server'

/**
 * Client dashboard — Access actions (ADR-040 B2.5; R9 §15: groups, passwords
 * and sign-outs only — documents moved to Documents, page protection to Studio).
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
import {
  authorizeAccessManagement,
  createGroupWithPassword,
  renameGroup,
  revokeAllVisitorSessions,
  setGroupArchived,
  setGroupPassword,
  listGroups,
  type AccessManagementGrant,
} from '@/lib/access/management'
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

/** Group names are stored in the site's default language. */
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
