'use server'

/**
 * Client dashboard — Documents actions (ADR-040 §15, R9).
 *
 * Every action re-resolves the caller server-side (resolveProjectAction: the
 * URL's projectSlug only picks one of the caller's own grants; support-mode
 * write stripping applies), then `authorizeDocumentsManagement` checks that
 * the Documents module is installed for THAT project and that the caller holds
 * `documents.document.manage` there. The grant is bound to the one project, so
 * an id from another project is simply not found.
 *
 * Placements ("Show on") are checked against the project's pages read here,
 * server-side: a page without a Download section, or one the document does not
 * fit (a group document on a public page), is refused.
 *
 * A support visit is refused before anything else (`support_mode`): what
 * support may do here is decided later (Tom, R9) — deny by default.
 *
 * Failures collapse to opaque codes the screen translates.
 */
import { resolveProjectAction } from '@/lib/api/project-action'
import { tenantScopedSanityClient } from '@/lib/api/tenant-scoped-sanity'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import {
  authorizeDocumentsManagement,
  beginDocumentFileUpload,
  createDocumentWithPlacements,
  finishDocumentFileUpload,
  removeDocumentFromPage,
  removeDocumentLanguages,
  reorderPageDocuments,
  setDocumentAccessAndPlacements,
  setDocumentArchivedState,
  setDocumentsArchivedState,
  deleteDocumentsForGood,
  updateDocumentDetails,
  listDocumentsForDashboard,
  type DocumentsGrant,
  type FinishResult,
  type UploadTicket,
} from '@/lib/access/documents'
import { listDownloadPages, type DownloadPage } from '@/lib/access/download-pages'
import { DOCUMENT_TERM_KEYS_QUERY, toTermKeys, type TermKeys } from '@/lib/modules/documents/terms'
import { toAccessActionError, type AccessActionResult } from '@/lib/access/action-errors'
import { withSiteAccessStore } from '@/lib/access/server'
import { AccessError } from '@/lib/access/model'
import type { SiteAccessFiles } from '@/lib/access/file-storage'
import type { SiteAccessStore } from '@/lib/access/store'

type Site = { defaultLocale: string; locales: string[] }
type Ctx = { grant: DocumentsGrant; store: SiteAccessStore; files: SiteAccessFiles; site: Site; pages: () => Promise<DownloadPage[]>; terms: () => Promise<TermKeys> }

async function readSite(ctx: TenantAuthorizationContext, projectId: string): Promise<Site> {
  const c = await tenantScopedSanityClient(ctx, projectId).fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
    `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`
  )
  const defaultLocale = c?.defaultLocale || c?.supportedLocales?.[0] || 'en'
  return { defaultLocale, locales: c?.supportedLocales?.length ? [...new Set([defaultLocale, ...c.supportedLocales])] : [defaultLocale] }
}

