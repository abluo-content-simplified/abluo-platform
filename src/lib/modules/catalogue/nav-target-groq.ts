// ── Catalogue — navigation link targets in GROQ (ADR-033 Amendment G) ────────
//
// The ONE reading of a catalogue link target: which documents a link may reach
// and the fields catalogueNavPath() (nav-target.ts) turns into a path. Used by
// the navigation projection (NAV_LINK_FIELDS in src/lib/sanity/queries.ts,
// which re-exports these) and by the Digital Card page links (ADR-049
// Amendment B). Strings only; small imports, so browser-reachable modules may
// import it.

import { publicFilterForAnyType } from '@/lib/lifecycle/public-types'
import { visibilityFilter } from './visibility'

/**
 * Which catalogue documents a navigation link may reach (ADR-033 Amendment G):
 * this project's, public by the lifecycle rule, visible to an explicit
 * reference. Exported for the Digital Card links (ADR-049 Amendment B), which
 * reach the same targets.
 */
export const NAV_CATALOGUE_TARGET_FILTER = /* groq */ `projectSlug == $projectSlug && string::startsWith(_type, "catalogue") && ${publicFilterForAnyType()} && ${visibilityFilter('explicitReference')}`

/** A catalogue target as catalogueNavPath() (nav-target.ts) reads it: slug in the REQUEST locale only, segment of the enabled installation. */
export const NAV_CATALOGUE_TARGET_FIELDS = /* groq */ `
    "type": _type,
    hasPage,
    "slug": slug[$locale].current,
    "segment": *[_type == "project" && projectSlug == $projectSlug][0].moduleInstallations[moduleId == "catalogue" && enabled != false][0].config.publicSegment`

