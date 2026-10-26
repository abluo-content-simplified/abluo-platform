/**
 * Documents — the categories and tags of documents (ADR-040 §15, R9.2).
 *
 * The vocabulary is ordinary `taxonomyTerm` records (module `documents`), kept
 * in Categories & Tags like every other module's. A document stores the KEYS
 * (in Supabase): one category, up to 20 tags. Queries are always run through
 * a project-scoped client ($projectSlug is forced).
 */
import { moduleTermsGroq } from '@/lib/taxonomy/vocabulary'

export const DOCUMENTS_TAXONOMY_MODULE = 'documents'

/** Keys only — to check a selection on the server. */
export const DOCUMENT_TERM_KEYS_QUERY = /* groq */ `{
  "categories": *[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == "documents" && kind == "category" && !(_id in path("drafts.**"))].key,
  "tags": *[_type == "taxonomyTerm" && projectSlug == $projectSlug && module == "documents" && kind == "tag" && !(_id in path("drafts.**"))].key
}`

/** Terms with their whole label map (dashboard). */
export const DOCUMENT_TERMS_QUERY = /* groq */ `{
  "categories": ${moduleTermsGroq(DOCUMENTS_TAXONOMY_MODULE, 'category', 'label')},
  "tags": ${moduleTermsGroq(DOCUMENTS_TAXONOMY_MODULE, 'tag', 'label')}
}`

export type TermKeys = { categories: string[]; tags: string[] }

export function toTermKeys(raw: { categories?: unknown; tags?: unknown } | null | undefined): TermKeys {
  const keys = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && k.length > 0) : [])
  return { categories: keys(raw?.categories), tags: keys(raw?.tags) }
}

/** A term as the dashboard and the website use it: key, label per language, display order. */
export type DocumentTerm = { value: string; label: Record<string, string>; color: string | null }

export function toDocumentTerms(rows: unknown): DocumentTerm[] {
  if (!Array.isArray(rows)) return []
  const out: DocumentTerm[] = []
  const seen = new Set<string>()
  for (const r of rows as Array<{ key?: unknown; label?: unknown; color?: unknown }>) {
    const key = typeof r?.key === 'string' ? r.key : ''
    if (!key || seen.has(key)) continue
    seen.add(key)
    const label: Record<string, string> = {}
    if (r.label && typeof r.label === 'object' && !Array.isArray(r.label)) {
      for (const [k, v] of Object.entries(r.label as Record<string, unknown>)) if (!k.startsWith('_') && typeof v === 'string' && v.trim()) label[k] = v.trim()
    }
    out.push({ value: key, label, color: typeof r.color === 'string' && r.color ? r.color : null })
  }
  return out
}

/** Label for one language: that language, else the site default, else any, else the key. */
export function termLabel(term: DocumentTerm, locale: string, defaultLocale: string): string {
  return term.label[locale] ?? term.label[defaultLocale] ?? Object.values(term.label)[0] ?? term.value
}
