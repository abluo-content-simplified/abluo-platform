// ── Catalogue Studio posture (C9 §9.3; PURE — no React, no Sanity imports) ───
//
// K-7: the dashboard is the editor. Catalogue DOCUMENTS are read-only in
// Studio by default; the only sanctioned Studio write path is break-glass
// (C9 §9.4, migration 062 — NOT in R1), so in R1 every LOCKED Catalogue document
// is always read-only and offers no document action. Exception: types with no
// dashboard editor yet (CATALOGUE_STUDIO_EDITED — `cataloguePage`) stay Studio-edited.
//
// Read-only Studio is a UI control, NOT a security boundary (D-18): anyone
// with API access can still write. The compensating controls are the
// detective webhook and the daily reconciliation, which accept only
// transactions whose id starts with a prefix in CATALOGUE_WRITER_PREFIXES.
//
// Imported by sanity.config.ts, the Studio schema wrapper and tests.

/** Every Catalogue DOCUMENT type (C9 §9.3, REVIEW X-16). A test ties this to the registry (T-3). */
export const CATALOGUE_STUDIO_TYPES = [
  'catalogueItem',
  'catalogueCollection',
  'catalogueOptionList',
  'cataloguePage',
  'catalogueTaxonomy', // C1  (catalogue-taxonomy.<slug>)
  'cataloguePackHistory', // C7  (catalogue-packs.<slug>)
  'cataloguePublicationStandards', // C6  (catalogue-standards.<slug>)
  'cataloguePackRun', // C7  in-progress marker for an interrupted pack application
] as const
// Any further Catalogue document type is added here in the SAME commit that defines it — T-3 fails until then.

export type CatalogueStudioType = (typeof CATALOGUE_STUDIO_TYPES)[number]

/**
 * Posture classification exceptions — "Studio-edited until a dashboard editor exists" (C9 R1
 * implementation note). These types are classified (T-3) but NOT locked: no read-only form, their
 * normal document actions, their pre-R1 templates. Locking a type whose only editor is Studio removes
 * its only editor (same reasoning as REVIEW C-18 for taxonomyTerm). An entry is removed in the SAME
 * commit that ships the type's dashboard editor.
 */
export const CATALOGUE_STUDIO_EDITED: Readonly<Partial<Record<CatalogueStudioType, string>>> = Object.freeze({
  cataloguePage:
    'The public Catalogue landing page (sections, SEO) is edited only in Studio; the dashboard has no editor for it yet, so the R1 lock would leave nobody able to edit or publish it.',
})

export const isStudioEditedCatalogueType = (type: string): boolean => Object.prototype.hasOwnProperty.call(CATALOGUE_STUDIO_EDITED, type)

/** The Catalogue document types the R1 lock applies to (every classified type minus the Studio-edited exceptions). */
export const CATALOGUE_LOCKED_TYPES: readonly CatalogueStudioType[] = Object.freeze(CATALOGUE_STUDIO_TYPES.filter((t) => !isStudioEditedCatalogueType(t)))

const STUDIO_TYPES: ReadonlySet<string> = new Set(CATALOGUE_LOCKED_TYPES)

export type LockPhase = 'R1' | 'R2'

/**
 * Documents of a SHARED type that belong to Catalogue, with the release at
 * which their lock starts (REVIEW C-18): Catalogue `taxonomyTerm`s lock only
 * with R2 (Setup exists), because locking earlier removes their only editor.
 */
export const CATALOGUE_STUDIO_SCOPED: ReadonlyArray<{ type: string; lockFrom: LockPhase; owns: (doc: Record<string, unknown>) => boolean }> = [
  { type: 'taxonomyTerm', lockFrom: 'R2', owns: (d) => d.module === 'catalogue' },
]

/**
 * 'R2' since the R2 release (C10-6): Catalogue Setup and the Catalogue taxonomy/config writers exist,
 * so Catalogue `taxonomyTerm`s are read-only and the Catalogue config is locked (config-lock.ts).
 */
export const CATALOGUE_LOCK_PHASE: LockPhase = 'R2'

const phaseRank = (p: LockPhase) => (p === 'R1' ? 1 : 2)

/**
 * C9 §9.5 / D-18 — the transaction-id prefixes of every authorised server
 * writer of a Catalogue document. ONE list, read by the detective webhook, the
 * daily reconciliation and test T-11:
 *   abluo-dash-   dashboard (= DASHBOARD_TRANSACTION_PREFIX, lifecycle/audit.ts)
 *   abluo-gate-   Studio break-glass operator route (through the gate)
 *   abluo-pack-   pack application
 *   abluo-setup-  Setup / taxonomy / standards services
 *   abluo-migr-   migration scripts: `abluo-migr-<migrationId>-<uuid>`
 */
export const CATALOGUE_WRITER_PREFIXES = ['abluo-dash-', 'abluo-gate-', 'abluo-pack-', 'abluo-setup-', 'abluo-migr-'] as const
export type CatalogueWriter = 'dash' | 'gate' | 'pack' | 'setup' | 'migr'

const WRITER_PREFIX: Record<CatalogueWriter, (typeof CATALOGUE_WRITER_PREFIXES)[number]> = {
  dash: 'abluo-dash-',
  gate: 'abluo-gate-',
  pack: 'abluo-pack-',
  setup: 'abluo-setup-',
  migr: 'abluo-migr-',
}

const MIGRATION_ID = /^[a-z0-9][a-z0-9-]{0,47}$/

