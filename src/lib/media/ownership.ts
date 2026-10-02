/**
 * Cross-tenant reference guard for Media Library writes (ADR-015 R3, admin
 * edition).
 *
 * `POST /api/media` takes `tenant` (a `client` document id) and an optional
 * `project` (a `project` document id) from the form body and writes both as
 * references on the new `mediaAsset`, plus a denormalised `projectSlug`. Before
 * this guard nothing checked that the project BELONGS to the tenant, so one
 * request could file an asset under tenant A while stamping it with tenant B's
 * `projectSlug` — and every website and dashboard read keys on `projectSlug`,
 * so the image would surface in tenant B's library and pickers.
 *
 * The route is admin-only, so this is integrity rather than privilege; but the
 * same primitive is what a future tenant-facing upload must call, and it is
 * pure so it can be pinned by a unit test.
 *
 * `MEDIA_OWNERSHIP_QUERY` is ONE round trip, run BEFORE the asset upload so a
 * rejected request leaves no orphaned binary behind.
 */

export const MEDIA_OWNERSHIP_QUERY = /* groq */ `{
  "tenantExists": count(*[_type == "client" && _id == $tenant && !(_id in path("drafts.**"))]) > 0,
  "project": *[_type == "project" && _id == $project && !(_id in path("drafts.**"))][0]{
    projectSlug,
    "clientId": clientRef._ref
  }
}`

export interface MediaOwnershipRow {
  tenantExists?: boolean | null
  project?: { projectSlug?: string | null; clientId?: string | null } | null
}

export type MediaOwnershipResult =
  | { ok: true; projectSlug: string | null }
  | { ok: false; error: 'unknown_tenant' | 'unknown_project' | 'project_not_owned_by_tenant' }

/**
 * Decides whether a (tenant, project?) pair may be written onto a mediaAsset.
 * Fail-closed: a missing row, a project without an owner, or a project owned
 * by a different client all reject.
 */
export function evaluateMediaOwnership(
  row: MediaOwnershipRow | null | undefined,
  tenantId: string,
  projectId: string | null | undefined
): MediaOwnershipResult {
  if (!row?.tenantExists) return { ok: false, error: 'unknown_tenant' }
  if (!projectId) return { ok: true, projectSlug: null }
  const project = row.project
  if (!project) return { ok: false, error: 'unknown_project' }
  if (!project.clientId || project.clientId !== tenantId) {
    return { ok: false, error: 'project_not_owned_by_tenant' }
  }
  return { ok: true, projectSlug: project.projectSlug || null }
}
