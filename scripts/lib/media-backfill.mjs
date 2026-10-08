// ---------------------------------------------------------------------------
// Abluo — Media Library backfill: the PURE half (no network, no env).
//
// Standing rule: every image is a Media Library asset (`mediaAsset`, scoped by
// `projectSlug`) before it is used. Some content was built before that rule and
// points an image field straight at a Sanity `image-…` asset. Those photos are
// invisible to the client dashboard's Media screen and to "Used in".
//
// `planMediaBackfill()` takes what the CLI read from Sanity for ONE project and
// decides, per referenced image asset, whether a `mediaAsset` already exists
// for it in THAT project or one has to be created — and if so, with exactly the
// field set the app's upload writes today (`createMediaAsset`,
// src/lib/media/create-media-asset.ts):
//
//   _type, image { _type, asset ref [, hotspot, crop] }, tenant ref,
//   project ref, projectSlug, name, tags, altText, uploadedByName
//
// `uploadedBy` (a user id) is left out — no user uploaded these. The marker in
// `uploadedByName` (hidden in Studio, never shown to clients) records where the
// document came from. Content documents are never touched.
//
// Exported for the vitest suite in scripts/__tests__/media-backfill.test.ts.
// ---------------------------------------------------------------------------

import { createHash } from 'node:crypto'

/** A Sanity image asset id: `image-<hash>-<w>x<h>-<ext>`. */
export const IMAGE_ASSET_ID = /^image-[A-Za-z0-9]+-\d+x\d+-[a-z0-9]+$/

/** Same rule as the app's mediaAsset id checks (gallery-photos.ts, media-library.ts). */
const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/** Marker written to `uploadedByName` so a backfilled document is recognisable. */
export const BACKFILL_MARKER = 'Media Library backfill (scripts/backfill-media-assets.mjs)'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/**
 * The deterministic `_id` of the backfilled `mediaAsset` for one image asset in
 * one project — re-running the script can never create a second one.
 * Falls back to a hash when the readable form would exceed Sanity's 128 chars.
 */
export function backfillDocId(projectSlug, assetId) {
  const readable = `mediaAsset-backfill-${projectSlug}-${assetId}`
  if (DOC_ID.test(readable)) return readable
  const hash = createHash('sha1').update(`${projectSlug}\u0000${assetId}`).digest('hex')
  return `mediaAsset-backfill-${hash}`
}

/** `drafts.x` / `versions.r.x` → `x`. */
export const publishedId = (id) => String(id).replace(/^drafts\./, '').replace(/^versions\.[^.]+\./, '')
const isDraftId = (id) => /^(drafts|versions)\./.test(String(id))

/** A localized value (object or legacy plain string) as { locale: text }, blanks dropped. */
export function localizedValue(value, defaultLocale = 'en') {
  if (typeof value === 'string') return value.trim() ? { [defaultLocale]: value.trim() } : {}
  if (!isObj(value)) return {}
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (!k.startsWith('_') && typeof v === 'string' && v.trim()) out[k] = v.trim()
  }
  return out
}

/**
 * Every image field of one document that points at a Sanity image asset
 * directly. Walks the whole document in JS (GROQ cannot deep-search).
 * Each hit: { assetId, path, hotspot?, crop?, alt }.
 */
export function collectImageRefs(doc, defaultLocale = 'en') {
  const hits = []
  const visit = (node, path, parent) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => {
        const seg = isObj(item) && typeof item._key === 'string' ? `[_key=="${item._key}"]` : `[${i}]`
        visit(item, `${path}${seg}`, node)
      })
      return
    }
    if (!isObj(node)) return
    const ref = isObj(node.asset) ? node.asset._ref : undefined
    if (typeof ref === 'string' && IMAGE_ASSET_ID.test(ref)) {
      // Alt text: on the image object (`localizedImage.alt`), else beside it.
      const altSource = node.alt ?? node.altText ?? (isObj(parent) ? parent.alt ?? parent.altText : undefined)
      hits.push({
        assetId: ref,
        path: path || '(root)',
        ...(isObj(node.hotspot) && { hotspot: node.hotspot }),
        ...(isObj(node.crop) && { crop: node.crop }),
        alt: localizedValue(altSource, defaultLocale),
      })
      return
    }
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('_')) continue
      if (v && typeof v === 'object') visit(v, path ? `${path}.${k}` : k, node)
    }
  }
  for (const [k, v] of Object.entries(doc ?? {})) {
    if (k.startsWith('_')) continue
    if (v && typeof v === 'object') visit(v, k, doc)
  }
  return hits
}

// Port of src/lib/media/photo-name.ts (`photoNameFromFile`) — the name the
// upload gives a photo. Kept in step by a parity test against the TS original.
const CAMERA = [
  /^img[\s_-]?\d+/i,
  /^img[\s_-]?e?\d+/i,
  /^pxl[\s_-]?\d+/i,
  /^dsc[fn]?[\s_-]?\d+/i,
  /^_?dsc\d+/i,
  /^p\d{6,}/i,
  /^dji[\s_-]?\d+/i,
  /^gopr\d+/i,
  /^mvimg[\s_-]?\d+/i,
  /^photo[\s_-]?\d+/i,
  /^screenshot[\s_-]?\d/i,
  /^whatsapp[\s_-]image/i,
  /^(image|photo|picture|img|foto|bild|immagine)[\s_-]*\d*$/i,
  /^\d[\d\s_-]*$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-/i,
  /^[0-9a-f]{16,}$/i,
]

