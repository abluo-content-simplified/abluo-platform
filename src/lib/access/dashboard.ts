/**
 * Site Access — what the tenant dashboard's Access screen shows (ADR-040
 * B2.5). Server-only. One read for the whole screen: groups with their
 * passwords (never a hash), how many visitors are signed in, documents and
 * their files, the site's pages and who may see them.
 *
 * Everything is read with the caller's `members.access.read` grant on ONE
 * project; pages through the tenant-scoped Sanity client. When the Supabase
 * tables are not installed yet (migrations 050/052 unapplied) the screen gets
 * `notReady` instead of an error; a missing summary (053) only hides the
 * signed-in counts.
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { tenantScopedSanityClient } from '@/lib/api/tenant-scoped-sanity'
import { getSiteStatus } from '@/lib/api/dashboard/site'
import { accessEnvironment, withSiteAccessStore } from './server'
import { authorizeAccessManagement, getSignedInSummary, listDocuments, listGroups, listSharedPasswords } from './management'
import { listAccessPages, type AccessPageItem } from './page-visibility'
import { ACCESS_LIMITS, ACCESS_PERMISSIONS, AccessError } from './model'
import { ACCESS_ROUTE_SEGMENT } from './request'
import type { LocalizedName } from './store'

export type AccessGroupView = {
  id: string
  name: string
  archived: boolean
  /** Passwords that open this group. Labels only; never a hash or the password. */
  passwords: Array<{ id: string; label: string; inUse: boolean; changedAt: string }>
  /** null = the count is not available. */
  signedIn: number | null
}

export type AccessDocumentView = {
  id: string
  title: string
  archived: boolean
  groupIds: string[]
  files: Array<{ locale: string; sizeBytes: number; filename: string | null; uploadedAt: string }>
  /** The stable link visitors use (the site's own address); null while the site is not online. */
  link: string | null
}

export type AccessSite = {
  defaultLocale: string
  locales: string[]
  /** The public site address, e.g. https://example.com — null while not online. */
  url: string | null
}

export type AccessDashboardData =
  | { notReady: true; site: AccessSite }
  | {
      notReady: false
      site: AccessSite
      groups: AccessGroupView[]
      documents: AccessDocumentView[]
      pages: AccessPageItem[]
      /** Visitors signed in now (each once); null = not available. */
      signedInTotal: number | null
      limits: { fileBytesMax: number; passwordMinLength: number; passwordMaxLength: number; nameMax: number }
    }

export function pickName(name: LocalizedName | null | undefined, locale: string, fallback: string): string {
  const n = name ?? {}
  return n[locale] ?? n[fallback] ?? Object.values(n)[0] ?? ''
}

/** The stable document link on the site's own address (language falls back on the site). */
export function documentLink(siteUrl: string | null, locale: string, documentId: string): string | null {
  if (!siteUrl) return null
  return `${siteUrl.replace(/\/+$/, '')}/${locale}/${ACCESS_ROUTE_SEGMENT}/documents/${documentId}`
}

async function readSite(ctx: TenantAuthorizationContext, projectId: string): Promise<AccessSite> {
  const scoped = tenantScopedSanityClient(ctx, projectId)
  const config = await scoped.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`
  )
  const defaultLocale = config?.defaultLocale || config?.supportedLocales?.[0] || 'en'
  const locales = config?.supportedLocales?.length ? [...new Set([defaultLocale, ...config.supportedLocales])] : [defaultLocale]
  const status = await getSiteStatus(ctx, projectId).catch(() => null)
  return { defaultLocale, locales, url: status?.url ?? null }
}

const notInstalled = (e: unknown) => e instanceof AccessError && e.code === 'unavailable' && /not installed/.test(e.message)

export async function loadAccessDashboard(ctx: TenantAuthorizationContext, projectId: string, locale: string): Promise<AccessDashboardData> {
  const grant = authorizeAccessManagement(ctx, projectId, 'read')
  const site = await readSite(ctx, projectId)
  const scoped = tenantScopedSanityClient(ctx, projectId)
  const pagesP = listAccessPages((q, p) => scoped.fetch(q, p), { locale, defaultLocale: site.defaultLocale })
  pagesP.catch(() => undefined) // awaited below; this only keeps an early rejection from being "unhandled"
  try {
    const { groups, passwords, documents, summary } = await withSiteAccessStore('dashboard Access screen (read)', async (store) => {
      const [groups, passwords, documents] = await Promise.all([listGroups(store, grant), listSharedPasswords(store, grant), listDocuments(store, grant)])
      const env = accessEnvironment()
      const summary = env ? await getSignedInSummary(store, grant, env).catch(() => null) : null
      return { groups, passwords, documents, summary }
    })
    const pages = await pagesP
    const now = Date.now()
    return {
      notReady: false,
      site,
      groups: groups.map((g) => ({
        id: g.id,
        name: pickName(g.name, site.defaultLocale, locale),
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
      })),
      documents: documents.map((d) => ({
        id: d.id,
        title: pickName(d.title, site.defaultLocale, locale),
        archived: Boolean(d.archivedAt),
        groupIds: d.groupIds,
        files: d.files.map((f) => ({ locale: f.locale, sizeBytes: f.sizeBytes, filename: f.originalFilename, uploadedAt: f.uploadedAt })),
        link: documentLink(site.url, site.defaultLocale, d.id),
      })),
      pages,
      signedInTotal: summary ? summary.total : null,
      limits: {
        fileBytesMax: ACCESS_LIMITS.fileBytesMax,
        passwordMinLength: ACCESS_LIMITS.passwordMinLength,
        passwordMaxLength: ACCESS_LIMITS.passwordMaxLength,
        nameMax: ACCESS_LIMITS.groupNameMax,
      },
    }
  } catch (e) {
    if (notInstalled(e)) {
      return { notReady: true, site }
    }
    throw e
  }
}

export const ACCESS_READ_PERMISSION = ACCESS_PERMISSIONS.read
export const ACCESS_MANAGE_PERMISSION = ACCESS_PERMISSIONS.manage
