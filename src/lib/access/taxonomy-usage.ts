/**
 * Documents — where a category or tag is used (ADR-040 §15, R9.2). Server-only.
 *
 * Documents live in Supabase, so the taxonomy service cannot find them with
 * its Sanity where-used query. This reads the project's documents (archived
 * ones too: they still hold the key and can be restored) and returns, per
 * key, the documents that hold it. One project only, through the service-role
 * gateway; nothing is written.
 */
import { withSiteAccessStore } from './server'
import type { DocumentRow } from './store'

export type ExternalUsageItem = { id: string; type: string; name: unknown }

/** Pure: documents → key → documents holding it (category or tag). */
export function documentTermUsage(documents: readonly DocumentRow[], kind: 'category' | 'tag'): Map<string, ExternalUsageItem[]> {
  const out = new Map<string, ExternalUsageItem[]>()
  for (const d of documents) {
    const keys = kind === 'category' ? (d.categoryTermId ? [d.categoryTermId] : []) : d.tagTermIds
    for (const key of new Set(keys)) {
      const list = out.get(key) ?? []
      list.push({ id: d.id, type: 'document', name: d.title })
      out.set(key, list)
    }
  }
  return out
}

export async function readDocumentTermUsage(projectId: string, kind: 'category' | 'tag'): Promise<Map<string, ExternalUsageItem[]>> {
  const documents = await withSiteAccessStore('categories and tags: which documents use a term (read only)', (store) => store.listDocuments(projectId))
  return documentTermUsage(documents, kind)
}
