// ── People — the draft preview read (profile page preview route) ──────────────
//
// PERSON_BY_SLUG_QUERY's projection over ONE document by id, read with
// perspective "raw" so it can be the draft (`drafts.<id>`) or the published
// person. Authenticated preview route only (signed token, see
// src/lib/preview/authorize.ts) — never public delivery. Visibility/archived
// rules are deliberately NOT applied (an editor previews a person who is not
// yet "page"/listed); anonymised people never render.

import { PERSON_PUBLIC_FIELDS } from './projection'

export const PERSON_DRAFT_PREVIEW_QUERY = /* groq */ `
  *[_type == "person" && projectSlug == $projectSlug && _id == $docId && !defined(anonymisedAt)][0] {
    "slugMap": slug,
    ${PERSON_PUBLIC_FIELDS}
  }
`
