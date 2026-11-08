/**
 * The Media Library is a platform surface, not a module (it is gated by the
 * platform permission `media.library.manage`), so its search declaration lives
 * here — the same way add-content-sheet.ts adds Media to the create sheet.
 */
import { MEDIA_MANAGE_PERMISSION } from '@/lib/api/media-permission'
import type { ModuleSearchDef } from '@/lib/modules/types'

export const MEDIA_SEARCH: ModuleSearchDef = {
  kind: 'media',
  permission: MEDIA_MANAGE_PERMISSION,
  href: (slug, id) => `/${slug}/media?open=${id}`,
  listHref: (slug) => `/${slug}/media`,
  source: {
    type: 'sanity',
    docType: 'mediaAsset',
    drafts: false,
    // Images only get a thumbnail (an animation's file is not an image URL).
    extraFilter: 'defined(image.asset) || (mediaType == "animation" && defined(animation.asset))',
    projection: 'name, title, altText, "filename": coalesce(image.asset->originalFilename, animation.asset->originalFilename), "thumb": image.asset->url',
    fields: [
      { name: 'title', kind: 'localizedString', weight: 3 },
      { name: 'name', kind: 'string', weight: 3 },
      // altText is a plain string on older assets and a localized object on newer ones.
      { name: 'altText', kind: 'string', weight: 2 },
      { name: 'altText', kind: 'localizedString', weight: 2 },
      { name: 'caption', kind: 'localizedString', weight: 1 },
      { name: 'image.asset->originalFilename', kind: 'string', weight: 1 },
      { name: 'tags', kind: 'stringArray', weight: 2 },
    ],
    titleOf: (row, r) => r.text(row.title) || r.text(row.name) || r.text(row.filename),
    subtitleOf: (row, r) => r.text(row.altText) || r.text(row.filename),
  },
}
