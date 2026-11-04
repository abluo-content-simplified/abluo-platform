'use server'

/**
 * Client dashboard — People editor helpers (ADR-043 D8), next to `actions.ts`:
 * the duplicate check, "View on website" and the photo's focus point. Thin
 * wrappers; every check is in `persons-duplicates.ts` / `persons-live.ts`.
 * The focus point is SAVED through the Media screen's own action
 * (`updateMediaPhotoAction`, Media permission) — it lives on the asset.
 */

import { resolveProjectAction } from '@/lib/api/project-action'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { PersonError, type PersonErrorCode } from '@/lib/api/persons'
import { findPossibleDuplicates } from '@/lib/api/persons-duplicates'
import { getPersonLiveInfo, getPersonPhotoFocal, type PersonPhotoFocal } from '@/lib/api/persons-live'
import type { PossibleDuplicate } from '@/lib/modules/people/duplicates'
import type { PersonLiveInfo } from '@/lib/modules/people/live-url'

type Fail = { ok: false; error: 'unauthenticated' | PersonErrorCode }
type Result<T> = ({ ok: true } & T) | Fail

async function run<T>(projectSlug: unknown, fn: (ctx: TenantAuthorizationContext, projectId: string) => Promise<T>): Promise<Result<T>> {
  const access = await resolveProjectAction(projectSlug)
  if (!access.ok) return { ok: false, error: access.error }
  const { ctx, grant } = access
  try {
    return { ok: true, ...(await fn(ctx, grant.projectId)) }
  } catch (error) {
    if (error instanceof PersonError) return { ok: false, error: error.code }
    if (error instanceof TenantAuthorizationError) return { ok: false, error: 'forbidden' }
    return { ok: false, error: 'failed' }
  }
}

/** People of this project with the same name (either order; archived included, anonymised excluded). */
export async function findPossibleDuplicatesAction(input: { projectSlug: string; firstName: string; lastName: string }): Promise<Result<{ duplicates: PossibleDuplicate[] }>> {
  return run(input?.projectSlug, (ctx, pid) => findPossibleDuplicates(ctx, pid, { firstName: input.firstName, lastName: input.lastName }))
}

/** The published person's facts for "View on website" (see `personLiveUrl`). */
export async function getPersonLiveInfoAction(input: { projectSlug: string; id: string }): Promise<Result<{ info: PersonLiveInfo }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ info: await getPersonLiveInfo(ctx, pid, { id: input.id }) }))
}

/** The photo asset's original URL, revision and focus point (Media permission). */
export async function getPersonPhotoFocalAction(input: { projectSlug: string; assetId: string }): Promise<Result<{ photo: PersonPhotoFocal }>> {
  return run(input?.projectSlug, async (ctx, pid) => ({ photo: await getPersonPhotoFocal(ctx, pid, { assetId: input.assetId }) }))
}
