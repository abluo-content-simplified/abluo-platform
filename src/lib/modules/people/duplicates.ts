// ── People module — duplicate detection (pure, browser-safe) ─────────────────
//
// "Anna Rossi is already in your People": two people are the same name when
// their names are equal after folding case, accents, punctuation and spacing,
// in either order (first last / last first). A person with one name only
// ("Madonna") matches only another person with that one name. Anonymised
// people never match (their name is gone); archived people do.

/** Case-, accent-, punctuation- and whitespace-insensitive form of one name part. */
export function normalisePersonName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** The comparison keys of a name: "first last" and "last first" (one key when there is one name). */
export function personNameKeys(firstName: unknown, lastName: unknown): string[] {
  const first = normalisePersonName(firstName)
  const last = normalisePersonName(lastName)
  const keys = new Set<string>()
  const a = [first, last].filter(Boolean).join(' ')
  const b = [last, first].filter(Boolean).join(' ')
  if (a) keys.add(a)
  if (b) keys.add(b)
  return [...keys]
}

export interface DuplicateCandidate {
  id: string
  publicId: string
  firstName: string
  lastName: string
  displayName: string
  archived: boolean
  anonymised: boolean
}

export interface PossibleDuplicate {
  id: string
  publicId: string
  name: string
  archived: boolean
}

export const DUPLICATE_RESULT_LIMIT = 5

/** The existing people whose name equals the typed one (see above). Anonymised people are skipped. */
export function matchDuplicates(input: { firstName: unknown; lastName: unknown }, candidates: readonly DuplicateCandidate[]): PossibleDuplicate[] {
  const wanted = new Set(personNameKeys(input.firstName, input.lastName))
  if (!wanted.size) return []
  const out: PossibleDuplicate[] = []
  for (const c of candidates) {
    if (c.anonymised) continue
    const keys = [...personNameKeys(c.firstName, c.lastName), ...(c.displayName ? [normalisePersonName(c.displayName)] : [])]
    if (!keys.some((k) => wanted.has(k))) continue
    out.push({ id: c.id, publicId: c.publicId, name: c.displayName.trim() || [c.firstName, c.lastName].filter(Boolean).join(' '), archived: c.archived })
    if (out.length >= DUPLICATE_RESULT_LIMIT) break
  }
  return out
}
