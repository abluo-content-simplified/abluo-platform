'use server'

/**
 * Client dashboard — People server actions (ADR-043).
 *
 * Thin wrappers over `src/lib/api/persons.ts`, which holds every check.
 * Identity is re-resolved server-side on each call; the URL's projectSlug only
 * picks one of the caller's own grants. Failures collapse to opaque codes
 * (`PersonErrorCode`); `detail.usedIn` says where a person is used (in_use).
 */

import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { searchLinkTargets, PostLinkSearchError, type LinkTargetResult } from '@/lib/api/post-link-search'
import { BODY_LINK_TARGET_TYPES } from '@/lib/links/target-types'
import {
  anonymisePerson,
  bulkUpdatePersons,
  createPerson,
  discardPersonDraft,
  getPersonActivity,
  getPersonForEdit,
  listPersons,
  movePersonContact,
  openPersonForEdit,
  PEOPLE_WRITE_PERMISSION,
  PersonError,
  publishPersonDraft,
  reorderPersons,
  runPersonLifecycle,
  savePersonDraft,
  savePersonPrivate,
  searchPersons,
  type PersonBulkOp,
  type PersonBulkResult,
  type PersonErrorCode,
  type PersonListItem,
  type PersonPickerItem,
  type PersonLifecycleOp,
  type PersonSite,
  type PersonSnapshot,
  type PersonUsage,
} from '@/lib/api/persons'
import { shortenPersonBio } from '@/lib/api/person-ai'
import { translatePersonFields, type PersonTranslateResult } from '@/lib/api/person-translate'
import type { PersonTranslatableField } from '@/lib/api/persons'
import { TranslateError, type TranslateErrorCode } from '@/lib/translate/types'
import { PostAiError, type PostAiErrorCode } from '@/lib/api/post-ai'
import type { ActivityItem } from '@/lib/lifecycle/activity'

export type PersonActionError = 'unauthenticated' | PersonErrorCode | PostAiErrorCode | TranslateErrorCode
type Fail = { ok: false; error: PersonActionError; detail?: { usedIn?: PersonUsage[] } }
type Result<T> = ({ ok: true } & T) | Fail

async function run<T>(projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>): Promise<Result<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  try {
    return { ok: true, ...(await fn(ctx, grant.projectId)) }
  } catch (error) {
    if (error instanceof PersonError) return { ok: false, error: error.code, ...(error.detail && { detail: error.detail as { usedIn?: PersonUsage[] } }) }
    if (error instanceof PostAiError) return { ok: false, error: error.code }
    if (error instanceof TranslateError) {
      if (error.code === 'provider_error' || error.code === 'network_error') console.error('[translate] provider failure', error.message)
      return { ok: false, error: error.code }
    }
    if (error instanceof PostLinkSearchError) return { ok: false, error: 'invalid_value' }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

export async function listPersonsAction(input: { projectSlug: string }): Promise<Result<{ persons: PersonListItem[]; site: PersonSite }>> {
  return run(input?.projectSlug, (ctx, pid) => listPersons(ctx, pid))
}

export async function getPersonAction(input: { projectSlug: string; id: string }): Promise<Result<{ person: PersonSnapshot }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ person: await getPersonForEdit(ctx, pid, input.id) }))
}

export async function createPersonAction(input: { projectSlug: string; firstName: string; lastName: string }): Promise<Result<{ id: string; publicId: string; rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => createPerson(ctx, pid, { firstName: input.firstName, lastName: input.lastName }))
}

/** Creates drafts.<id> from the published person when missing. Call before the first edit. */
export async function openPersonForEditAction(input: { projectSlug: string; id: string }): Promise<Result<{ id: string; rev: string; created: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => openPersonForEdit(ctx, pid, { id: input.id }))
}

export async function savePersonDraftAction(input: { projectSlug: string; id: string; rev: string; set: Record<string, unknown> }): Promise<Result<{ rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => savePersonDraft(ctx, pid, { id: input.id, rev: input.rev, set: input.set }))
}

export async function publishPersonDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<{ rev: string }>> {
  return run(input?.projectSlug, (ctx, pid) => publishPersonDraft(ctx, pid, { id: input.id, rev: input.rev }))
}

export async function discardPersonDraftAction(input: { projectSlug: string; id: string; rev: string }): Promise<Result<object>> {
  return run(input?.projectSlug, async (ctx, pid) => {
    await discardPersonDraft(ctx, pid, { id: input.id, rev: input.rev })
    return {}
  })
}

