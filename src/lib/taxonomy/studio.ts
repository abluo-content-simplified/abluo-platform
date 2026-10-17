// ── Studio helpers for taxonomyTerm ───────────────────────────────────────────
// ADR-033 Amendment J, slice 6 (T1: Studio is superadmin-only and fully
// editable). Pure — no React, no Sanity imports — so the desk structure, the
// "new term" pane and the Modules pane share one tested set of rules.

import { TAXONOMY_TERM_TYPE, isTermKind, termId, type TermKind } from './ids'
import { deriveTermKey, labelIssues, nextOrder, termLimitIssue } from './rules'
import { buildUsageQuery, type UsedBy } from './usage'

type Declaration = { kind: TermKind; usedBy: readonly UsedBy[] }
type ModuleLike = { id: string; label: string; taxonomies?: readonly Declaration[] }

/** Modules that own at least one taxonomy kind, in registry order. */
export function taxonomyModules<T extends ModuleLike>(registry: readonly T[]): T[] {
  return registry.filter((m) => (m.taxonomies?.length ?? 0) > 0)
}

export function kindLabel(kind: TermKind, plural = false): string {
  return kind === 'category' ? (plural ? 'Categories' : 'Category') : plural ? 'Tags' : 'Tag'
}

/** GROQ filter + params for a project's terms, optionally narrowed to a module and/or kind. */
export function termListFilter(projectSlug: string, module?: string, kind?: TermKind) {
  const clauses = [`_type == "${TAXONOMY_TERM_TYPE}"`, 'projectSlug == $projectSlug']
  const params: Record<string, string> = { projectSlug }
  if (module) {
    clauses.push('module == $module')
    params.module = module
  }
  if (kind) {
    clauses.push('kind == $kind')
    params.kind = kind
  }
  return { filter: clauses.join(' && '), params }
}

export type NewTermInput = {
  projectSlug: string
  module: string
  kind: TermKind
  /** Label in the project's default language. */
  label: string
  defaultLocale: string
  existingKeys: readonly string[]
  existingOrders: readonly number[]
  now: string
  userId?: string
}

export type NewTermResult = { ok: true; doc: Record<string, unknown> } | { ok: false; message: string }

/**
 * The document the "New category or tag" pane creates: key derived from the
 * default-language label (collision suffix _2, _3 …), deterministic `_id`,
 * appended order. Create it with `createIfNotExists`.
 */
export function buildNewTerm(input: NewTermInput): NewTermResult {
  const label = input.label.trim()
  const issue = labelIssues({ [input.defaultLocale]: label }, input.defaultLocale)[0] ?? termLimitIssue(input.existingKeys.length)
  if (issue) return { ok: false, message: issue.message }
  const key = deriveTermKey(label, input.existingKeys)
  const stamp = { createdAt: input.now, updatedAt: input.now, ...(input.userId ? { createdBy: input.userId, updatedBy: input.userId } : {}) }
  return {
    ok: true,
    doc: {
      _id: termId({ projectSlug: input.projectSlug, module: input.module, kind: input.kind, key }),
      _type: TAXONOMY_TERM_TYPE,
      projectSlug: input.projectSlug,
      module: input.module,
      kind: input.kind,
      key,
      label: { _type: 'localizedString', [input.defaultLocale]: label },
      order: nextOrder(input.existingOrders),
      ...stamp,
    },
  }
}

/** The where-used query for one term, or null when its module/kind declares no usage. */
export function usageQueryForTerm(registry: readonly ModuleLike[], term: { module?: unknown; kind?: unknown; key?: unknown }) {
  if (typeof term.module !== 'string' || typeof term.key !== 'string' || !isTermKind(term.kind)) return null
  const decl = registry.find((m) => m.id === term.module)?.taxonomies?.find((t) => t.kind === term.kind)
  if (!decl || decl.usedBy.length === 0) return null
  return buildUsageQuery(decl.usedBy, term.key)
}

/**
 * Config-list fields whose vocabulary now lives in `taxonomyTerm` records, so
 * the Modules pane no longer edits them. Catalogue categories only; every
 * other module's lists (blog / news / events categories, dietary tags …) are
 * untouched.
 */
export const TERM_MANAGED_CONFIG_FIELDS: readonly { moduleId: string; fieldId: string }[] = [
  { moduleId: 'catalogue', fieldId: 'categories' },
]

export function isTermManagedConfigField(moduleId: string, fieldId: string): boolean {
  return TERM_MANAGED_CONFIG_FIELDS.some((f) => f.moduleId === moduleId && f.fieldId === fieldId)
}
