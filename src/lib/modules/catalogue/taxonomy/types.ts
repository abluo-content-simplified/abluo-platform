// ── Catalogue taxonomy types (contract C1.3) ─────────────────────────────────
// Pure type declarations. The names are the contract's; C5 (availability), C6
// (readiness), C7 (packs) and C8 (permissions) import them from here and never
// redefine them.

import type { ChannelAvailabilityRule, ChannelKey } from '../commerce/commerce-types'
import type { ItemProfile } from '../profiles'

export type { AvailabilityRuleValue, ChannelAvailabilityRule, ChannelAvailabilityState, ChannelKey, ScheduledOverride, Weekday } from '../commerce/commerce-types'

// ── identity ────────────────────────────────────────────────────────────────
/** isValidTermKey(); immutable once created. */
export type CategoryKey = string
/** Same pattern; a separate namespace from categories. */
export type TagKey = string
/** locale -> text; default locale required (on write), others optional. */
export type Localized = Record<string, string>

/**
 * D-6: a category rule is a COMPLETE availability rule (baseline + optional weekly
 * overrides) — never a bare tri-state. Absent channel == inherit; 'inherit' is never
 * stored. Present == the complete rule for that channel (replace, never merge — D-6.1).
 */
export type ChannelRules = Partial<Record<ChannelKey, ChannelAvailabilityRule>>

/** Result of primaryPath (X-3). C1 owns it; C5 imports it and walks nothing itself. */
export type PrimaryPath =
  | { kind: 'path'; keys: readonly CategoryKey[] }
  | { kind: 'none' }
  | { kind: 'broken'; reason: 'missingCategory' | 'cycle' | 'orphan'; keys: readonly CategoryKey[] }

// ── nodes ───────────────────────────────────────────────────────────────────
export type CategoryNode = {
  key: CategoryKey
  label: Localized
  /** Exactly one parent or root. */
  parentKey: CategoryKey | null
  /** Among siblings only (same parentKey); gaps of ORDER_STEP. */
  order: number
  channelRules: ChannelRules
  /** Brief §25; defaults for NEW items only. */
  defaultOptionListIds: string[]
  /** ISO; retires from new assignment, nothing else changes. */
  archivedAt: string | null
  /**
   * D-22 (C1.12) "Use for": the item profiles this branch serves. Meaningful on ROOT categories
   * only (descendants inherit; a child's own value is ignored). Absent/empty = all item types.
   */
  useFor?: readonly ItemProfile[]
  /** C1.12.1: the stored list held only unknown ids — applies to NO profile (a corrupt value never widens). */
  useForCorrupt?: true
}

export type TagNode = {
  key: TagKey
  label: Localized
  order: number
  archivedAt: string | null
  /** D-22 (C1.12): profiles this tag is used for. Absent/empty = all item types. */
  useFor?: readonly ItemProfile[]
  useForCorrupt?: true
}

/** D-22 (C1.12): "Use for" — absent or EMPTY = every item profile ("All item types"). */
export type UseFor = readonly ItemProfile[]

// ── tree (derived, never stored) ────────────────────────────────────────────
export type TreeIssueCode = 'duplicate-key' | 'orphan' | 'cycle' | 'depth-exceeded'
export type TreeIssue = { code: TreeIssueCode; key: CategoryKey; detail?: string }

export type CategoryTree = {
  readonly nodes: ReadonlyMap<CategoryKey, CategoryNode>
  /** Sibling order. */
  readonly roots: readonly CategoryKey[]
  /** Sibling order; every key present (maybe []). */
  readonly childrenOf: ReadonlyMap<CategoryKey, readonly CategoryKey[]>
  readonly parentOf: ReadonlyMap<CategoryKey, CategoryKey | null>
  /** Roots are 0. */
  readonly depthOf: ReadonlyMap<CategoryKey, number>
  /** Corrupt-data findings; [] for valid data. */
  readonly issues: readonly TreeIssue[]
}

// ── item assignment (stored on catalogueItem) ───────────────────────────────
export type CategoryAssignment = {
  primary: CategoryKey | null
  /** Disjoint from primary, no duplicates, <= MAX_ADDITIONAL_CATEGORIES. */
  additional: readonly CategoryKey[]
}

// ── paths ───────────────────────────────────────────────────────────────────
export type CategoryPath = {
  /** Root first, node last. */
  keys: readonly CategoryKey[]
  /** Label per key in the requested locale (with fallback). */
  segments: readonly string[]
  /** segments.join(' › ') */
  text: string
  /** Index into segments that used a fallback locale or the key itself. */
  fallbackAt: readonly number[]
  /** Per segment: locales (of the project's enabled set) that have no label. */
  missingLocales: readonly (readonly string[])[]
  /** fallbackAt.length === 0 */
  complete: boolean
}