/** Private details (Supabase): birthday, notes, private contacts — saved directly, never through the draft. */
export async function savePersonPrivateAction(input: {
  projectSlug: string
  id: string
  version: number | null
  birthday?: string | null
  notes?: string
  contacts?: unknown
}): Promise<Result<{ version: number }>> {
  return run(input?.projectSlug, (ctx, pid) =>
    savePersonPrivate(ctx, pid, {
      id: input.id,
      version: input.version,
      ...(input.birthday !== undefined && { birthday: input.birthday }),
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.contacts !== undefined && { contacts: input.contacts as never }),
    })
  )
}

export async function movePersonContactAction(input: {
  projectSlug: string
  id: string
  rev: string
  key: string
  to: 'public' | 'private'
  privateVersion: number | null
}): Promise<Result<{ rev: string; privateVersion: number }>> {
  return run(input?.projectSlug, (ctx, pid) => movePersonContact(ctx, pid, { id: input.id, rev: input.rev, key: input.key, to: input.to, privateVersion: input.privateVersion }))
}

/** The site-wide order: the full list of person ids, in their new order. */
export async function reorderPersonsAction(input: { projectSlug: string; ids: string[] }): Promise<Result<object>> {
  return run(input?.projectSlug, async (ctx, pid) => {
    await reorderPersons(ctx, pid, { ids: input.ids })
    return {}
  })
}

/** The PersonPicker's search (and the lookup of already chosen people by id). */
export async function searchPersonsAction(input: {
  projectSlug: string
  query?: string
  limit?: number
  includeArchived?: boolean
  ids?: string[]
}): Promise<Result<{ items: PersonPickerItem[] }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({
    items: await searchPersons(ctx, pid, { query: input.query, limit: input.limit, includeArchived: input.includeArchived, ids: input.ids }),
  }))
}

/** Archive / restore (owner), delete a never-published draft or an archived person for good (owner, only when unreferenced). */
export async function personLifecycleAction(input: { projectSlug: string; id: string; op: PersonLifecycleOp }): Promise<Result<{ rev: string | null; privateRemoved?: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => runPersonLifecycle(ctx, pid, { id: input.id, op: input.op }))
}

/**
 * Several people at once (list selection): add to / remove from a group, show on
 * the website / hide (write), archive (owner). Per-person results; archived and
 * anonymised people are skipped, never an error.
 */
export async function bulkUpdatePersonsAction(input: { projectSlug: string; ids: string[]; op: PersonBulkOp; group?: string }): Promise<Result<PersonBulkResult>> {
  return run(input?.projectSlug, (ctx, pid) => bulkUpdatePersons(ctx, pid, { ids: input.ids, op: input.op, ...(input.group !== undefined && { group: input.group }) }))
}

/** Anonymise (owner): clears photo, bios, contacts, links and private data; cannot be undone. */
export async function anonymisePersonAction(input: { projectSlug: string; id: string }): Promise<Result<{ rev: string; privateRemoved: boolean }>> {
  return run(input?.projectSlug, (ctx, pid) => anonymisePerson(ctx, pid, { id: input.id }))
}

export async function getPersonActivityAction(input: { projectSlug: string; id: string }): Promise<Result<{ items: ActivityItem[] }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ items: await getPersonActivity(ctx, pid, { id: input.id }) }))
}

/** The bio editor's link search: pages, posts, news, events and Catalogue items/collections (same targets as FAQ answers). */
export async function searchPersonLinkTargetsAction(input: {
  projectSlug: string
  locale: string
  query?: string
  ids?: string[]
}): Promise<Result<{ results: LinkTargetResult[] }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({
    results: await searchLinkTargets(ctx, pid, { locale: input.locale, query: input.query, ids: input.ids }, { permission: PEOPLE_WRITE_PERMISSION, types: BODY_LINK_TARGET_TYPES }),
  }))
}

/** "Shorten": a suggested short bio derived from the long bio. Writes nothing. */
export async function shortenPersonBioAction(input: { projectSlug: string; locale: string; blocks: unknown[] }): Promise<Result<{ text: string }>> {
  return run(input?.projectSlug, (ctx, pid) => shortenPersonBio(ctx, pid, { locale: input.locale, blocks: input.blocks }))
}

/**
 * Translate button on People fields (ADR-023). People write permission AND the
 * Translate module installed; provider, quota and metering as POST /api/translate.
 * The source text is read from the saved person; the result is returned, not
 * written — the editor saves it through savePersonDraft with its status.
 */
export async function translatePersonFieldsAction(input: {
  projectSlug: string
  id: string
  fields: PersonTranslatableField[]
  sourceLocale: string
}): Promise<Result<PersonTranslateResult>> {
  return run(input?.projectSlug, (ctx, pid) => translatePersonFields(ctx, pid, { id: input.id, fields: input.fields, sourceLocale: input.sourceLocale }))
}
