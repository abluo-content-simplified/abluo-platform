// ── Catalogue taxonomy limits (C1.3) — the single source ──────────────────────

import { MAX_LABEL_LENGTH } from '@/lib/taxonomy/rules'

/** D-21: up from the generic 200 ("large catalogues"). */
export const MAX_CATEGORIES = 300
/** D-21: Catalogue tags. */
export const MAX_TAGS = 200
/**
 * Levels (roots are level 1, depth 0). A safety rail against corrupt data, not a
 * product rule — the editor guides to ≤ 3 levels.
 */
export const MAX_DEPTH = 32
/** Today's `CATALOGUE_LIMITS.categories`. */
export const MAX_ADDITIONAL_CATEGORIES = 20
export const LABEL_MAX = MAX_LABEL_LENGTH
/** U+203A with spaces: "Food › Pizza › Bianche". */
export const PATH_SEPARATOR = ' › '
/** Samples in blockers and usage (IN_USE_ITEM_LIMIT). */
export const IN_USE_SAMPLE_LIMIT = 10
