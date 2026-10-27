/**
 * Documents — what the dashboard's Documents screens show (ADR-040 §15, R9).
 * Server-only. One read: the documents (with files, groups and pages), the
 * group NAMES (only when Access is installed), the pages that can show
 * documents (those with a Download section) and the site's languages.
 *
 * Read with the caller's `documents.document.read` grant on ONE project;
 * pages through the tenant-scoped Sanity client. Supabase tables missing →
 * `notReady` instead of an error.
 */
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { tenantScopedSanityClient } from '@/lib/api/tenant-scoped-sanity'
import { getSiteStatus } from '@/lib/api/dashboard/site'
import { withSiteAccessStore } from './server'
import { authorizeDocumentsManagement, listDocumentsForDashboard, listGroupChoices } from './documents'
import { listDownloadPages, type DownloadPage } from './download-pages'
import { AccessError, ACCESS_LIMITS, DOCUMENTS_PERMISSIONS } from './model'
import { ACCESS_ROUTE_SEGMENT } from './request'
import { DOCUMENT_FILE_TYPES } from './pdf'
import type { DocumentFileRow, DocumentVisibility, LocalizedName } from './store'
import { DOCUMENT_TERMS_QUERY, toDocumentTerms, type DocumentTerm } from '@/lib/modules/documents/terms'
import { canModuleAction } from '@/lib/api/module-action-guard'

export type DocumentsSite = {
  defaultLocale: string
  /** The site's languages, default first. */
  locales: string[]
  /** The public site address, e.g. https://example.com — null while not online. */
  url: string | null
}

export type DocumentView = {
  id: string
  /** Title in the site's default language (falls back to any). */
  title: string
  titles: LocalizedName
  note: LocalizedName | null
  visibility: DocumentVisibility
  groupIds: string[]
  archived: boolean
  createdAt: string
  files: DocumentFileRow[]
  /** True when every language shares one stored file. */
  sharedFile: boolean
  /** Category key (Categories & Tags, module `documents`), or null. */
  categoryKey: string | null
  tagKeys: string[]
  pageIds: string[]
  /** Position on each page (0 = first). */
  pageOrder: Record<string, number>
  /** The stable link (copy link), on the site's own address; null while the site is not online. */
  link: string | null
}

export type DocumentsDashboardData =
  | { notReady: true; site: DocumentsSite }
  | {
      notReady: false
      site: DocumentsSite
      documents: DocumentView[]
      /** Live and archived groups (names only); empty without Access. */
      groups: Array<{ id: string; name: string; archived: boolean }>
      groupsAvailable: boolean
      pages: DownloadPage[]
      /** The project's document categories and tags, in display order. */
      categories: DocumentTerm[]
      tags: DocumentTerm[]
      /** May add a category or tag on the spot (`documents.taxonomy.write`; the server re-checks). */
      canAddTerms: boolean
      limits: { titleMax: number; noteMax: number; types: Array<{ mimeType: string; extension: string; maxBytes: number }> }
    }

function pickName(name: LocalizedName | null | undefined, locale: string, fallback: string): string {
  const n = name ?? {}
  return n[locale] ?? n[fallback] ?? Object.values(n)[0] ?? ''
}

export function documentLink(siteUrl: string | null, locale: string, documentId: string): string | null {
  if (!siteUrl) return null
  return `${siteUrl.replace(/\/+$/, '')}/${locale}/${ACCESS_ROUTE_SEGMENT}/documents/${documentId}`
}

async function readSite(ctx: TenantAuthorizationContext, projectId: string): Promise<DocumentsSite> {
  const scoped = tenantScopedSanityClient(ctx, projectId)
  const config = await scoped.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`
  )
  const defaultLocale = config?.defaultLocale || config?.supportedLocales?.[0] || 'en'
  const locales = config?.supportedLocales?.length ? [...new Set([defaultLocale, ...config.supportedLocales])] : [defaultLocale]
  const status = await getSiteStatus(ctx, projectId).catch(() => null)
  return { defaultLocale, locales, url: status?.url ?? null }
}

export async function loadDocumentsDashboard(ctx: TenantAuthorizationContext, projectId: string, locale: string): Promise<DocumentsDashboardData> {
  const grant = authorizeDocumentsManagement(ctx, projectId, 'read')
  const site = await readSite(ctx, projectId)
  const scoped = tenantScopedSanityClient(ctx, projectId)
  const pagesP = listDownloadPages((q, p) => scoped.fetch(q, p), { locale, defaultLocale: site.defaultLocale })
  pagesP.catch(() => undefined)
  const termsP = scoped.fetch<{ categories?: unknown; tags?: unknown } | null>(DOCUMENT_TERMS_QUERY).then((r) => ({ categories: toDocumentTerms(r?.categories), tags: toDocumentTerms(r?.tags) }))
  termsP.catch(() => undefined)
  try {
    const { documents, groups } = await withSiteAccessStore('dashboard Documents screen (read)', async (store) => {
      const [documents, groups] = await Promise.all([listDocumentsForDashboard(store, grant), listGroupChoices(store, grant)])
      return { documents, groups }
    })
    const [pages, terms] = await Promise.all([pagesP, termsP])
    return {
      notReady: false,
      site,
      documents: documents.map((d) => ({
        id: d.id,
        title: pickName(d.title, site.defaultLocale, locale),
        titles: d.title,
        note: d.note,
        visibility: d.visibility,
        groupIds: d.groupIds,
        archived: Boolean(d.archivedAt),
        createdAt: d.createdAt,
        files: d.files,
        sharedFile: d.files.length > 1 && new Set(d.files.map((f) => f.sha256)).size === 1,
        categoryKey: d.categoryTermId,
        tagKeys: d.tagTermIds,
        pageIds: d.pageIds,
        pageOrder: d.pageOrder,
        link: documentLink(site.url, d.files[0]?.locale ?? site.defaultLocale, d.id),
      })),
      groups: groups.map((g) => ({ id: g.id, name: pickName(g.name, site.defaultLocale, locale), archived: Boolean(g.archivedAt) })),
      groupsAvailable: grant.groupsAvailable,
      pages,
      categories: terms.categories,
      tags: terms.tags,
      canAddTerms: canModuleAction(ctx, projectId, 'documents.taxonomy.write'),
      limits: {
        titleMax: ACCESS_LIMITS.documentTitleMax,
        noteMax: ACCESS_LIMITS.noteMax,
        types: Object.entries(DOCUMENT_FILE_TYPES).map(([mimeType, t]) => ({ mimeType, extension: t.extension, maxBytes: t.maxBytes })),
      },
    }
  } catch (e) {
    if (e instanceof AccessError && e.code === 'unavailable' && /not installed/.test(e.message)) return { notReady: true, site }
    throw e
  }
}

export const DOCUMENTS_READ_PERMISSION = DOCUMENTS_PERMISSIONS.read
export const DOCUMENTS_MANAGE_PERMISSION = DOCUMENTS_PERMISSIONS.manage
export const DOCUMENTS_DELETE_PERMISSION = DOCUMENTS_PERMISSIONS.delete
