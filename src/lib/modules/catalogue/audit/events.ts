// ── Catalogue audit events — kinds, payloads, builders (C12 §12.3; pure, browser-safe) ──
//
// Content-free by contract: ids, keys, codes, counts, hashes, versions, enums.
// Never names, descriptions, prices, free-text notes, override reasons, import
// cell values, file names, search strings or emails (C12 "What is
// deliberately not recorded"). The one exception is `public_name.migrated`
// (K-2: the tenant's own navigation label, needed to roll back).
//
// Storage: Supabase `catalogue_audit_log` (migration 061). Writer: ./writer.ts.

import type { AllergenDeclarationStatus, AllergenInvalidationCause, AllergenKey, ReviewBasis } from '../allergens'
import type { BatchOp } from '../list-model'
import type { ChannelAvailabilityState } from '../commerce/commerce-types'
import type { ReadinessCode, RuleLevel } from '../readiness/types'

/** C12 §12.3 — every kind. Order = the contract's list. */
export const CATALOGUE_AUDIT_KINDS = [
  'pack.applied',
  'pack.updated',
  'category.rule_changed',
  'category.restructured',
  'taxonomy.use_for_changed',
  'channel.activated',
  'channel.deactivated',
  'channel.removed',
  'channel.default_changed',
  'standard.changed',
  'allergen.reviewed',
  'allergen.invalidated',
  'import.started',
  'import.completed',
  'import.failed',
  'import.undone',
  'bulk.executed',
  'export.snapshot',
  'readiness.override_recorded',
  'readiness.override_expired',
  'availability.schedule_changed',
  'compliance.task_created',
  'allergen.linked_invalidated',
  'allergen.dependency_removed',
  'public_name.migrated',
  'migration.commerce',
  'migration.taxonomy',
  'migration.pack_history',
  'pack.interrupted',
  'studio.break_glass_enabled',
  'studio.break_glass_ended',
  'studio.break_glass_publish',
  'studio.write_outside_gate',
] as const

export type CatalogueAuditKind = (typeof CATALOGUE_AUDIT_KINDS)[number]

/** The SQL CHECK of migration 061 on `kind`, verbatim. A test runs it over every kind (A-18/A-19). */
export const AUDIT_KIND_PATTERN = /^[a-z]+(_[a-z]+)*(\.[a-z]+(_[a-z]+)*){1,2}$/

export const AUDIT_SCOPES = ['project', 'item', 'collection', 'category', 'channel', 'standard', 'import', 'export'] as const
export type AuditScope = (typeof AUDIT_SCOPES)[number]
export type AuditOutcome = 'ok' | 'refused' | 'failed'
export type AuditActorKind = 'user' | 'studio' | 'system'
export type AuditActor = { kind: AuditActorKind; id: string | null; support?: boolean }

// ── Payload helper types (owned elsewhere; content-free summaries) ──────────
/** C2 — the effective channel state (owner: commerce/commerce-types.ts). */
export type { ChannelAvailabilityState }
/** Content-free summary of a C5a schedule: counts and a hash, never times or labels. */
export type ScheduleSummary = { baseline: ChannelAvailabilityState; overrides: number; daysCovered: number; fingerprint: string }
export type RuleSummary = 'inherit' | ScheduleSummary
/** Derived from C5 `AvailabilityImpact` by `impactCounts` (owned by the producer slice with C5). */
export type ImpactCounts = { items: number; formats: number; toAvailable: number; toUnavailable: number; shieldedByOverride: number }
type Counts = { items: number; formats?: number; collections?: number }
export type BulkPublishMode = 'publishReady' | 'allOrNothing'

