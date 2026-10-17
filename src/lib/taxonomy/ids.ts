// ── Taxonomy term ids ─────────────────────────────────────────────────────────
// ADR-033 Amendment J (J-3). Pure — no React, no I/O.
//
// One record per category or tag. The _id is DETERMINISTIC:
//
//   term.<projectSlug>.<module>.<kind>.<key>
//
// so two creates of the same term collide on the id (createIfNotExists → one
// record) and a term can never be shared between projects. Every part is
// validated so none can contain the "." separator and the id stays parseable.

export const TERM_KINDS = ['category', 'tag'] as const
export type TermKind = (typeof TERM_KINDS)[number]

/** Document type name of a term record. */
export const TAXONOMY_TERM_TYPE = 'taxonomyTerm'

export const TERM_ID_PREFIX = 'term'

/** Project slugs and module ids: lowercase alphanumerics joined by hyphens. */
export const SLUG_PART_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/**
 * Term keys: lowercase alphanumerics joined by "_" or "-". Compatible with the
 * keys the config-list vocabularies already hold (slugifySubjectValue → "_").
 */
export const TERM_KEY_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/
export const TERM_KEY_MAX_LENGTH = 48

export type TermIdParts = {
  projectSlug: string
  module: string
  kind: TermKind
  key: string
}

export function isTermKind(value: unknown): value is TermKind {
  return typeof value === 'string' && (TERM_KINDS as readonly string[]).includes(value)
}

export function isValidTermKey(key: unknown): key is string {
  return typeof key === 'string' && key.length <= TERM_KEY_MAX_LENGTH && TERM_KEY_PATTERN.test(key)
}

/** Returns a list of problems; empty means the parts form a valid id. */
export function termIdPartIssues(parts: TermIdParts): string[] {
  const issues: string[] = []
  if (!SLUG_PART_PATTERN.test(parts.projectSlug ?? '')) issues.push('projectSlug must be lowercase letters, digits and hyphens')
  if (!SLUG_PART_PATTERN.test(parts.module ?? '')) issues.push('module must be lowercase letters, digits and hyphens')
  if (!isTermKind(parts.kind)) issues.push(`kind must be one of: ${TERM_KINDS.join(', ')}`)
  if (!isValidTermKey(parts.key)) issues.push(`key must match ${TERM_KEY_PATTERN} and be at most ${TERM_KEY_MAX_LENGTH} characters`)
  return issues
}

/** Builds the deterministic id. Throws on an invalid part — never builds a lookalike id. */
export function termId(parts: TermIdParts): string {
  const issues = termIdPartIssues(parts)
  if (issues.length > 0) throw new Error(`Invalid taxonomy term id: ${issues.join('; ')}`)
  return `${TERM_ID_PREFIX}.${parts.projectSlug}.${parts.module}.${parts.kind}.${parts.key}`
}

/** Parses an id (a `drafts.` prefix is tolerated). Returns null if it is not a valid term id. */
export function parseTermId(id: string): TermIdParts | null {
  const bare = id.startsWith('drafts.') ? id.slice('drafts.'.length) : id
  const segments = bare.split('.')
  if (segments.length !== 5 || segments[0] !== TERM_ID_PREFIX) return null
  const [, projectSlug, module, kind, key] = segments
  if (!isTermKind(kind)) return null
  const parts: TermIdParts = { projectSlug, module, kind, key }
  return termIdPartIssues(parts).length === 0 ? parts : null
}
