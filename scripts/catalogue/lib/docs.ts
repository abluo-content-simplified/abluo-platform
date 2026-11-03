// ── Catalogue rollout scripts — document helpers (C10-6) ─────────────────────
// Pure. Shared by export, pre-flight, import, the D1–D4 data steps and their
// verifications. No I/O.

export type Doc = { _id: string; _type: string; _rev?: string; projectSlug?: string; [k: string]: unknown }

export type IdClass = 'published' | 'draft' | 'version'

export const idClassOf = (id: string): IdClass => (id.startsWith('drafts.') ? 'draft' : id.startsWith('versions.') ? 'version' : 'published')

/** `drafts.X` / `versions.<release>.X` / `X` → `X`: the key that pairs a draft with its published copy. */
export function baseIdOf(id: string): string {
  if (id.startsWith('drafts.')) return id.slice('drafts.'.length)
  if (id.startsWith('versions.')) {
    const rest = id.slice('versions.'.length)
    const dot = rest.indexOf('.')
    return dot >= 0 ? rest.slice(dot + 1) : rest
  }
  return id
}

/** Every Catalogue-relevant type (C10-6 step P scope) plus the R1 documents and the site config the verifications read. */
export const EXPORT_TYPES = ['catalogueItem', 'catalogueCollection', 'catalogueOptionList', 'cataloguePage', 'catalogueTaxonomy', 'cataloguePackHistory'] as const

/**
 * The export filter (C10-6 P): every Catalogue document, the Catalogue term records,
 * the `project` documents with a Catalogue installation, and those projects'
 * `siteConfig` (time zone and locales — read by the verifications, never written).
 * Paged by `_id` in the raw perspective so drafts and versions are included.
 */
export const EXPORT_FILTER = `(
  _type in ${JSON.stringify(EXPORT_TYPES)}
  || (_type == "taxonomyTerm" && module == "catalogue")
  || (_type == "project" && count(moduleInstallations[moduleId == "catalogue"]) > 0)
  || (_type == "siteConfig" && projectSlug in *[_type == "project" && count(moduleInstallations[moduleId == "catalogue"]) > 0].projectSlug)
)`

export const exportPageQuery = (pageSize: number) => `*[${EXPORT_FILTER} && _id > $after] | order(_id asc) [0...${pageSize}]`

export const isPublished = (d: Doc) => idClassOf(d._id) === 'published'

/** Stable order for every output (exports, reports): by _id. */
export const sortDocs = (docs: readonly Doc[]): Doc[] => [...docs].sort((a, b) => (a._id < b._id ? -1 : a._id > b._id ? 1 : 0))

export type CatalogueInstallation = { index: number; key: string | null; config: Record<string, unknown>; /** Installation-level legacy preset record (NOT inside config). */ appliedPreset: unknown }

/** The Catalogue installation of a project document (first one, as every reader does). */
export function catalogueInstallation(project: Doc | null | undefined): CatalogueInstallation | null {
  const list = Array.isArray(project?.moduleInstallations) ? (project!.moduleInstallations as unknown[]) : []
  const index = list.findIndex((m) => (m as { moduleId?: unknown } | null)?.moduleId === 'catalogue')
  if (index < 0) return null
  const m = list[index] as { _key?: unknown; config?: unknown; appliedPreset?: unknown }
  const config = m.config && typeof m.config === 'object' && !Array.isArray(m.config) ? (m.config as Record<string, unknown>) : {}
  return { index, key: typeof m._key === 'string' && m._key ? m._key : null, config, appliedPreset: m.appliedPreset ?? null }
}

export type ProjectView = {
  slug: string
  /** The published project document and, when one exists, its draft — patched with the same function. */
  docs: Doc[]
  published: Doc | null
  config: Record<string, unknown>
  /** The installation's legacy `appliedPreset` (installation level, next to `config`). */
  appliedPreset: unknown
  site: Doc | null
}

/** Catalogue projects in a snapshot, by slug (sorted). Config is the PUBLISHED installation's (the one every reader uses). */
export function catalogueProjects(docs: readonly Doc[]): ProjectView[] {
  const bySlug = new Map<string, ProjectView>()
  for (const d of sortDocs(docs)) {
    if (d._type !== 'project' || typeof d.projectSlug !== 'string' || idClassOf(d._id) === 'version') continue
    if (!catalogueInstallation(d)) continue
    const v = bySlug.get(d.projectSlug) ?? { slug: d.projectSlug, docs: [], published: null, config: {}, appliedPreset: null, site: null }
    v.docs.push(d)
    if (isPublished(d)) {
      v.published = d
      v.config = catalogueInstallation(d)!.config
      v.appliedPreset = catalogueInstallation(d)!.appliedPreset
    }
    bySlug.set(d.projectSlug, v)
  }
  for (const v of bySlug.values()) {
    if (!v.published && v.docs[0]) {
      v.config = catalogueInstallation(v.docs[0])!.config
      v.appliedPreset = catalogueInstallation(v.docs[0])!.appliedPreset
    }
    v.site = docs.find((d) => d._type === 'siteConfig' && d.projectSlug === v.slug && isPublished(d)) ?? null
  }
  return [...bySlug.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1))
}