export type CatalogueAuditPayload = {
  'pack.applied': { packId: string; packVersion: number; added: { categories: number; tags: number; collections: number; sections: number; formats: number; optionGroups: number; channelsSuggested: number }; equivalentExisting: number; conflictsResolved: number }
  'pack.updated': { packId: string; fromVersion: number; toVersion: number; added: Record<string, number> }
  'category.rule_changed': { categoryKey: string; channel: string | null; before: RuleSummary; after: RuleSummary; impact: ImpactCounts }
  'category.restructured': { op: 'move' | 'delete' | 'reassign'; categoryKey: string; fromParent?: string | null; toParent?: string | null; reassignedTo?: string; impact: Counts }
  /** D-22 (C1.12.7): registry profile ids only (never labels) + the count of items newly incompatible. */
  'taxonomy.use_for_changed': { target: 'category' | 'tag' | 'optionList'; key: string; before: string[]; after: string[]; newlyIncompatible: number }
  'channel.activated': { channelKey: string; defaultAvailability: ChannelAvailabilityState; impact: ImpactCounts }
  'channel.deactivated': { channelKey: string; impact: ImpactCounts }
  'channel.default_changed': { channelKey: string; before: ScheduleSummary; after: ScheduleSummary; impact: ImpactCounts }
  'channel.removed': { channelKey: string; cleanup: { categoryRules: number; itemRules: number; formatRules: number; prices: number } }
  'standard.changed': { standardKey: string; fromVersion: number | null; toVersion: number; rules: { added: string[]; removed: string[]; levelChanged: Array<{ code: string; from: RuleLevel; to: RuleLevel }> }; overridesExpired: number }
  'allergen.reviewed': { itemId: string; status: 'containsListedAllergens' | 'noneDeclared'; contains: AllergenKey[]; mayContain: AllergenKey[]; basis: ReviewBasis; riskAssessmentConfirmed: boolean; declarationVersion: number; previousStatus: AllergenDeclarationStatus; scope: 'item' | 'choice'; choiceKey?: string }
  'allergen.invalidated': { itemId: string; cause: Exclude<AllergenInvalidationCause, 'linkedItemChanged'>; previousStatus: AllergenDeclarationStatus }
  'allergen.linked_invalidated': { parentItemId: string; linkedItemId: string; choiceKey?: string; trigger: 'linkedItemPublished' | 'combinedPublication'; previousStatus: AllergenDeclarationStatus; taskId: string }
  'allergen.dependency_removed': { itemId: string; what: 'optionRemoved' | 'optionListDetached'; listId?: string; choiceKey?: string; previousStatus: AllergenDeclarationStatus }
  'compliance.task_created': { taskId: string; itemId: string; reason: 'linkedItemChanged'; createdDraft: boolean; linkedItemId: string }
  'availability.schedule_changed': { level: 'item' | 'format'; targetKey: string; channel: string | null; before: ScheduleSummary; after: ScheduleSummary; affected: { items: number; formats: number } }
  'import.started': { batchId: string; sourceKind: 'csv' | 'xlsx' | 'paste'; sourceFingerprint: string; rows: number }
  'import.completed': { batchId: string; created: number; updated: number; skipped: number; invalid: number; createdTerms: number }
  'import.failed': { batchId: string; stage: 'parse' | 'map' | 'match' | 'apply'; code: string; appliedBeforeFailure: number }
  'import.undone': { batchId: string; removedDrafts: number; revertedFields: number; blockedByLaterEdits: number }
  'bulk.executed': { bulkId: string; op: BatchOp | 'assignCategory' | 'assignPrimary' | 'place' | 'channelOverride' | 'priceUpdate' | 'attachOption' | 'edit'; mode?: BulkPublishMode; requested: number; done: number; blocked: number; skipped: number; blockedByCode: Partial<Record<ReadinessCode, number>> }
  'export.snapshot': { snapshotId: string; format: 'csv' | 'xlsx' | 'pdf'; template?: string; scope: { kind: 'all' | 'filtered' | 'selected'; count: number }; locale?: string; channel?: string; contextKey: string; readiness: { ready: number; readyWithWarnings: number; blocked: number }; sourceRevision: string; policyVersion?: string }
  'readiness.override_recorded': { itemId: string; ruleCode: string; contextKey: string; standard: string; standardVersion: number }
  'readiness.override_expired': { itemId: string; ruleCode: string; contextKey: string; cause: 'resolved' | 'changed' | 'standardChanged' | 'revoked' }
  'public_name.migrated': { migrationId: string; action: 'copy' | 'drop'; old: Record<string, string>; new: Record<string, string> | null; discarded: Record<string, string> | null }
  'migration.commerce': { migrationId: string; items: number; formats: number; prices: number; legacyOffersKept: number; equivalence: 'verified' | 'diffNonEmpty' }
  'migration.taxonomy': { migrationId: string; categories: number; tags: number; itemsAssigned: number; itemsUnassigned: number }
  'migration.pack_history': { migrationId: string; converted: Array<{ packId: string; packVersion: number }> }
  'pack.interrupted': { packId: string; packVersion: number; stage: string; resumable: boolean }
  'studio.break_glass_enabled': { grantId: string; minutes: number }
  'studio.break_glass_ended': { grantId: string; how: 'expired' | 'ended' }
  'studio.break_glass_publish': { grantId: string; documentType: string; documentId: string; documents: number }
  'studio.write_outside_gate': { documentType: string; documentId: string; transactionId: string; detectedBy: 'webhook' | 'reconciliation' }
}

