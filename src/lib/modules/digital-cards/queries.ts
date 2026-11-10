// ── Digital Cards module — website queries (ADR-049) ──────────────────────────
//
// Public delivery: every string here reads cards with DIGITAL_CARD_PUBLIC
// (publicFilterFor('digitalCard') + this project + published) and projects
// them with the fragments of projection.ts. The public-delivery coverage test
// and the People projection test scan this file. Bind $projectSlug
// (fetchForTenant does), $locale and $defaultLocale.
//
// Route resolution for /card/<name> (D5, D6):
//   1. DIGITAL_CARD_PERSON_QUERY          live card → render (person null → redirect /card)
//   2. DIGITAL_CARD_BY_RETIRED_NAME_QUERY a live card used this name → 308 /card/<urlName>
//   3. DIGITAL_CARD_ROUTE_STATE_QUERY     the card exists but is offline → redirect /card
//   4. otherwise 404
// For /card: DIGITAL_CARD_SITE_QUERY; null → DIGITAL_CARD_ROUTE_STATE_QUERY
// ($kind "site") exists → redirect to the homepage, else 404.

import { DIGITAL_CARD_TYPE } from './model'
import {
  DIGITAL_CARD_FIELDS,
  DIGITAL_CARD_PERSON_FIELD,
  DIGITAL_CARD_PUBLIC,
  DIGITAL_CARD_SITE_CARD_FIELD,
  DIGITAL_CARD_SITE_FIELDS,
} from './projection'

/** The project's live site card (/card). → DigitalCardSiteResult | null */
export const DIGITAL_CARD_SITE_QUERY = /* groq */ `*[${DIGITAL_CARD_PUBLIC} && kind == "site"] | order(_createdAt asc)[0]{
  ${DIGITAL_CARD_FIELDS},
  ${DIGITAL_CARD_SITE_FIELDS}
}`

/** A live person card by its current URL name. Binds $urlName. → DigitalCardPersonResult | null */
export const DIGITAL_CARD_PERSON_QUERY = /* groq */ `*[${DIGITAL_CARD_PUBLIC} && kind == "person" && urlName == $urlName][0]{
  ${DIGITAL_CARD_FIELDS},
  ${DIGITAL_CARD_PERSON_FIELD},
  ${DIGITAL_CARD_SITE_CARD_FIELD},
  ${DIGITAL_CARD_SITE_FIELDS}
}`

/** A live person card that USED this name (D5) → its current one. Binds $urlName. → DigitalCardRetiredResult | null */
export const DIGITAL_CARD_BY_RETIRED_NAME_QUERY = /* groq */ `*[${DIGITAL_CARD_PUBLIC} && kind == "person" && defined(urlName) && $urlName in retiredUrlNames][0]{ urlName }`

/**
 * Routing only — NOT public content (listed in NON_PUBLIC of the coverage
 * test): does a published card exist for this address in ANY lifecycle state,
 * and is it live. Returns no content, only kind, urlName and the live flag,
 * so an offline card redirects (D6) instead of 404ing.
 * Binds $kind ("site" | "person") and $urlName (any string for "site").
 * → DigitalCardRouteState | null
 */
export const DIGITAL_CARD_ROUTE_STATE_QUERY = /* groq */ `*[_type == "${DIGITAL_CARD_TYPE}" && projectSlug == $projectSlug && !(_id in path("drafts.**")) && kind == $kind && ($kind == "site" || urlName == $urlName || $urlName in retiredUrlNames)] | order(_createdAt asc)[0]{
  kind,
  urlName,
  "live": count(*[${DIGITAL_CARD_PUBLIC} && _id == ^._id]) > 0
}`

/** The hit endpoint's allow-list (D11): live cards of the project and their shown link keys. → DigitalCardKnownIds[] */
export const DIGITAL_CARD_KNOWN_IDS_QUERY = /* groq */ `*[${DIGITAL_CARD_PUBLIC} && defined(publicId)]{
  publicId,
  "linkKeys": coalesce(links[hidden != true]._key, [])
}`
