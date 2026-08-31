// ── Module navigation builder ─────────────────────────────────────────────────
// ADR-011 Phase D3 — Navigation Derivation.
//
// buildCollectionItems() is the single function that turns a module's declarative
// `collections` array into Sanity Studio structure items.
//
// Design notes:
//
// This file imports from `sanity/structure` (Studio-only). It must NOT be
// imported by Next.js page routes. The import chain is:
//   sanity.config.ts → src/lib/modules/navigation.ts → sanity/structure
//
// The inverse isolation principle of sections.ts applies here:
//   sections.ts  → Next.js routes only, never Studio
//   navigation.ts → Studio (sanity.config.ts) only, never Next.js routes
//
// Platform-owned constants:
//   STUDIO_API_VERSION — shared across all document lists; module declarations
//     do not carry this value. Centralised here to prevent drift.
//   params({ slug }) — always the project slug; always applied; not a field on
//     ModuleCollectionItemDef.
//
// ID convention:
//   Group list item:  "${slug}-${group.id}"        e.g. "livener-main-blog-module"
//   Group inner list: "${slug}-${group.id}-list"   e.g. "livener-main-blog-module-list"
//   Item list item:   "${slug}-${item.id}"          e.g. "livener-main-posts"
//
// These IDs match the hard-coded values previously in the registry lambdas.
// Sanity Studio caches navigation state by list item ID — changing IDs resets
// sidebar state for existing sessions.

import type { StructureBuilder } from 'sanity/structure'
import type { ModuleManifest, ModuleCollectionItemDef } from './types'

// ── Platform constant ─────────────────────────────────────────────────────────

/** API version used for all module-contributed document lists. */
const STUDIO_API_VERSION = '2026-05-21'

// ── Document list builder ─────────────────────────────────────────────────────

/**
 * Builds a single Sanity document list from a ModuleCollectionItemDef.
 * Applies ordering and initialValueTemplate only when declared.
 * apiVersion and params({ slug }) are applied unconditionally (platform-owned).
 */
function buildDocumentList(
  item: ModuleCollectionItemDef,
  slug: string,
  tenantSlug: string,
  S: StructureBuilder
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = (S.documentList() as any)
    .title(item.label)
    .schemaType(item.schemaType)
    .apiVersion(STUDIO_API_VERSION)
    .filter(item.filter)
    // Both scopes are always bound. Most module content is project-scoped
    // ($slug), but some types are TENANT-owned — formDefinition is keyed by
    // tenantSlug, not projectSlug — and a collection must be able to say so
    // without inventing a second builder.
    .params({ slug, tenantSlug })

  const withOrdering = item.ordering?.length
    ? base.defaultOrdering(item.ordering)
    : base

  return item.initialValueTemplate
    ? withOrdering.initialValueTemplates([
        S.initialValueTemplateItem(item.initialValueTemplate, { projectSlug: slug, tenantSlug }),
      ])
    : withOrdering
}

// ── buildCollectionItems ──────────────────────────────────────────────────────

/**
 * Derives the Studio structure list items for a single module's collections.
 *
 * For each group in `manifest.platformContract.collections` that has at least
 * one item, produces one S.listItem() → S.list() → [S.listItem() → S.documentList()]
 * tree. Groups with zero items are silently excluded.
 *
 * Called from sanity.config.ts `buildCollectionsItems()` for each enabled module.
 * Interleaving of dividers between modules is handled by the caller.
 *
 * @param slug - The project slug (projectSlug). Prefixes all generated IDs and
 *   is passed as the `$slug` GROQ parameter.
 * @param tenantSlug - The tenant slug, passed as `$tenantSlug` for collections
 *   whose documents are tenant-owned rather than project-scoped.
 * @param S - The Sanity StructureBuilder from the `structure:` callback.
 * @param manifest - The module's full manifest. Only `platformContract.collections`
 *   is read; all other fields are ignored.
 */
export function buildCollectionItems(
  slug: string,
  tenantSlug: string,
  S: StructureBuilder,
  manifest: ModuleManifest
): ReturnType<StructureBuilder['listItem']>[] {
  return manifest.platformContract.collections
    .filter((group) => group.items.length > 0)
    .flatMap((group) => {
      // ── Single-item groups are flattened ──────────────────────────────────
      // A group wrapper around one document list is a click that buys nothing,
      // and it reads absurdly when the two share a name: Forms → Forms → Form
      // Definitions. When a group holds exactly one item, the item is returned
      // directly and the wrapper disappears.
      //
      // The item keeps its own id (`${slug}-${item.id}`), so flattening does
      // not rename anything — it only removes a level from the path.
      if (group.items.length === 1) {
        const item = group.items[0]
        return [
          S.listItem()
            .id(`${slug}-${item.id}`)
            .title(item.label)
            .child(buildDocumentList(item, slug, tenantSlug, S)),
        ]
      }

      return [
        S.listItem()
          .id(`${slug}-${group.id}`)
          .title(group.label)
          .child(
            S.list()
              .id(`${slug}-${group.id}-list`)
              .title(group.label)
              .items(
                group.items.map((item) =>
                  S.listItem()
                    .id(`${slug}-${item.id}`)
                    .title(item.label)
                    .child(buildDocumentList(item, slug, tenantSlug, S))
                )
              )
          ),
      ]
    })
}
