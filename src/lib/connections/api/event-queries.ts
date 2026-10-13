// GROQ for the partner events API — module-level string constants so the
// fetchForTenant call-site guard can resolve and check them statically.
import { EVENT_V1_FIELDS } from './event-contract'
import { AFTER_CURSOR_GROQ, EFFECTIVE_CHANGE_MS_GROQ } from './sync'

/** Hard cap per Sanity read; the endpoint asks for at most MAX_LIMIT + 1. */
export const PARTNER_EVENTS_PAGE_SIZE = 201

export const PARTNER_EVENT_SITE_QUERY = /* groq */ `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{
  defaultLocale,
  supportedLocales,
  timeZone,
  locations[] { key, name, address, pin }
}`

/**
 * One page of the boundary-aware sync (ADR-032 D11, see sync.ts): published
 * events whose effective change time `_eff` (latest of _updatedAt, publishedAt,
 * expiresAt, archivedAt that is ≤ $upToMs) is after ($afterMs, $afterId),
 * ordered by (_eff, publicId). Integer milliseconds throughout. Documents
 * created after the window end have no _eff and are left for the next sweep.
 */
export const PARTNER_EVENTS_PAGE_QUERY = /* groq */ `*[
  _type == "event" &&
  projectSlug == $projectSlug &&
  !(_id in path("drafts.**")) &&
  !(_id in path("versions.**")) &&
  defined(publicId)
]{${EVENT_V1_FIELDS}, "_eff": ${EFFECTIVE_CHANGE_MS_GROQ}}${AFTER_CURSOR_GROQ} | order(_eff asc, publicId asc) [0...201]`

/** Which of these public ids still have a published event in the project (tombstone suppression). */
export const PARTNER_EVENTS_EXISTING_QUERY = /* groq */ `*[
  _type == "event" &&
  projectSlug == $projectSlug &&
  !(_id in path("drafts.**")) &&
  !(_id in path("versions.**")) &&
  publicId in $publicIds
].publicId`
