/**
 * Client dashboard — gallery status (Gallery module). A gallery is not
 * published on its own: it shows where it is used (`photoGallerySection`
 * blocks on pages, `post.gallery` on posts). This reads, per gallery, where
 * it is used (published and draft), how many photos it has, how many lack a
 * description in the main language, and per other site language how many
 * photos have a main-language description but no translation.
 *
 * Same enforcement as gallery-drafts: `assertModuleAction` (read) first,
 * `projectSlug` from the grant, every document must carry that projectSlug,
 * opaque errors. Read-only.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { GALLERY_READ_PERMISSION, GalleryError, isGalleryId, localized } from '@/lib/api/gallery-drafts'

type Client = Pick<typeof sanityWriteClient, 'fetch'>
export type GalleryStatusDeps = { client?: Client }

export type GalleryStatus = {
  usedOn: {
    pages: Array<{ id: string; title: string; published: boolean }>
    posts: { published: number; draft: number }
  }
  photos: number
  missingDescription: number
  /** Per other site language: photos with a main-language description but none in that language. */
  missingTranslation: Record<string, number>
}

const DRAFT = 'drafts.'

export async function getGalleryStatuses(
  ctx: TenantAuthorizationContext,
  projectId: string,
  ids?: string[],
  deps: GalleryStatusDeps = {}
): Promise<Record<string, GalleryStatus>> {
  assertModuleAction(ctx, projectId, GALLERY_READ_PERMISSION)
  const projectSlug = ctx.projects.find((p) => p.projectId === projectId)!.projectSlug
  const client = deps.client ?? sanityWriteClient
  try {
    const site = await client.fetch<{ defaultLocale?: string | null; supportedLocales?: string[] | null } | null>(
      `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]{ defaultLocale, supportedLocales }`,
      { projectSlug }
    )
    const supported = site?.supportedLocales?.length ? site.supportedLocales : []
    const main = site?.defaultLocale || supported[0]
    if (!main) throw new Error('no languages')
    const others = supported.filter((l) => l !== main)

    const galleries = await client.fetch<Array<{ _id: string; projectSlug?: string; refs?: unknown }> | null>(
      `*[_type == "gallery" && projectSlug == $projectSlug && !(_id in path("versions.**"))]{ _id, projectSlug, "refs": items[].mediaAsset._ref }`,
      { projectSlug },
      { perspective: 'raw' }
    )
    // One entry per gallery: the draft's photos when there is a draft.
    const photosById = new Map<string, { refs: string[]; draft: boolean }>()
    for (const g of galleries ?? []) {
      if (g.projectSlug !== projectSlug) continue
      const isDraft = g._id.startsWith(DRAFT)
      const id = isDraft ? g._id.slice(DRAFT.length) : g._id
      if (!isGalleryId(id) || (ids && !ids.includes(id))) continue
      const prev = photosById.get(id)
      if (prev?.draft && !isDraft) continue
      const refs = Array.isArray(g.refs) ? g.refs.filter((r): r is string => typeof r === 'string') : []
      photosById.set(id, { refs, draft: isDraft })
    }
    const galleryIds = [...photosById.keys()]
    if (!galleryIds.length) return {}

    const assetIds = [...new Set([...photosById.values()].flatMap((v) => v.refs))]
    const [assets, usage] = await Promise.all([
      assetIds.length
        ? client.fetch<Array<{ _id: string; altText?: unknown }> | null>(
            `*[_type == "mediaAsset" && projectSlug == $projectSlug && _id in $ids]{ _id, altText }`,
            { projectSlug, ids: assetIds }
          )
        : Promise.resolve([]),
      client.fetch<Array<{ _id: string; _type: string; projectSlug?: string; title?: unknown; refs?: unknown }> | null>(
        `*[_type in ["page", "post"] && projectSlug == $projectSlug && !(_id in path("versions.**")) && references($ids)]{
          _id, _type, projectSlug, title,
          "refs": array::compact([
            ...coalesce(sections[_type == "photoGallerySection"].galleries[]._ref, []),
            ...coalesce(sections[_type == "photoGallerySection"].gallery._ref, []),
            gallery._ref
          ])
        }`,
        { projectSlug, ids: galleryIds },
        { perspective: 'raw' }
      ),
    ])
    const altById = new Map((assets ?? []).map((a) => [a._id, localized(a.altText)]))

    const out: Record<string, GalleryStatus> = {}
    for (const id of galleryIds) {
      const { refs } = photosById.get(id)!
      let missingDescription = 0
      const missingTranslation: Record<string, number> = {}
      for (const ref of refs) {
        const alt = altById.get(ref) ?? {}
        if (!alt[main]) {
          missingDescription++
          continue
        }
        for (const l of others) if (!alt[l]) missingTranslation[l] = (missingTranslation[l] ?? 0) + 1
      }
      out[id] = { usedOn: { pages: [], posts: { published: 0, draft: 0 } }, photos: refs.length, missingDescription, missingTranslation }
    }

    // Published wins over draft for the same document.
    const docs = new Map<string, { type: string; title: unknown; published: boolean; refs: Set<string> }>()
    for (const row of usage ?? []) {
      if (row.projectSlug !== projectSlug) continue
      const isDraft = row._id.startsWith(DRAFT)
      const docId = isDraft ? row._id.slice(DRAFT.length) : row._id
      const refs = new Set(Array.isArray(row.refs) ? row.refs.filter((r): r is string => typeof r === 'string') : [])
      const prev = docs.get(docId)
      if (prev) {
        for (const r of refs) prev.refs.add(r)
        if (!isDraft) {
          prev.published = true
          prev.title = row.title
        }
      } else docs.set(docId, { type: row._type, title: row.title, published: !isDraft, refs })
    }
    for (const [docId, doc] of docs) {
      for (const id of galleryIds) {
        if (!doc.refs.has(id)) continue
        const u = out[id].usedOn
        if (doc.type === 'post') u.posts[doc.published ? 'published' : 'draft']++
        else {
          const v = localized(doc.title)
          u.pages.push({ id: docId, title: v[main] ?? v.en ?? Object.values(v)[0] ?? '', published: doc.published })
        }
      }
    }
    return out
  } catch (error) {
    if (error instanceof GalleryError) throw error
    throw new GalleryError('failed', 'Could not read gallery status.')
  }
}