export const docsOfType = (docs: readonly Doc[], type: string, slug?: string) =>
  sortDocs(docs.filter((d) => d._type === type && (slug === undefined || d.projectSlug === slug)))

/** Group documents by their base id (draft/published/version pairs), in base-id order. */
export function groupByBase(docs: readonly Doc[]): Map<string, Doc[]> {
  const out = new Map<string, Doc[]>()
  for (const d of sortDocs(docs)) {
    const b = baseIdOf(d._id)
    out.set(b, [...(out.get(b) ?? []), d])
  }
  return out
}

export const idCounts = (docs: readonly Doc[]) => ({
  published: docs.filter((d) => idClassOf(d._id) === 'published').length,
  drafts: docs.filter((d) => idClassOf(d._id) === 'draft').length,
  versions: docs.filter((d) => idClassOf(d._id) === 'version').length,
  total: docs.length,
})

/** System fields that change on every write; ignored by every before/after diff. */
const VOLATILE = new Set(['_rev', '_updatedAt', '_createdAt'])

/** Deep copy without volatile system fields and with import-time `_weak` flags removed (see import.ts). */
export function normalise(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalise)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      if (VOLATILE.has(k) || k === '_weak') continue
      out[k] = normalise((v as Record<string, unknown>)[k])
    }
    return out
  }
  return v
}

export const sameValue = (a: unknown, b: unknown) => JSON.stringify(normalise(a)) === JSON.stringify(normalise(b))

/** Fields allowed to differ per document class in an "everything else unchanged" check. */
export type AllowedChanges = {
  /** Top-level fields of `catalogueItem` documents. */
  itemFields?: readonly string[]
  /** Keys of the Catalogue installation's `config`. */
  configKeys?: readonly string[]
  /** Document id prefixes that may be created or changed (e.g. `catalogue-taxonomy.`). */
  docIdPrefixes?: readonly string[]
}

export type UnchangedDiff = { id: string; field: string }

/**
 * "No content, setting or label changed" — every document of `before` is equal in
 * `after` except the allowed fields; no document disappears; a new document must
 * match an allowed prefix.
 */
export function unchangedExcept(before: readonly Doc[], after: readonly Doc[], allowed: AllowedChanges): UnchangedDiff[] {
  const diffs: UnchangedDiff[] = []
  const afterById = new Map(after.map((d) => [d._id, d]))
  const beforeIds = new Set(before.map((d) => d._id))
  const prefixOk = (id: string) => (allowed.docIdPrefixes ?? []).some((p) => baseIdOf(id).startsWith(p))
  for (const b of sortDocs(before)) {
    const a = afterById.get(b._id)
    if (!a) {
      diffs.push({ id: b._id, field: '(document missing)' })
      continue
    }
    if (prefixOk(b._id)) continue
    const keys = new Set([...Object.keys(b), ...Object.keys(a)])
    for (const k of [...keys].sort()) {
      if (VOLATILE.has(k)) continue
      if (b._type === 'catalogueItem' && (allowed.itemFields ?? []).includes(k)) continue
      if (b._type === 'project' && k === 'moduleInstallations') {
        const ib = catalogueInstallation(b)
        const ia = catalogueInstallation(a)
        const lb = (b.moduleInstallations as unknown[]) ?? []
        const la = (a.moduleInstallations as unknown[]) ?? []
        if (!ib || !ia || lb.length !== la.length) {
          diffs.push({ id: b._id, field: 'moduleInstallations' })
          continue
        }
        lb.forEach((m, i) => {
          if (i === ib.index) {
            const { config: cb, ...restB } = m as Record<string, unknown>
            const { config: ca, ...restA } = la[i] as Record<string, unknown>
            if (!sameValue(restB, restA)) diffs.push({ id: b._id, field: 'moduleInstallations[catalogue]' })
            const cfgB = (cb ?? {}) as Record<string, unknown>
            const cfgA = (ca ?? {}) as Record<string, unknown>
            for (const ck of [...new Set([...Object.keys(cfgB), ...Object.keys(cfgA)])].sort()) {
              if ((allowed.configKeys ?? []).includes(ck)) continue
              if (!sameValue(cfgB[ck], cfgA[ck])) diffs.push({ id: b._id, field: `config.${ck}` })
            }
          } else if (!sameValue(m, la[i])) diffs.push({ id: b._id, field: `moduleInstallations[${i}]` })
        })
        continue
      }
      if (!sameValue(b[k], a[k])) diffs.push({ id: b._id, field: k })
    }
  }
  for (const a of sortDocs(after)) if (!beforeIds.has(a._id) && !prefixOk(a._id)) diffs.push({ id: a._id, field: '(new document)' })
  return diffs
}