export type PathContext = { locale: string; defaultLocale: string; locales: readonly string[] }

// ── delete: Tom's definition of "unused" (D-3) ──────────────────────────────
export type CategoryRef = { id: string; type: string; name: string }

export type CategoryReferenceKind =
  | 'item_primary'
  | 'item_additional'
  | 'automatic_listing'
  | 'publication_standard'
  | 'availability_policy'
  | 'other'

/** sample ≤ 10 (IN_USE_ITEM_LIMIT). */
export type CategoryReferenceHit = { count: number; sample: readonly CategoryRef[] }

/**
 * A reference source answers "what stored Catalogue data points at this category key,
 * other than the category node itself?". Sources are REGISTERED (reference-sources.ts);
 * later slices add theirs without touching deletionBlockers. Server-side only; always
 * project-scoped; draft-including.
 */
export type CategoryReferenceSource = {
  /** Stable, kebab-case. */
  id: string
  kind: CategoryReferenceKind
  /** Document type + field(s) that store a category key; used by the registry-completeness test. */
  stores: readonly { type: string; field: string }[]
  /** Draft + published copies of one document count once; archived documents count. Never counts the category node itself. */
  find(projectSlug: string, key: CategoryKey): Promise<CategoryReferenceHit>
  /** Absent ⇒ a hard blocker the person must resolve by editing the referring documents. */
  cleanup?: {
    preview(projectSlug: string, key: CategoryKey, to: CategoryKey | null): Promise<{ affected: number; sample: readonly CategoryRef[] }>
    /** Idempotent; chunked ≤ 100 documents. */
    apply(projectSlug: string, key: CategoryKey, to: CategoryKey | null): Promise<{ changed: number }>
  }
}

/** What the service passes to the pure function: one hit per registered source id. */
export type CategoryReferences = Readonly<
  Record<string, { source: Pick<CategoryReferenceSource, 'id' | 'kind'> & { cleanable: boolean }; hit: CategoryReferenceHit }>
>

export type DeletionBlockerCode =
  | 'unknown_category'
  | 'has_children'
  | 'used_as_primary'
  | 'used_as_additional'
  | 'referenced_by_listing'
  | 'referenced_by_standard'
  | 'referenced_by_availability_policy'
  | 'referenced_by_other'

export type DeletionBlocker = {
  code: DeletionBlockerCode
  count: number
  /** The registered source (absent for has_children / unknown_category). */
  sourceId?: string
  /** True when a counted, previewed reassignment/cleanup exists. */
  cleanable: boolean
  /** First 10. */
  sample: readonly (CategoryRef | { key: CategoryKey; label: Localized })[]
}

export type DeletionRoute = { capability: 'taxonomy.write' | 'setup.manage'; resolvable: boolean }

export type CategoryDeletionPlan =
  | { ok: true; steps: readonly { kind: 'move_children' | 'reassign_items' | 'cleanup_source'; sourceId?: string; count: number }[] }
  | { ok: false; code: 'category_cleanup_unresolvable' | 'category_unknown' | 'category_cycle'; blockers: readonly DeletionBlocker[] }

// ── moves ───────────────────────────────────────────────────────────────────
/** index among new siblings; omitted = last. */
export type MoveRequest = { key: CategoryKey; newParentKey: CategoryKey | null; index?: number }
export type MoveIssueCode =
  | 'category_unknown'
  | 'category_parent_unknown'
  | 'category_cycle'
  | 'category_depth_exceeded'
  | 'category_archived_parent'
export type MovePlan =
  | {
      ok: true
      /** Minimal set of nodes whose parentKey/order change (the moved node, plus siblings only if a renumber was unavoidable). */
      patches: readonly { key: CategoryKey; parentKey: CategoryKey | null; order: number }[]
    }
  | { ok: false; code: MoveIssueCode; key: CategoryKey; detail?: string }

export type AssignmentIssueCode = 'category_unknown' | 'category_primary_required' | 'category_archived_target' | 'category_duplicate' | 'category_too_many'
export type AssignmentValidation = { ok: true } | { ok: false; code: AssignmentIssueCode; key?: CategoryKey }

export type CategoryAssignmentState = 'ok' | 'none' | 'no_primary' | 'unknown_primary' | 'archived_primary'
