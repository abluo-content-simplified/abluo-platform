// ── Catalogue capabilities — the single map from operation to permission (C8 §8.4) ──
//
// Pure and browser-safe. Every Catalogue writer asks `capabilitiesFor(op)` and
// checks EVERY returned id (assertModuleAction) before any I/O; the dashboard
// enables or disables controls from the same answer. Editing includes
// publishing (K-5): there is no `*.publish` capability.
//
// The ids themselves are declared once, in the Catalogue manifest
// (registry.ts) — `CATALOGUE_CAPABILITIES` mirrors them and a test keeps the
// two equal.

export const CATALOGUE_CAPABILITIES = [
  'catalogue.item.read',
  'catalogue.item.write',
  'catalogue.item.delete',
  'catalogue.item.deletePublished',
  'catalogue.collection.write',
  'catalogue.collection.delete',
  'catalogue.collection.deletePublished',
  'catalogue.taxonomy.write',
  'catalogue.setup.manage',
  'catalogue.import.use',
  'catalogue.export.use',
  'catalogue.allergen.update',
  'catalogue.readiness.update',
] as const

export type CatalogueCapability = (typeof CATALOGUE_CAPABILITIES)[number]

export const isCatalogueCapability = (v: unknown): v is CatalogueCapability => typeof v === 'string' && (CATALOGUE_CAPABILITIES as readonly string[]).includes(v)

export type CatalogueOperation =
  | { op: 'item.create' | 'item.edit' | 'item.publish' | 'item.unpublish' | 'item.archive' | 'item.restore' | 'item.setSchedule' }
  | { op: 'item.delete'; published: boolean }
  | { op: 'item.reviewAllergens' }
  | { op: 'item.editAllergenContent' }
  | { op: 'item.overrideReadiness' }
  | { op: 'item.assignCategories'; createsCategory: boolean }
  | { op: 'item.setAvailabilityOverride' | 'item.setPrice' | 'item.attachOption' }
  | { op: 'collection.edit' | 'collection.publish' | 'collection.place' }
  | { op: 'collection.delete'; published: boolean }
  | { op: 'optionList.edit' | 'optionList.publish' | 'optionList.delete' }
  /** D-22 (C1.12.7): an option list's "Use for" — Setup permission on top of editing the list. */
  | { op: 'optionList.setUseFor' }
  | { op: 'term.create' | 'term.rename' | 'term.translate' | 'term.reorder' | 'term.deleteUnusedLeaf' }
  | { op: 'term.archive' | 'term.unarchive'; kind: 'category' | 'tag' }
  | { op: 'term.reparent' | 'term.reassign' | 'term.deleteInUse' | 'term.setAvailabilityRule' }
  /** D-22 (C1.12.7): "Use for" of a root category (setup.manage) or a tag (taxonomy.write, D-3 "manage tags"). */
  | { op: 'term.setUseFor'; kind: 'category' | 'tag' }
  | { op: 'setup.applyPack' | 'setup.channels' | 'setup.standards' | 'setup.publicWebsite' | 'setup.defaults' | 'setup.currency' }
  | { op: 'import.start' | 'import.confirm' | 'import.undo'; createsTerms: boolean }
  | { op: 'export.data' | 'export.pdf' | 'export.allergenRegister' }

export type CatalogueOperationId = CatalogueOperation['op']

/** Every operation id, for the exhaustive table test (P-11). */
export const CATALOGUE_OPERATION_IDS: readonly CatalogueOperationId[] = [
  'item.create', 'item.edit', 'item.publish', 'item.unpublish', 'item.archive', 'item.restore', 'item.setSchedule',
  'item.delete', 'item.reviewAllergens', 'item.editAllergenContent', 'item.overrideReadiness', 'item.assignCategories',
  'item.setAvailabilityOverride', 'item.setPrice', 'item.attachOption',
  'collection.edit', 'collection.publish', 'collection.place', 'collection.delete',
  'optionList.edit', 'optionList.publish', 'optionList.delete', 'optionList.setUseFor',
  'term.create', 'term.rename', 'term.translate', 'term.reorder', 'term.deleteUnusedLeaf',
  'term.archive', 'term.unarchive',
  'term.reparent', 'term.reassign', 'term.deleteInUse', 'term.setAvailabilityRule', 'term.setUseFor',
  'setup.applyPack', 'setup.channels', 'setup.standards', 'setup.publicWebsite', 'setup.defaults', 'setup.currency',
  'import.start', 'import.confirm', 'import.undo',
  'export.data', 'export.pdf', 'export.allergenRegister',
]

