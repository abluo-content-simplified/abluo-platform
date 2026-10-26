/**
 * Site Access — what the tenant dashboard's Access screen shows (ADR-040 B2.5,
 * trimmed in R9 §15). Server-only. Groups with their passwords (never a hash),
 * how many visitors are signed in, and what each group opens (protected pages,
 * set in Studio; group documents, from the Documents module). Page protection
 * and documents are no longer edited here.
 *
 * Everything is read with the caller's `members.access.read` grant on ONE
 * project; pages through the tenant-scoped Sanity client. When the Supabase
 * tables are not installed the screen gets `notReady` instead of an error; a
 * missing summary (053) only hides the signed-in counts.
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { tenantScopedSanityClient } from '@/lib/api/tenant-scoped-sanity'
import { accessEnvironment, withSiteAccessStore } from './server'
import { authorizeAccessManagement, getSignedInSummary, listGroups, listSharedPasswords } from './management'
import { ACCESS_LIMITS, ACCESS_PERMISSIONS, AccessError } from './model'
import { parseAccessPolicy } from './policy'
import type { LocalizedName } from './store'

export type AccessGroupView = {
  id: string
  name: string
  archived: boolean
  /** Passwords that open this group. Labels only; never a hash or the password. */
  passwords: Array<{ id: string; label: string; inUse: boolean; changedAt: string }>
  /** null = the count is not available. */
  signedIn: number | null
  /** What the group opens: protected pages (Studio) and group documents (Documents). */
  opens: { pages: number; documents: number }
}

export type AccessDashboardData =
  | { notReady: true }
  | {
      notReady: false
      groups: AccessGroupView[]
      /** Visitors signed in now (each once); null = not available. */
      signedInTotal: number | null
      limits: { passwordMinLength: number; passwordMaxLength: number; nameMax: number }
    }

export function pickName(name: LocalizedName | null | undefined, locale: string, fallback: string): string {
  const n = name ?? {}
  return n[locale] ?? n[fallback] ?? Object.values(n)[0] ?? ''
}

const notInstalled = (e: unknown) => e instanceof AccessError && e.code === 'unavailable' && /not installed/.test(e.message)

/** Protected pages per group (published pages of the project, own rule only). */
const PROTECTED_PAGES_QUERY = /* groq */ `*[_type == "page" && projectSlug == $projectSlug && access.visibility == "restricted" && !(_id in path("drafts.**")) && !(_id in path("versions.**"))]{ access }`

export async function loadAccessDashboard(ctx: TenantAuthorizationContext, projectId: string, locale: string): Promise<AccessDashboardData> {
  const grant = authorizeAccessManagement(ctx, projectId, 'read')
  const scoped = tenantScopedSanityClient(ctx, projectId)
  const config = await scoped.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`
  )
  const defaultLocale = config?.defaultLocale || config?.supportedLocales?.[0] || 'en'
  const pagesP = scoped.fetch<Array<{ access?: unknown }>>(PROTECTED_PAGES_QUERY)
  pagesP.catch(() => undefined) // awaited below; keeps an early rejection from being "unhandled"
  try {
    const { groups, passwords, summary, documents } = await withSiteAccessStore('dashboard Access screen (read)', async (store) => {
      const [groups, passwords, documents] = await Promise.all([
        listGroups(store, grant),
        listSharedPasswords(store, grant),
        store.listDocuments(projectId).catch(() => []),
      ])
      const env = accessEnvironment()
      const summary = env ? await getSignedInSummary(store, grant, env).catch(() => null) : null
      return { groups, passwords, summary, documents }
    })
    const pages = (await pagesP.catch(() => [])) ?? []
    const now = Date.now()
    const pageCount = (groupId: string) =>
      pages.filter((p) => {
        const policy = parseAccessPolicy(p.access)
        return policy.visibility === 'restricted' && policy.groupIds.some((g) => g.toLowerCase() === groupId.toLowerCase())
      }).length
    const docCount = (groupId: string) =>
      documents.filter((d) => !d.archivedAt && d.visibility === 'groups' && d.groupIds.some((g) => g.toLowerCase() === groupId.toLowerCase())).length
    return {
      notReady: false,
      groups: groups.map((g) => ({
        id: g.id,
        name: pickName(g.name, defaultLocale, locale),
        archived: Boolean(g.archivedAt),
        passwords: passwords
          .filter((p) => p.groupIds.includes(g.id))
          .map((p) => ({
            id: p.id,
            label: p.label,
            inUse: !p.disabledAt && (!p.expiresAt || Date.parse(p.expiresAt) > now),
            changedAt: p.rotatedAt ?? p.createdAt,
          })),
        signedIn: summary ? summary.byGroup[g.id] ?? 0 : null,
        opens: { pages: pageCount(g.id), documents: docCount(g.id) },
      })),
      signedInTotal: summary ? summary.total : null,
      limits: {
        passwordMinLength: ACCESS_LIMITS.passwordMinLength,
        passwordMaxLength: ACCESS_LIMITS.passwordMaxLength,
        nameMax: ACCESS_LIMITS.groupNameMax,
      },
    }
  } catch (e) {
    if (notInstalled(e)) return { notReady: true }
    throw e
  }
}

export const ACCESS_READ_PERMISSION = ACCESS_PERMISSIONS.read
export const ACCESS_MANAGE_PERMISSION = ACCESS_PERMISSIONS.manage
