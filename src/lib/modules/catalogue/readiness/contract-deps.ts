// ── Readiness — types owned by OTHER Catalogue contracts (placeholders) ──────
//
// ⚠️ Written against the accepted contract signatures (C1, C2, C3, C4, C5),
// NOT imported from their owners: in R1 those modules are built by parallel
// workstreams and do not exist in this tree yet. When the owner's module lands,
// replace each alias below by a re-export from it (`export type { … } from …`)
// and delete the placeholder. Nothing here may grow behaviour: the readiness
// engine only reads these shapes, it never computes them (C6 §6.2 "facts, not
// documents"; K-9 "one implementation per concept").

/** C2 — a channel's stable machine key ('dine-in', 'takeaway', 'delivery' …). */
export type ChannelKey = string
/** C3 — a format's stable key within an item (the implicit default format has one too). */
export type FormatKey = string
/** C1 — a category's stable immutable key. */
export type CategoryKey = string
/** A catalogueCollection document id. */
export type CollectionId = string

/** C4/C5 — what availability and price questions are asked about (C6 §6.4a maps a PublicationContext onto it). */
export type OfferingContext = { kind: 'general' } | { kind: 'channel'; channel: ChannelKey }

/** C1 — `categoryAssignmentState(tree, assignment)`. */
export type CategoryAssignmentState = 'ok' | 'none' | 'no_primary' | 'unknown_primary' | 'archived_primary'

/** C1 — `primaryPath(tree, primary)`. Only `kind` and the broken `reason` are read here. */
export type PrimaryPath =
  | { kind: 'ok'; keys?: readonly CategoryKey[] }
  | { kind: 'none' }
  | { kind: 'broken'; reason: 'missingCategory' | 'cycle' | 'orphan' }

/** C1 — the project's category tree. Readiness reads only which keys exist and their parent (subtree scope). */
export type CategoryTree = { nodes: ReadonlyArray<{ key: CategoryKey; parent: CategoryKey | null; archived?: boolean }> }

/** C4 — `priceCoverage(format, oc, channels, weekProfile)`: time-independent. */
export type PriceCoverage = { kind: 'full' } | { kind: 'partial'; gaps: readonly unknown[] } | { kind: 'none' }

/** C3/C4 save-time issue (`format.*`, `price.*`) or a runtime price code. `key` = the offer/format/price row it is about. */
export type PriceIssue = { code: string; key?: string }

/** C5 — `effectiveRule(..., ctx)`, instant-free. Readiness reads only its `issues` (availability.* codes). */
export type EffectiveRule = { issues: ReadonlyArray<{ code: string }> }

/** C10-6 — per-project migration markers in module config `catalogueMigrations` (ISO strings). Gate rule activation. */
export type CatalogueMigrationState = { taxonomy?: string; commerce?: string; packHistory?: string; publicName?: string }