const never = (x: never): never => {
  throw new Error(`capabilitiesFor: unmapped operation ${JSON.stringify(x)}`)
}

/** PURE. The full set of capabilities this operation needs, all of which must hold. Deterministic; the C8 §8.4 table. */
export function capabilitiesFor(op: CatalogueOperation): readonly CatalogueCapability[] {
  switch (op.op) {
    case 'item.create':
    case 'item.edit':
    case 'item.publish':
    case 'item.unpublish':
    case 'item.archive':
    case 'item.restore':
    case 'item.setSchedule':
    case 'item.setAvailabilityOverride':
    case 'item.setPrice':
    case 'item.attachOption':
      return ['catalogue.item.write']
    case 'item.delete':
      return op.published ? ['catalogue.item.write', 'catalogue.item.delete', 'catalogue.item.deletePublished'] : ['catalogue.item.write', 'catalogue.item.delete']
    case 'item.reviewAllergens':
    case 'item.editAllergenContent':
      return ['catalogue.item.write', 'catalogue.allergen.update']
    case 'item.overrideReadiness':
      return ['catalogue.item.write', 'catalogue.readiness.update']
    case 'item.assignCategories':
      return op.createsCategory ? ['catalogue.item.write', 'catalogue.taxonomy.write'] : ['catalogue.item.write']
    case 'collection.edit':
    case 'collection.publish':
      return ['catalogue.collection.write']
    case 'collection.place':
      return ['catalogue.collection.write', 'catalogue.item.read']
    case 'collection.delete':
      return op.published
        ? ['catalogue.collection.write', 'catalogue.collection.delete', 'catalogue.collection.deletePublished']
        : ['catalogue.collection.write', 'catalogue.collection.delete']
    case 'optionList.edit':
    case 'optionList.publish':
      return ['catalogue.item.write']
    case 'optionList.delete':
      return ['catalogue.item.write', 'catalogue.item.delete']
    case 'optionList.setUseFor':
      return ['catalogue.item.write', 'catalogue.setup.manage']
    case 'term.create':
    case 'term.rename':
    case 'term.translate':
    case 'term.reorder':
    case 'term.deleteUnusedLeaf':
      return ['catalogue.taxonomy.write']
    case 'term.archive':
    case 'term.unarchive':
      return op.kind === 'category' ? ['catalogue.setup.manage'] : ['catalogue.taxonomy.write']
    case 'term.setUseFor':
      return op.kind === 'category' ? ['catalogue.setup.manage'] : ['catalogue.taxonomy.write']
    case 'term.reparent':
    case 'term.reassign':
    case 'term.deleteInUse':
    case 'term.setAvailabilityRule':
      return ['catalogue.setup.manage']
    case 'setup.applyPack':
    case 'setup.channels':
    case 'setup.standards':
    case 'setup.publicWebsite':
    case 'setup.defaults':
    case 'setup.currency':
      return ['catalogue.setup.manage']
    case 'import.start':
    case 'import.confirm':
    case 'import.undo':
      return op.createsTerms ? ['catalogue.import.use', 'catalogue.item.write', 'catalogue.taxonomy.write'] : ['catalogue.import.use', 'catalogue.item.write']
    case 'export.data':
    case 'export.pdf':
    case 'export.allergenRegister':
      return ['catalogue.export.use', 'catalogue.item.read']
    default:
      return never(op)
  }
}

/** PURE. Union over a plan of operations, deduplicated, in first-seen order. */
export function capabilitiesForPlan(ops: readonly CatalogueOperation[]): readonly CatalogueCapability[] {
  const out: CatalogueCapability[] = []
  for (const op of ops) for (const c of capabilitiesFor(op)) if (!out.includes(c)) out.push(c)
  return out
}

/** PURE. True when `permissions` hold every capability of `op` (UI hints; the server re-checks). */
export function canCatalogueOperation(permissions: readonly string[], op: CatalogueOperation): boolean {
  return capabilitiesFor(op).every((c) => permissions.includes(c))
}

/** The first capability of `op` that `permissions` lacks, or null (refusal shape, C8 §8.6). */
export function missingCapability(permissions: readonly string[], op: CatalogueOperation): CatalogueCapability | null {
  return capabilitiesFor(op).find((c) => !permissions.includes(c)) ?? null
}

/** C8 §8.6 — the refusal a server action returns. Names the capability; leaks nothing else. */
export type CatalogueRefusal = { ok: false; error: 'forbidden'; capability?: CatalogueCapability }
