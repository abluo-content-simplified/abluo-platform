// GROQ for the partner events API — module-level string constants so the
// fetchForTenant call-site guard can resolve and check them statically.
import { EVENT_V1_PROJECTION } from './event-contract'

/** Hard cap per Sanity read; the endpoint asks for at most MAX_LIMIT + 1. */
export const PARTNER_EVENTS_PAGE_SIZE = 201

export const PARTNER_EVENT_SITE_QUERY = /* groq */ `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{
  defaultLocale,
  supportedLocales,
  timeZone,
  locations[] { key, name, address, pin }
}`

/** Published events with (_updatedAt, publicId) > ($afterT, $afterId) and _updatedAt <= $upTo, oldest first. */
export const PARTNER_EVENTS_PAGE_QUERY = /* groq */ `*[
  _type == "event" &&
  projectSlug == $projectSlug &&
  !(_id in path("drafts.**")) &&
  !(_id in path("versions.**")) &&
  defined(publicId) &&
  dateTime(_updatedAt) <= dateTime($upTo) &&
  (dateTime(_updatedAt) > dateTime($afterT) || (dateTime(_updatedAt) == dateTime($afterT) && publicId > $afterId))
] | order(_updatedAt asc, publicId asc) [0...201] ${EVENT_V1_PROJECTION}`
