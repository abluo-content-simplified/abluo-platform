/**
 * FAQ sets — the ADR-032 lifecycle descriptor (ADR-037 D8).
 *
 *   ARCHIVE   refused while PUBLIC content shows the set: a published page /
 *             legacy home page whose FAQ section lists it, or a live post that
 *             attaches it. References from drafts or archived content do not
 *             block (D8). The refusal names the blockers (`in_use`).
 *   DELETE    permanent delete (archived sets) and delete of a never-published
 *             draft are refused while ANY document references the set, in any
 *             version (draft, published, archived; strong or weak).
 *   PUBLISH   a set references nothing, so there are no dependencies.
 *
 * Permissions: `delete` (a never-published draft) is the WRITE permission
 * (contract: faq.set.write covers deleting a draft), `deletePublished` is
 * faq.set.delete (permanent delete additionally needs it).
 *
 * The error class lives here (not in faq-sets.ts) so the descriptor can build
 * it without a circular import; faq-sets.ts re-exports it.
 */
import type { LifecycleClient, LifecycleDescriptor, LifecycleErrorCode, Referrer } from '@/lib/lifecycle/service'
import { publicFilterFor } from '@/lib/lifecycle/public-types'
import { labelOf } from '@/lib/modules/catalogue/validation'

export const FAQ_READ_PERMISSION = 'faq.set.read'
export const FAQ_WRITE_PERMISSION = 'faq.set.write'
export const FAQ_DELETE_PERMISSION = 'faq.set.delete'

export type FaqSetErrorCode =
  | 'forbidden'
  | 'not_found'
  | 'invalid_field'
  | 'invalid_value'
  | 'too_large'
  | 'conflict'
  | 'in_use'
  | 'archive_first'
  | 'archived'
  | 'failed'

export interface FaqSetUsage {
  kind: 'page' | 'post'
  id: string
  title: string
  published: boolean
}

export class FaqSetError extends Error {
  constructor(
    readonly code: FaqSetErrorCode,
    message: string,
    /** in_use → where the set is shown. */
    readonly detail?: { usedIn?: FaqSetUsage[] }
  ) {
    super(message)
    this.name = 'FaqSetError'
  }
}

const FAQ_SET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export function isFaqSetId(id: unknown): id is string {
  return typeof id === 'string' && FAQ_SET_ID.test(id)
}

const CODE: Record<LifecycleErrorCode, FaqSetErrorCode> = {
  forbidden: 'forbidden',
  not_found: 'not_found',
  conflict: 'conflict',
  invalid_value: 'invalid_value',
  archived: 'archived',
  archive_first: 'archive_first',
  in_use: 'in_use',
  unpublished_dependencies: 'failed',
  failed: 'failed',
}

const fail = (code: LifecycleErrorCode, message: string) => new FaqSetError(CODE[code], message)

const RAW = { perspective: 'raw' } as const

// ── Queries (exported so tests assert exactly what runs) ─────────────────────

/** Published pages (and the legacy home page) whose FAQ section lists the set. */
export const FAQ_PAGE_REFERRERS = `*[_type in ["page", "homePage"] && projectSlug == $projectSlug && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && $id in sections[_type == "faqSection"].faqSets[]._ref]{ _id, _type, "label": title }`
/** Live posts (the shared visibility rule) that attach the set. */
export const FAQ_POST_REFERRERS = `*[_type == "post" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && !(_id in path("versions.**")) && $id in faqSets[]._ref && ${publicFilterFor('post')}]{ _id, _type, "label": title }`
/** EVERY document of the project that references the set in any version (weak references too), except its own versions. */
export const FAQ_DELETE_REFERRERS = `*[projectSlug == $projectSlug && references($id) && !(_id in [$id, $draftId]) && !(_id in path("versions.**"))]{ _id, _type, "label": coalesce(title, internalName, name) }`

type Row = { _id: string; _type?: string; label?: unknown }

const FALLBACK: Record<string, string> = { page: 'Page', homePage: 'Home page', post: 'Post' }

/** Rows → Referrers, one per document (a published row and its draft are one). */
function named(rows: readonly Row[] | null | undefined): Referrer[] {
  const seen = new Map<string, Referrer>()
  for (const r of rows ?? []) {
    const id = r._id.replace(/^drafts\./, '')
    const type = typeof r._type === 'string' ? r._type : 'unknown'
    if (!seen.has(id)) seen.set(id, { id, type, label: labelOf(r.label, FALLBACK[type] ?? 'Untitled') })
  }
  return [...seen.values()]
}

async function publicReferrers(client: LifecycleClient, id: string, projectSlug: string): Promise<Referrer[]> {
  const [pages, posts] = await Promise.all([
    client.fetch<Row[] | null>(FAQ_PAGE_REFERRERS, { id, projectSlug }, RAW),
    client.fetch<Row[] | null>(FAQ_POST_REFERRERS, { id, projectSlug }, RAW),
  ])
  return named([...(pages ?? []), ...(posts ?? [])])
}

async function allReferrers(client: LifecycleClient, id: string, projectSlug: string): Promise<Referrer[]> {
  return named(await client.fetch<Row[] | null>(FAQ_DELETE_REFERRERS, { id, draftId: `drafts.${id}`, projectSlug }, RAW))
}

export const FAQ_SET_LIFECYCLE: LifecycleDescriptor = {
  type: 'faqSet',
  rule: 'optional',
  permissions: {
    write: FAQ_WRITE_PERMISSION,
    delete: FAQ_WRITE_PERMISSION,
    deletePublished: FAQ_DELETE_PERMISSION,
  },
  isId: isFaqSetId,
  fail,
  refuseArchiveWhileReferenced: true,
  referrers: publicReferrers,
  deleteReferrers: allReferrers,
  label: (doc) => labelOf(doc.internalName, 'FAQ set'),
}
