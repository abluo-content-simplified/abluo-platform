/**
 * Documents — fills a page's Download section for THIS visitor (ADR-040 §15).
 * Server-only; called from hydrateSections after the page gate.
 *
 * Re-checked at every display (nothing here is cached across requests):
 *   - the Documents module must be enabled, or the section stays empty;
 *   - only documents the client placed on this page, live, with a file;
 *   - only documents that still FIT the page (documentFitsPage) — a page made
 *     public later simply stops listing its group documents;
 *   - group documents only for a visitor holding one of their groups, and only
 *     while Access is enabled.
 * No storage path ever reaches the page: each document links to the document
 * route, which authorises the file request again on its own.
 */
import { resolveScopeFromProjectSegment } from '@/lib/tenancy/host-scope'
import type { DownloadSection, DownloadSectionDocument, PageSection } from '@/lib/sanity/types'
import { ACCESS_MODULE_ID, DOCUMENTS_MODULE_ID } from './model'
import { visibleOnPage } from './download-pages'
import { withSiteAccessStore } from './server'
import type { PageDocumentRow } from './store'
import type { PageGate } from './page-gate'
import { tenantClient } from '@/lib/sanity/client'
import { asUrlProjectSegment } from '@/lib/tenancy/ids'
import { DOCUMENT_TERMS_QUERY, termLabel, toDocumentTerms, type DocumentTerm } from '@/lib/modules/documents/terms'

export type DownloadHydration = {
  projectSegment: string
  /** The published page id (Sanity `_id`). */
  pageId: string
  /** Effective protection of the page, from the gate. */
  page: { restricted: boolean; groupIds: string[] }
  /** The visitor's live groups (lower-case), or null when none. */
  visitorGroupIds: string[] | null
  locale: string
  defaultLocale: string
  /** The site's link prefix for a language (`/it/tmz` on platform hosts, `/it` on the site's own domain). */
  siteBaseFor: (locale: string) => string
  enabledModuleIds: readonly string[] | null
}

/** The page's protection and the visitor's groups as the gate decided them. */
export function downloadAccessFromGate(gate: PageGate | null | undefined): Pick<DownloadHydration, 'page' | 'visitorGroupIds'> {
  if (!gate || gate.kind !== 'granted') return { page: { restricted: false, groupIds: [] }, visitorGroupIds: null }
  const groupIds = [...new Set(gate.chain.flatMap((p) => (p.visibility === 'restricted' ? p.groupIds.map((g) => g.toLowerCase()) : [])))].sort()
  return { page: { restricted: true, groupIds }, visitorGroupIds: gate.visitorGroupIds }
}

function pick(value: Record<string, string> | null | undefined, locale: string, fallback: string): string | null {
  if (!value) return null
  return value[locale] ?? value[fallback] ?? Object.values(value)[0] ?? null
}

/** Pure: placed rows → what the section shows, in the section's order. */
export function toSectionDocuments(
  rows: readonly PageDocumentRow[],
  ctx: Pick<DownloadHydration, 'page' | 'visitorGroupIds' | 'locale' | 'defaultLocale' | 'siteBaseFor'> & {
    accessEnabled: boolean
    sort: DownloadSection['documentSort']
    /** The project's document categories and tags (unknown keys are simply not shown). */
    terms?: { categories: DocumentTerm[]; tags: DocumentTerm[] }
  }
): DownloadSectionDocument[] {
  const categories = new Map((ctx.terms?.categories ?? []).map((t) => [t.value, t]))
  const tagOrder = (ctx.terms?.tags ?? []).map((t) => t.value)
  const tags = new Map((ctx.terms?.tags ?? []).map((t) => [t.value, t]))
  const visitor = ctx.visitorGroupIds ? new Set(ctx.visitorGroupIds) : null
  const usable = rows.filter((r) => r.visibility === 'everyone' || ctx.accessEnabled)
  const visible = visibleOnPage(usable, ctx.page, visitor)
  const out = visible.flatMap((r): DownloadSectionDocument[] => {
    const file = r.files.find((f) => f.locale === ctx.locale) ?? r.files.find((f) => f.locale === ctx.defaultLocale) ?? r.files[0]
    if (!file) return []
    const title = pick(r.title, ctx.locale, ctx.defaultLocale)
    if (!title) return []
    return [{
      id: r.documentId,
      title,
      note: pick(r.note, ctx.locale, ctx.defaultLocale),
      members: r.visibility === 'groups',
      file: { locale: file.locale, mimeType: file.mimeType, sizeBytes: file.sizeBytes },
      otherLocales: r.files.map((f) => f.locale).filter((l) => l !== file.locale),
      // The file's OWN language in the link: the route serves that language.
      href: `${ctx.siteBaseFor(file.locale)}/site-access/documents/${r.documentId}`,
      updatedAt: r.updatedAt,
      category: r.categoryTermId && categories.has(r.categoryTermId)
        ? { key: r.categoryTermId, label: termLabel(categories.get(r.categoryTermId)!, ctx.locale, ctx.defaultLocale) }
        : null,
      tags: [...r.tagTermIds].filter((k) => tags.has(k)).sort((a, b) => tagOrder.indexOf(a) - tagOrder.indexOf(b)).map((k) => termLabel(tags.get(k)!, ctx.locale, ctx.defaultLocale)),
    }]
  })
  if (ctx.sort === 'newest') out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  else if (ctx.sort === 'az') out.sort((a, b) => a.title.localeCompare(b.title, ctx.locale, { sensitivity: 'base' }))
  return out
}

/** Sets `documents` on every Download section of the page; leaves it undefined (section hidden) on any failure. */
export async function hydrateDownloadSections(sections: PageSection[] | undefined, ctx: DownloadHydration): Promise<void> {
  const targets = (sections ?? []).filter((s): s is DownloadSection => s._type === 'downloadSection')
  if (targets.length === 0) return
  const enabled = ctx.enabledModuleIds
  if (!Array.isArray(enabled) || !enabled.includes(DOCUMENTS_MODULE_ID)) return
  const projectId = resolveScopeFromProjectSegment(ctx.projectSegment)?.projectId
  if (!projectId) return
  // Labels are decoration: if the vocabulary cannot be read, the documents still show (without them).
  const termsP = tenantClient(asUrlProjectSegment(ctx.projectSegment))
    .fetchForTenant<{ categories?: unknown; tags?: unknown } | null>(DOCUMENT_TERMS_QUERY)
    .then((r) => ({ categories: toDocumentTerms(r?.categories), tags: toDocumentTerms(r?.tags) }))
    .catch(() => ({ categories: [] as DocumentTerm[], tags: [] as DocumentTerm[] }))
  let rows: PageDocumentRow[]
  try {
    rows = await withSiteAccessStore('download section: list the documents placed on a page', (store) => store.pageDocuments(projectId, [ctx.pageId]))
  } catch (err) {
    console.error('[documents] download section hydration failed; section omitted', err)
    return
  }
  const terms = await termsP
  const onPage = rows.filter((r) => r.pageId === ctx.pageId)
  for (const section of targets) {
    section.documents = toSectionDocuments(onPage, { ...ctx, accessEnabled: enabled.includes(ACCESS_MODULE_ID), sort: section.documentSort ?? 'manual', terms })
  }
}
