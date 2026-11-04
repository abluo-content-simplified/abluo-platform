/**
 * People — "is this person already here?" (ADR-043 D8). Used by the New person
 * dialog and the PersonPicker's "Add new person" before a duplicate is made.
 *
 * Enforcement: `people.person.read` first (before any I/O); the search is bound
 * to the GRANT's project (the caller never names one); published and draft
 * people count, archived ones too, anonymised ones never. The match itself is
 * pure (`src/lib/modules/people/duplicates.ts`).
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { matchDuplicates, personNameKeys, type DuplicateCandidate, type PossibleDuplicate } from '@/lib/modules/people/duplicates'
import { PEOPLE_READ_PERMISSION, PersonError, isPersonId } from '@/lib/api/persons-lifecycle'

const RAW = { perspective: 'raw' } as const
const MAX_ROWS = 2000

/** Exported so tests assert exactly what runs. */
export const PERSON_DUPLICATES_QUERY = /* groq */ `*[_type == "person" && projectSlug == $projectSlug && !(_id in path("versions.**"))]
  | order(_updatedAt desc)[0...${MAX_ROWS}]{ _id, publicId, firstName, lastName, displayName, archivedAt, anonymisedAt }`

type Row = { _id?: unknown; publicId?: unknown; firstName?: unknown; lastName?: unknown; displayName?: unknown; archivedAt?: unknown; anonymisedAt?: unknown }
export type PersonDuplicatesDeps = { client?: { fetch: (query: string, params: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> } }

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** One candidate per person: the draft's name when there is a draft, archived/anonymised from either version. */
export function candidatesFromRows(rows: readonly Row[]): DuplicateCandidate[] {
  const byId = new Map<string, { draft?: Row; published?: Row }>()
  for (const row of rows) {
    const raw = str(row._id)
    const isDraft = raw.startsWith('drafts.')
    const id = isDraft ? raw.slice('drafts.'.length) : raw
    if (!isPersonId(id)) continue
    const entry = byId.get(id) ?? {}
    if (isDraft) entry.draft = row
    else entry.published = row
    byId.set(id, entry)
  }
  return [...byId].map(([id, e]) => {
    const row = (e.draft ?? e.published)!
    return {
      id,
      publicId: str(row.publicId),
      firstName: str(row.firstName),
      lastName: str(row.lastName),
      displayName: str(row.displayName),
      archived: Boolean(str(e.published?.archivedAt) || str(e.draft?.archivedAt)),
      anonymised: Boolean(str(e.published?.anonymisedAt) || str(e.draft?.anonymisedAt)),
    }
  })
}

/** People of this project with the same normalised name (either order). Read permission. */
export async function findPossibleDuplicates(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { firstName: string; lastName: string },
  deps: PersonDuplicatesDeps = {}
): Promise<{ duplicates: PossibleDuplicate[] }> {
  assertModuleAction(ctx, projectId, PEOPLE_READ_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)
  if (!grant) throw new PersonError('forbidden', 'No access to this project.')
  if (!input || typeof input.firstName !== 'string' || typeof input.lastName !== 'string') throw new PersonError('invalid_value', 'A first and a last name.')
  if (!personNameKeys(input.firstName, input.lastName).length) return { duplicates: [] }
  const client = deps.client ?? sanityWriteClient
  const rows = (await client.fetch(PERSON_DUPLICATES_QUERY, { projectSlug: grant.projectSlug }, RAW)) as Row[] | null
  return { duplicates: matchDuplicates(input, candidatesFromRows(rows ?? [])) }
}