/**
 * The Sanity transaction id a Catalogue server writer commits with
 * (Mutations API `transactionId`, unique per dataset). `unique` is injected
 * (randomUUID on the server) so this stays pure. Migration scripts must name
 * their migration: `abluo-migr-<migrationId>-<unique>`.
 */
export function catalogueTransactionId(writer: CatalogueWriter, unique: string, opts: { migrationId?: string } = {}): string {
  if (!unique || !/^[A-Za-z0-9-]{1,64}$/.test(unique)) throw new Error('catalogueTransactionId: unique part must be 1–64 of [A-Za-z0-9-]')
  if (writer === 'migr') {
    if (!opts.migrationId || !MIGRATION_ID.test(opts.migrationId)) throw new Error('catalogueTransactionId: a migration transaction needs a migrationId')
    return `${WRITER_PREFIX.migr}${opts.migrationId}-${unique}`
  }
  return `${WRITER_PREFIX[writer]}${unique}`
}

/** True when a transaction was made by an authorised Catalogue writer (webhook / reconciliation check). */
export function isAuthorisedCatalogueTransaction(transactionId: unknown): boolean {
  return typeof transactionId === 'string' && CATALOGUE_WRITER_PREFIXES.some((p) => transactionId.startsWith(p) && transactionId.length > p.length)
}

// ── Posture state (break-glass grants; always empty in R1) ───────────────────

export type BreakGlassGrant = { id: string; projectSlug: string; expiresAt: string; enabledBy: 'abluo-admin' }
/** loaded = false (fetch failed / not yet / endpoint absent) ⇒ FAIL CLOSED. */
export type PostureState = { grants: readonly BreakGlassGrant[]; loaded: boolean }

export const CLOSED_POSTURE: PostureState = Object.freeze({ grants: Object.freeze([]) as readonly BreakGlassGrant[], loaded: false })

export function isCatalogueStudioDoc(type: string, doc?: Record<string, unknown> | null, phase: LockPhase = CATALOGUE_LOCK_PHASE): boolean {
  if (STUDIO_TYPES.has(type)) return true
  const scoped = CATALOGUE_STUDIO_SCOPED.find((s) => s.type === type)
  return !!scoped && phaseRank(phase) >= phaseRank(scoped.lockFrom) && !!doc && scoped.owns(doc)
}

/**
 * `document.actions` receives no document, only its id. A Catalogue `taxonomyTerm` is recognisable
 * by its deterministic id (`term.<project>.catalogue.<kind>.<key>`, ids.ts termId), so from R2 its
 * built-in publish/delete/duplicate actions are removed like every other locked Catalogue document's.
 */
const CATALOGUE_TERM_ID = /^(?:drafts\.)?term\.[a-z0-9]+(?:-[a-z0-9]+)*\.catalogue\.(?:category|tag)\.[^.]+$/
export function isCatalogueScopedDocumentId(type: string, documentId: unknown, phase: LockPhase = CATALOGUE_LOCK_PHASE): boolean {
  return type === 'taxonomyTerm' && phaseRank(phase) >= phaseRank('R2') && typeof documentId === 'string' && CATALOGUE_TERM_ID.test(documentId)
}

const liveGrant = (state: PostureState, now: Date, projectSlug?: unknown) =>
  state.loaded && state.grants.some((g) => (projectSlug === undefined || g.projectSlug === projectSlug) && Date.parse(g.expiresAt) > now.getTime())

/** true = read-only. Read-only unless (state.loaded && an unexpired grant exists for the document's projectSlug). */
export function catalogueReadOnly(args: { type: string; doc: Record<string, unknown> | null | undefined; state: PostureState; now: Date; phase?: LockPhase }): boolean {
  if (!isCatalogueStudioDoc(args.type, args.doc, args.phase)) return false
  const slug = args.doc?.projectSlug
  if (typeof slug !== 'string' || !slug) return true
  return !liveGrant(args.state, args.now, slug)
}

const DISCARD_ACTIONS: ReadonlySet<string> = new Set(['discardChanges', 'discard'])

/**
 * document.actions for a Catalogue doc. `document.actions` has no document, so
 * "posture on" = any unexpired grant; the server re-checks the project at
 * publish (the action is a door, the route is the lock).
 *   posture off → [] (no publish, unpublish, delete, duplicate, restore, schedule — nothing);
 *   posture on  → [gate, discard] and nothing else. Without a gate action (R1:
 *   break-glass and its route are not built) only discard remains.
 */
export function catalogueDocumentActions<A extends { action?: string | null }>(prev: readonly A[], args: { state: PostureState; now: Date; gate?: A }): A[] {
  if (!liveGrant(args.state, args.now)) return []
  const discard = prev.filter((a) => typeof a.action === 'string' && DISCARD_ACTIONS.has(a.action))
  return args.gate ? [args.gate, ...discard] : discard
}

/** Catalogue templates are removed from every "+ New" menu, always — documents are created by the dashboard (even in break-glass). Studio-edited types keep their pre-R1 templates. */
export const CATALOGUE_TEMPLATE_IDS: readonly string[] = Object.freeze(CATALOGUE_LOCKED_TYPES.flatMap((t) => [t, `${t}ProjectOwned`]))

/**
 * Fields that stay `readOnly: true` unconditionally on Catalogue documents,
 * break-glass included (C9 §9.3 layer 1, C13 §13.3).
 */
export const ALWAYS_READ_ONLY_FIELDS: readonly string[] = Object.freeze(['projectSlug', 'publicId', 'readinessOverrides', 'complianceTasks', 'publishedAt', 'expiresAt', 'archivedAt', 'archivedBy'])