// Type-level exhaustiveness (A-02): every kind has a payload type and vice versa.
type _EveryKindHasPayload = Exclude<CatalogueAuditKind, keyof CatalogueAuditPayload> extends never ? true : never
type _EveryPayloadIsAKind = Exclude<keyof CatalogueAuditPayload, CatalogueAuditKind> extends never ? true : never
export const AUDIT_TYPES_EXHAUSTIVE: [_EveryKindHasPayload, _EveryPayloadIsAKind] = [true, true]

/**
 * C12 §12.5 — who sees a row (A-14):
 *   'item'      the item's Activity (anyone with catalogue.item.read);
 *   'setup'     Catalogue → Setup → Overview → Activity (catalogue.setup.manage);
 *   'internal'  Abluo staff only (admin project page / Needs your attention).
 * Only `ok` rows are ever shown to clients.
 */
export const AUDIT_VISIBILITY: Readonly<Record<CatalogueAuditKind, 'item' | 'setup' | 'internal'>> = Object.freeze({
  'pack.applied': 'setup',
  'pack.updated': 'setup',
  'category.rule_changed': 'setup',
  'category.restructured': 'setup',
  'taxonomy.use_for_changed': 'setup',
  'channel.activated': 'setup',
  'channel.deactivated': 'setup',
  'channel.removed': 'setup',
  'channel.default_changed': 'setup',
  'standard.changed': 'setup',
  'allergen.reviewed': 'item',
  'allergen.invalidated': 'item',
  'import.started': 'setup',
  'import.completed': 'setup',
  'import.failed': 'setup',
  'import.undone': 'setup',
  'bulk.executed': 'setup',
  'export.snapshot': 'setup',
  'readiness.override_recorded': 'item',
  'readiness.override_expired': 'item',
  'availability.schedule_changed': 'item',
  'compliance.task_created': 'item',
  'allergen.linked_invalidated': 'item',
  'allergen.dependency_removed': 'item',
  'public_name.migrated': 'setup',
  'migration.commerce': 'setup',
  'migration.taxonomy': 'setup',
  'migration.pack_history': 'setup',
  'pack.interrupted': 'setup',
  'studio.break_glass_enabled': 'setup',
  'studio.break_glass_ended': 'setup',
  'studio.break_glass_publish': 'setup',
  'studio.write_outside_gate': 'internal',
})