async function run<T extends object>(input: { projectSlug?: unknown }, reason: string, fn: (c: Ctx) => Promise<T>, level: 'manage' | 'delete' = 'manage'): Promise<AccessActionResult<T>> {
  const access = await resolveProjectAction(input?.projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  // Deny by default (Tom, R9): what Abluo support may change in Documents is decided later.
  if (access.ctx.support) return { ok: false, error: 'support_mode' }
  try {
    const grant = authorizeDocumentsManagement(access.ctx, access.grant.projectId, level)
    const site = await readSite(access.ctx, access.grant.projectId)
    const scoped = tenantScopedSanityClient(access.ctx, access.grant.projectId)
    let pages: Promise<DownloadPage[]> | null = null
    const loadPages = () => (pages ??= listDownloadPages((q, p) => scoped.fetch(q, p), { locale: site.defaultLocale, defaultLocale: site.defaultLocale }))
    let terms: Promise<TermKeys> | null = null
    const loadTerms = () => (terms ??= scoped.fetch<{ categories?: unknown; tags?: unknown } | null>(DOCUMENT_TERM_KEYS_QUERY).then(toTermKeys))
    return { ok: true, ...(await withSiteAccessStore(`dashboard Documents: ${reason}`, (store, files) => fn({ grant, store, files, site, pages: loadPages, terms: loadTerms }))) }
  } catch (error) {
    return { ok: false, error: toAccessActionError(error) }
  }
}

/**
 * Title / note per language from the form: only the site's languages count;
 * an empty value removes that language (visitors then see the main language).
 * Languages the site no longer has are kept as they were (`current`).
 * The main language's title is required.
 */
function mergeTexts(current: Record<string, string> | null | undefined, input: unknown, site: Site): Record<string, string> {
  const next = { ...(current ?? {}) }
  const given = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  for (const l of site.locales) {
    const v = typeof given[l] === 'string' ? (given[l] as string).trim() : ''
    if (v) next[l] = v
    else delete next[l]
  }
  return next
}
function requireMainTitle(titles: Record<string, string>, site: Site): void {
  if (!titles[site.defaultLocale]) throw new AccessError('invalid_input', 'title')
}

export async function createDocumentAction(input: {
  projectSlug: string
  /** Per language; the site's main language is required. */
  titles: Record<string, string>
  notes: Record<string, string>
  visibility: 'everyone' | 'groups'
  groupIds: string[]
  pageIds: string[]
  categoryKey?: string | null
  tagKeys?: string[]
}) {
  return run(input, 'create document', async ({ store, grant, site, pages, terms }) => {
    const title = mergeTexts(null, input.titles, site)
    requireMainTitle(title, site)
    const note = mergeTexts(null, input.notes, site)
    return {
      documentId: await createDocumentWithPlacements(store, grant, {
        title,
        note: Object.keys(note).length ? note : null,
        categoryTermId: input.categoryKey ?? null,
        tagTermIds: input.tagKeys ?? [],
        visibility: input.visibility,
        groupIds: input.groupIds,
        pageIds: input.pageIds,
      }, await pages(), await terms()),
    }
  })
}

/** Title and note in every language of the site (other stored languages are kept); category and tags when sent. */
export async function updateDocumentAction(input: {
  projectSlug: string
  documentId: string
  titles: Record<string, string>
  notes: Record<string, string>
  categoryKey?: string | null
  tagKeys?: string[]
}) {
  return run(input, 'update document', async ({ store, grant, site, terms }) => {
    const current = (await listDocumentsForDashboard(store, grant)).find((d) => d.id === input.documentId)
    if (!current) throw new AccessError('not_found')
    const title = mergeTexts(current.title, input.titles, site)
    requireMainTitle(title, site)
    const note = mergeTexts(current.note, input.notes, site)
    await updateDocumentDetails(store, grant, input.documentId, {
      title,
      note: Object.keys(note).length ? note : null,
      categoryTermId: input.categoryKey === undefined ? current.categoryTermId : input.categoryKey,
      tagTermIds: input.tagKeys === undefined ? current.tagTermIds : input.tagKeys,
    }, await terms())
    return {}
  })
}

export async function setDocumentAccessAction(input: { projectSlug: string; documentId: string; visibility: 'everyone' | 'groups'; groupIds: string[]; pageIds: string[] }) {
  return run(input, 'set document access and pages', async ({ store, grant, pages }) => {
    await setDocumentAccessAndPlacements(store, grant, input.documentId, input, await pages())
    return {}
  })
}

export async function setDocumentArchivedAction(input: { projectSlug: string; documentId: string; archived: boolean }) {
  return run(input, input.archived ? 'archive document' : 'restore document', async ({ store, grant }) => {
    await setDocumentArchivedState(store, grant, input.documentId, input.archived === true)
    return {}
  })
}

/** Archive or restore the documents selected in the list. */
export async function setDocumentsArchivedAction(input: { projectSlug: string; documentIds: string[]; archived: boolean }) {
  return run(input, input.archived ? 'archive documents' : 'restore documents', async ({ store, grant }) => ({
    changed: await setDocumentsArchivedState(store, grant, input.documentIds, input.archived === true),
  }))
}

/** Delete archived documents for good (Owner: `documents.document.delete`). */
export async function deleteDocumentsAction(input: { projectSlug: string; documentIds: string[] }) {
  return run(input, 'delete documents for good', async ({ store, grant }) => ({
    deleted: await deleteDocumentsForGood(store, grant, input.documentIds),
  }), 'delete')
}

export async function removeDocumentLanguagesAction(input: { projectSlug: string; documentId: string; locales: string[] }) {
  return run(input, 'remove document languages', async ({ store, grant, site }) => ({
    removed: await removeDocumentLanguages(store, grant, input.documentId, input.locales, site.locales),
  }))
}

export async function reorderPageDocumentsAction(input: { projectSlug: string; pageId: string; documentIds: string[] }) {
  return run(input, 'reorder documents on a page', async ({ store, grant, pages }) => {
    await reorderPageDocuments(store, grant, input.pageId, input.documentIds, await pages())
    return {}
  })
}

export async function removeDocumentFromPageAction(input: { projectSlug: string; documentId: string; pageId: string }) {
  return run(input, 'remove a document from a page', async ({ store, grant }) => {
    await removeDocumentFromPage(store, grant, input.documentId, input.pageId)
    return {}
  })
}

/** Reserves an upload and returns a one-time signed URL for the browser to PUT the file to (never the bucket path). */
export async function beginDocumentUploadAction(input: { projectSlug: string; documentId: string; locales: string[]; mimeType: string; sizeBytes: number; sha256: string; filename: string }) {
  return run(input, 'begin upload', async ({ store, files, grant, site }): Promise<{ ticket: UploadTicket }> => ({
    ticket: await beginDocumentFileUpload(store, files, grant, input, site.locales),
  }))
}

/** The server re-reads the stored object and checks it before the document points at it. */
export async function finishDocumentUploadAction(input: { projectSlug: string; uploadId: string }) {
  return run(input, 'finish upload', async ({ store, files, grant }): Promise<{ result: FinishResult }> => ({
    result: await finishDocumentFileUpload(store, files, grant, input.uploadId),
  }))
}
