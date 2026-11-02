// ── Catalogue Studio posture — schema layer (C9 §9.3 layer 1) ────────────────
//
// `applyCataloguePosture(types)` wraps every Catalogue DOCUMENT type with a
// document-level `readOnly` callback (the whole form becomes read-only) that
// reads the posture store and FAILS CLOSED, and pins the always-read-only
// fields. Applied once, in sanity.config.ts, over the assembled schema — so the
// Catalogue schema files stay untouched by the posture.
//
// No Sanity import: the types are plain definition objects.

import { CATALOGUE_STUDIO_SCOPED, ALWAYS_READ_ONLY_FIELDS, catalogueReadOnly, isCatalogueStudioDoc, type PostureState } from './catalogue-posture'
import { postureStore } from './catalogue-posture-store'

type FieldDef = { name?: string; readOnly?: unknown }
type TypeDef = { name: string; type?: string; readOnly?: unknown; fields?: FieldDef[] }

type ReadOnlyArgs = { document?: Record<string, unknown> | null }

const SCOPED_TYPES = new Set(CATALOGUE_STUDIO_SCOPED.map((s) => s.type))

export function withCataloguePosture<T extends TypeDef>(type: T, getState: () => PostureState = postureStore.get, now: () => Date = () => new Date()): T {
  if (type.type !== 'document') return type
  if (!isCatalogueStudioDoc(type.name) && !SCOPED_TYPES.has(type.name)) return type
  // A shared type (taxonomyTerm) keeps its own fields, and its own readOnly is OR-ed, never replaced.
  const scoped = SCOPED_TYPES.has(type.name)
  const fields = scoped ? type.fields : type.fields?.map((f) => (f.name && ALWAYS_READ_ONLY_FIELDS.includes(f.name) ? { ...f, readOnly: true } : f))
  const own = type.readOnly
  return {
    ...type,
    ...(fields && { fields }),
    readOnly: (ctx: ReadOnlyArgs) =>
      own === true ||
      (typeof own === 'function' && (own as (c: ReadOnlyArgs) => boolean)(ctx) === true) ||
      catalogueReadOnly({ type: type.name, doc: ctx.document, state: getState(), now: now() }),
  }
}

/** Every Catalogue document type (and scoped shared types) of `types`, wrapped; everything else unchanged and in place. */
export function applyCataloguePosture<T extends TypeDef>(types: readonly T[]): T[] {
  return types.map((t) => withCataloguePosture(t))
}