/** The `scope` column for a kind (C12 per-kind table). */
export function auditScopeOf<K extends CatalogueAuditKind>(kind: K, detail: CatalogueAuditPayload[K]): AuditScope {
  switch (kind) {
    case 'category.rule_changed':
    case 'category.restructured':
      return 'category'
    case 'taxonomy.use_for_changed':
      // Categories and tags share the taxonomy scope; an option list is project-level (the SQL scope set has no option-list value).
      return (detail as CatalogueAuditPayload['taxonomy.use_for_changed']).target === 'optionList' ? 'project' : 'category'
    case 'channel.activated':
    case 'channel.deactivated':
    case 'channel.removed':
    case 'channel.default_changed':
      return 'channel'
    case 'standard.changed':
      return 'standard'
    case 'import.started':
    case 'import.completed':
    case 'import.failed':
    case 'import.undone':
      return 'import'
    case 'export.snapshot':
      return 'export'
    case 'allergen.reviewed':
    case 'allergen.invalidated':
    case 'allergen.linked_invalidated':
    case 'allergen.dependency_removed':
    case 'compliance.task_created':
    case 'readiness.override_recorded':
    case 'readiness.override_expired':
    case 'availability.schedule_changed':
    case 'studio.write_outside_gate':
      return 'item'
    case 'studio.break_glass_publish':
      return (detail as CatalogueAuditPayload['studio.break_glass_publish']).documentType === 'catalogueCollection' ? 'collection' : 'item'
    default:
      return 'project'
  }
}

// ── Payload validation (A-01): field allowlist, short strings, size cap ─────

/** 8 KB cap, as the SQL CHECK (pg_column_size(detail) < 8192); measured on the JSON text, a safe upper bound. */
export const AUDIT_DETAIL_MAX_BYTES = 8192
const MAX_STRING = 64
const MAX_LABEL = 200

/** Top-level keys allowed per kind (derived from the payload types; a test keeps them in step). */
export const AUDIT_DETAIL_KEYS: Readonly<Record<CatalogueAuditKind, readonly string[]>> = Object.freeze({
  'pack.applied': ['packId', 'packVersion', 'added', 'equivalentExisting', 'conflictsResolved'],
  'pack.updated': ['packId', 'fromVersion', 'toVersion', 'added'],
  'category.rule_changed': ['categoryKey', 'channel', 'before', 'after', 'impact'],
  'category.restructured': ['op', 'categoryKey', 'fromParent', 'toParent', 'reassignedTo', 'impact'],
  'taxonomy.use_for_changed': ['target', 'key', 'before', 'after', 'newlyIncompatible'],
  'channel.activated': ['channelKey', 'defaultAvailability', 'impact'],
  'channel.deactivated': ['channelKey', 'impact'],
  'channel.default_changed': ['channelKey', 'before', 'after', 'impact'],
  'channel.removed': ['channelKey', 'cleanup'],
  'standard.changed': ['standardKey', 'fromVersion', 'toVersion', 'rules', 'overridesExpired'],
  'allergen.reviewed': ['itemId', 'status', 'contains', 'mayContain', 'basis', 'riskAssessmentConfirmed', 'declarationVersion', 'previousStatus', 'scope', 'choiceKey'],
  'allergen.invalidated': ['itemId', 'cause', 'previousStatus'],
  'allergen.linked_invalidated': ['parentItemId', 'linkedItemId', 'choiceKey', 'trigger', 'previousStatus', 'taskId'],
  'allergen.dependency_removed': ['itemId', 'what', 'listId', 'choiceKey', 'previousStatus'],
  'compliance.task_created': ['taskId', 'itemId', 'reason', 'createdDraft', 'linkedItemId'],
  'availability.schedule_changed': ['level', 'targetKey', 'channel', 'before', 'after', 'affected'],
  'import.started': ['batchId', 'sourceKind', 'sourceFingerprint', 'rows'],
  'import.completed': ['batchId', 'created', 'updated', 'skipped', 'invalid', 'createdTerms'],
  'import.failed': ['batchId', 'stage', 'code', 'appliedBeforeFailure'],
  'import.undone': ['batchId', 'removedDrafts', 'revertedFields', 'blockedByLaterEdits'],
  'bulk.executed': ['bulkId', 'op', 'mode', 'requested', 'done', 'blocked', 'skipped', 'blockedByCode'],
  'export.snapshot': ['snapshotId', 'format', 'template', 'scope', 'locale', 'channel', 'contextKey', 'readiness', 'sourceRevision', 'policyVersion'],
  'readiness.override_recorded': ['itemId', 'ruleCode', 'contextKey', 'standard', 'standardVersion'],
  'readiness.override_expired': ['itemId', 'ruleCode', 'contextKey', 'cause'],
  'public_name.migrated': ['migrationId', 'action', 'old', 'new', 'discarded'],
  'migration.commerce': ['migrationId', 'items', 'formats', 'prices', 'legacyOffersKept', 'equivalence'],
  'migration.taxonomy': ['migrationId', 'categories', 'tags', 'itemsAssigned', 'itemsUnassigned'],
  'migration.pack_history': ['migrationId', 'converted'],
  'pack.interrupted': ['packId', 'packVersion', 'stage', 'resumable'],
  'studio.break_glass_enabled': ['grantId', 'minutes'],
  'studio.break_glass_ended': ['grantId', 'how'],
  'studio.break_glass_publish': ['grantId', 'documentType', 'documentId', 'documents'],
  'studio.write_outside_gate': ['documentType', 'documentId', 'transactionId', 'detectedBy'],
})

