// ── Catalogue rollout scripts — export artefact (C10-6 P / P′) and import (S) ──
//
// An export is a folder with `catalogue.ndjson` (one document per line, sorted
// by _id, raw perspective) and `manifest.json` (counts, sha256). It is the
// rollback artefact (P for the rehearsal, P′ for the production data steps) and
// is kept untouched until R3 is accepted. Exports hold real content: they live
// under backups/ (git-ignored), never in docs/.

import { createHash } from 'node:crypto'
import { EXPORT_FILTER, EXPORT_TYPES, catalogueProjects, idClassOf, idCounts, sortDocs, type Doc } from './docs'
import type { Mutation } from './mutations'

export const EXPORT_FILE = 'catalogue.ndjson'
export const MANIFEST_FILE = 'manifest.json'

export type ExportManifest = {
  kind: 'catalogue-export'
  version: 1
  label: string
  dataset: string
  sanityProjectId: string
  exportedAt: string
  file: string
  sha256: string
  bytes: number
  documents: number
  byType: Record<string, { published: number; drafts: number; versions: number; total: number }>
  projects: { slug: string; items: number }[]
  filter: string
}

export const toNdjson = (docs: readonly Doc[]) => sortDocs(docs).map((d) => JSON.stringify(d)).join('\n') + (docs.length ? '\n' : '')
export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

export function parseNdjson(text: string): Doc[] {
  const t = text.trim()
  if (!t) return []
  if (t.startsWith('[')) return JSON.parse(t)
  return t.split('\n').filter(Boolean).map((l) => JSON.parse(l))
}

export function buildManifest(docs: readonly Doc[], ndjson: string, meta: { label: string; dataset: string; sanityProjectId: string; exportedAt: string }): ExportManifest {
  const byType: ExportManifest['byType'] = {}
  for (const type of [...new Set(docs.map((d) => d._type))].sort()) byType[type] = idCounts(docs.filter((d) => d._type === type))
  return {
    kind: 'catalogue-export',
    version: 1,
    ...meta,
    file: EXPORT_FILE,
    sha256: sha256(ndjson),
    bytes: Buffer.byteLength(ndjson, 'utf8'),
    documents: docs.length,
    byType,
    projects: catalogueProjects(docs).map((v) => ({ slug: v.slug, items: docs.filter((d) => d._type === 'catalogueItem' && d.projectSlug === v.slug).length })),
    filter: EXPORT_FILTER.replace(/\s+/g, ' ').trim(),
  }
}

export type ExportCheck = { ok: true; docs: Doc[]; manifest: ExportManifest } | { ok: false; code: 'manifestInvalid' | 'checksumMismatch' | 'countMismatch'; message: string }

/** An export is used only when its checksum and counts still match the manifest. */
export function checkExport(ndjson: string, manifestText: string): ExportCheck {
  let manifest: ExportManifest
  try {
    manifest = JSON.parse(manifestText)
  } catch {
    return { ok: false, code: 'manifestInvalid', message: 'manifest.json is not JSON' }
  }
  if (manifest?.kind !== 'catalogue-export') return { ok: false, code: 'manifestInvalid', message: 'not a catalogue export manifest' }
  if (sha256(ndjson) !== manifest.sha256) return { ok: false, code: 'checksumMismatch', message: 'catalogue.ndjson does not match manifest.sha256 — the export was changed' }
  const docs = parseNdjson(ndjson)
  if (docs.length !== manifest.documents) return { ok: false, code: 'countMismatch', message: `manifest says ${manifest.documents} documents, file has ${docs.length}` }
  return { ok: true, docs, manifest }
}

// ── import into staging (step S) ─────────────────────────────────────────────

const SYSTEM = new Set(['_rev', '_updatedAt'])

export type WeakRef = { id: string; path: string; ref: string }

/**
 * A copy of the document whose strong references are made weak (`_weak: true`),
 * so it can be created in a dataset that lacks the targets (image assets and
 * documents outside the export scope). Returns the weakened paths.
 */
export function weakenReferences(doc: Doc): { doc: Doc; weakened: WeakRef[] } {
  const weakened: WeakRef[] = []
  const walk = (v: unknown, path: string): unknown => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${(x as { _key?: unknown })?._key ?? i}]`))
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [k, x] of Object.entries(o)) out[k] = walk(x, path ? `${path}.${k}` : k)
      if (typeof o._ref === 'string' && o._weak !== true) {
        out._weak = true
        weakened.push({ id: doc._id, path, ref: o._ref })
      }
      return out
    }
    return v
  }
  const copy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(doc)) if (!SYSTEM.has(k)) copy[k] = walk(v, k)
  return { doc: copy as Doc, weakened }
}

export type ImportPlan = {
  /** Phase 1: every document, strong references weakened. */
  create: Mutation[]
  /** Phase 2: documents whose every strong reference points inside the export — restored exactly (strong). */
  strengthen: Mutation[]
  /** References left weak because the target is not in the export (listed in the report). */
  leftWeak: WeakRef[]
  refusals: { code: string; id?: string; detail?: unknown }[]
}

export function planImport(docs: readonly Doc[], opts: { existingIds: ReadonlySet<string>; replace: boolean }): ImportPlan {
  const refusals: ImportPlan['refusals'] = []
  const ids = new Set(docs.map((d) => d._id))
  for (const d of docs) {
    if (idClassOf(d._id) === 'version') refusals.push({ code: 'import.versionsUnsupported', id: d._id })
    if (opts.existingIds.has(d._id) && !opts.replace) refusals.push({ code: 'import.targetNotEmpty', id: d._id })
    if (!(EXPORT_TYPES as readonly string[]).includes(d._type) && !['taxonomyTerm', 'project', 'siteConfig'].includes(d._type)) refusals.push({ code: 'import.typeOutOfScope', id: d._id, detail: d._type })
  }
  const create: Mutation[] = []
  const strengthen: Mutation[] = []
  const leftWeak: WeakRef[] = []
  for (const d of sortDocs(docs)) {
    const { doc, weakened } = weakenReferences(d)
    create.push({ createOrReplace: doc })
    const outside = weakened.filter((w) => !ids.has(w.ref) && !ids.has(`drafts.${w.ref}`))
    if (weakened.length && outside.length === 0) {
      const exact: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(d)) if (!SYSTEM.has(k)) exact[k] = v
      strengthen.push({ createOrReplace: exact as Doc })
    }
    leftWeak.push(...outside)
  }
  return { create, strengthen, leftWeak, refusals }
}