export function photoNameFromFile(fileName) {
  const raw = (fileName ?? '').split(/[\\/]/).pop() ?? ''
  const stem = raw.replace(/\.[A-Za-z0-9]{1,5}$/, '').trim()
  if (!stem || CAMERA.some((re) => re.test(stem))) return ''
  return stem
    .replace(/[_]+/g, ' ')
    .replace(/(?<=\S)-(?=\S)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
}

const docLabel = (doc) => {
  const pick = (v) => (typeof v === 'string' ? v : Object.values(localizedValue(v))[0])
  return pick(doc.internalName) || pick(doc.title) || pick(doc.name) || pick(doc.siteName) || ''
}

/**
 * The backfill plan for ONE project.
 *
 * @param {object} input
 * @param {string} input.projectSlug
 * @param {object[]} [input.documents]    Tenant documents (published + drafts). Anything whose
 *                                        `projectSlug` differs, and every `mediaAsset`, is ignored.
 * @param {object[]} [input.mediaAssets]  This project's `mediaAsset` docs: { _id, projectSlug, image?: { asset?: { _ref } } }
 *                                        or the flattened { _id, projectSlug, ref }.
 * @param {Record<string, {originalFilename?: string|null, url?: string|null}>} [input.imageAssets]
 * @param {Array<{_id: string, clientId?: string|null}>} [input.projects]  Published `project` docs carrying this slug.
 * @param {string} [input.defaultLocale]
 * @param {string[]} [input.excludeTypes] Document types whose images are left out (e.g. siteConfig, designSystem).
 */
export function planMediaBackfill({ projectSlug, documents = [], mediaAssets = [], imageAssets = {}, projects = [], defaultLocale = 'en', excludeTypes = [] }) {
  // Tenant scope, enforced here too — the caller's query is not trusted alone.
  const skip = new Set(['mediaAsset', ...excludeTypes])
  const docs = documents.filter((d) => isObj(d) && d.projectSlug === projectSlug && !skip.has(d._type))

  /** assetId → mediaAsset ids of THIS project that already file it. */
  const existing = new Map()
  for (const m of mediaAssets) {
    if (!isObj(m) || m.projectSlug !== projectSlug) continue
    const ref = m.ref ?? m.image?.asset?._ref
    if (typeof ref !== 'string') continue
    if (!existing.has(ref)) existing.set(ref, [])
    existing.get(ref).push(m._id)
  }

  /** assetId → { usages, hotspot, crop, alt } */
  const found = new Map()
  // Published documents first: their hotspot / alt win over a draft's.
  const ordered = [...docs].sort((a, b) => Number(isDraftId(a._id)) - Number(isDraftId(b._id)) || String(a._id).localeCompare(String(b._id)))
  for (const doc of ordered) {
    for (const hit of collectImageRefs(doc, defaultLocale)) {
      let entry = found.get(hit.assetId)
      if (!entry) {
        entry = { usages: [], alt: {} }
        found.set(hit.assetId, entry)
      }
      entry.usages.push({ docId: doc._id, type: doc._type, title: docLabel(doc), path: hit.path, draft: isDraftId(doc._id) })
      if (!entry.hotspot && hit.hotspot) {
        entry.hotspot = hit.hotspot
        if (hit.crop) entry.crop = hit.crop
      }
      for (const [l, v] of Object.entries(hit.alt)) if (!entry.alt[l]) entry.alt[l] = v
    }
  }

  const project = projects.length === 1 ? projects[0] : null
  const blocked =
    projects.length === 0
      ? `no published "project" document carries projectSlug "${projectSlug}"`
      : projects.length > 1
        ? `${projects.length} "project" documents carry projectSlug "${projectSlug}" — refusing to guess the owner`
        : !project.clientId
          ? `project ${project._id} has no clientRef (tenant) — mediaAsset.tenant is required`
          : null

  const items = [...found.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([assetId, entry]) => {
      const meta = imageAssets[assetId] ?? {}
      const filename = typeof meta.originalFilename === 'string' && meta.originalFilename.trim() ? meta.originalFilename.trim() : null
      const already = existing.get(assetId)
      if (already?.length) {
        return { assetId, filename, usages: entry.usages, status: 'exists', existingMediaAssetIds: already }
      }
      if (blocked) return { assetId, filename, usages: entry.usages, status: 'blocked', reason: blocked }
      const name = photoNameFromFile(filename)
      const altText = Object.keys(entry.alt).length ? { _type: 'localizedString', ...entry.alt } : undefined
      const doc = {
        _id: backfillDocId(projectSlug, assetId),
        _type: 'mediaAsset',
        image: {
          _type: 'image',
          asset: { _type: 'reference', _ref: assetId },
          ...(entry.hotspot && { hotspot: entry.hotspot }),
          ...(entry.crop && { crop: entry.crop }),
        },
        tenant: { _type: 'reference', _ref: project.clientId },
        project: { _type: 'reference', _ref: project._id },
        projectSlug,
        ...(name && { name }),
        tags: [],
        ...(altText && { altText }),
        uploadedByName: BACKFILL_MARKER,
      }
      return { assetId, filename, usages: entry.usages, status: 'create', doc }
    })

  return {
    projectSlug,
    blocked,
    items,
    toCreate: items.filter((i) => i.status === 'create').map((i) => i.doc),
  }
}

/** The mutations `--apply` sends: createIfNotExists only — never a patch, never a content document. */
export function backfillMutations(plan) {
  return plan.toCreate.map((doc) => {
    if (doc._type !== 'mediaAsset' || !doc._id.startsWith('mediaAsset-backfill-')) {
      throw new Error(`refusing to write a non-backfill document: ${doc._id}`)
    }
    return { createIfNotExists: doc }
  })
}