/**
 * Keys any row may carry, added by the writer rather than the producer:
 * `support` (actor in support mode), `capability` (a refusal names the missing
 * permission, internal), `code` (the error code of a refused/failed attempt).
 */
const COMMON_DETAIL_KEYS: ReadonlySet<string> = new Set(['support', 'capability', 'code'])

/** Locale-keyed label maps allowed (K-2) in `public_name.migrated` only. */
const LABEL_MAPS: ReadonlySet<string> = new Set(['old', 'new', 'discarded'])

function valueOk(v: unknown, depth: number, maxString: number): boolean {
  if (v === null || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v === 'string') return v.length <= maxString
  if (depth > 4) return false
  if (Array.isArray(v)) return v.length <= 200 && v.every((x) => valueOk(x, depth + 1, maxString))
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).every(([k, x]) => k.length <= MAX_STRING && valueOk(x, depth + 1, maxString))
  return false
}

/**
 * A-01 — true when `detail` may be stored for `kind`: an object, only the
 * kind's own top-level keys, every string ≤ 64 characters (≤ 200 for the K-2
 * label maps of `public_name.migrated`), numbers finite, nested at most a few
 * levels, and the whole JSON under 8 KB. Free text cannot pass.
 */
export function validateAuditDetail(kind: CatalogueAuditKind, detail: unknown): detail is object {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return false
  const allowed = AUDIT_DETAIL_KEYS[kind]
  if (!allowed) return false
  for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
    if (!allowed.includes(k) && !COMMON_DETAIL_KEYS.has(k)) return false
    if (v === undefined) continue
    const labelMap = kind === 'public_name.migrated' && LABEL_MAPS.has(k)
    if (!valueOk(v, 0, labelMap ? MAX_LABEL : MAX_STRING)) return false
  }
  return new TextEncoder().encode(JSON.stringify(detail)).length < AUDIT_DETAIL_MAX_BYTES
}

// ── Entry builder (C12 §12.3 `auditEntry`) ──────────────────────────────────

export type CatalogueAuditEntry = {
  projectId: string
  kind: CatalogueAuditKind
  scope: AuditScope
  targetId?: string
  actorKind: AuditActorKind
  actorId: string | null
  outcome: AuditOutcome
  transactionId?: string
  correlationId?: string
  detail: object
  occurredAt?: string
}

export function auditEntry<K extends CatalogueAuditKind>(
  kind: K,
  args: { projectId: string; targetId?: string; actor: AuditActor; correlationId?: string; transactionId?: string; outcome?: AuditOutcome; detail: CatalogueAuditPayload[K]; occurredAt?: string }
): CatalogueAuditEntry {
  const detail = args.actor.support ? { ...args.detail, support: true } : args.detail
  return {
    projectId: args.projectId,
    kind,
    scope: auditScopeOf(kind, args.detail),
    ...(args.targetId !== undefined && { targetId: args.targetId }),
    actorKind: args.actor.kind,
    actorId: args.actor.id,
    outcome: args.outcome ?? 'ok',
    ...(args.transactionId !== undefined && { transactionId: args.transactionId }),
    ...(args.correlationId !== undefined && { correlationId: args.correlationId }),
    detail,
    ...(args.occurredAt !== undefined && { occurredAt: args.occurredAt }),
  }
}
