// ── navigation.test.ts ────────────────────────────────────────────────────────
// ADR-011 Phase D3 — Navigation Derivation.
//
// Tests for buildCollectionItems() in src/lib/modules/navigation.ts.
//
// Mock strategy: a lightweight chainable StructureBuilder mock that records
// every .id() and .schemaType() call across all builder objects. Since all
// mock builders share the same tracker, the recorded arrays contain every value
// passed to those methods in the order they were called. Tests use .toContain()
// rather than asserting exact order, which is fragile.
//
// ID assertions are the highest-priority tests here: a wrong ID breaks Sanity
// Studio navigation state for existing sessions. The ID convention is:
//   Group:      "${slug}-${group.id}"
//   Inner list: "${slug}-${group.id}-list"
//   Item:       "${slug}-${item.id}"

import { describe, it, expect } from 'vitest'
import { buildCollectionItems } from '../navigation'
import { MODULE_REGISTRY } from '../registry'
import type { ModuleManifest, ModuleCollectionGroupDef } from '../types'
import type { StructureBuilder } from 'sanity/structure'

// ── Mock StructureBuilder ─────────────────────────────────────────────────────

interface MockTracker {
  ids: string[]
  schemaTypes: string[]
}

function createMockS(): { S: StructureBuilder; tracker: MockTracker } {
  const tracker: MockTracker = { ids: [], schemaTypes: [] }

  function makeBuilder(): Record<string, (...args: unknown[]) => unknown> {
    const b: Record<string, (...args: unknown[]) => unknown> = {}
    // Chainable no-ops for all builder methods
    for (const method of [
      'title', 'child', 'items', 'apiVersion', 'filter',
      'params', 'defaultOrdering', 'initialValueTemplates',
    ]) {
      b[method] = () => b
    }
    // Tracked methods
    b.id = (v: unknown) => { tracker.ids.push(v as string); return b }
    b.schemaType = (v: unknown) => { tracker.schemaTypes.push(v as string); return b }
    return b
  }

  const S = {
    listItem: () => makeBuilder(),
    list: () => makeBuilder(),
    documentList: () => makeBuilder(),
    initialValueTemplateItem: () => ({}),
  } as unknown as StructureBuilder

  return { S, tracker }
}

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeManifestWithCollections(
  collections: ModuleCollectionGroupDef[]
): ModuleManifest {
  return {
    id: 'test-module',
    label: 'Test Module',
    version: '1.0.0',
    status: 'released',
    platformContract: {
      collections,
      sectionTypes: [],
      schemaTypes: [],
      schemaDefinitions: () => [],
      permissions: [],
      configSchema: [],
      placement: { surfaces: [] },
    },
    publicContract: {},
    dependencies: { requires: [], integratesWith: [] },
    dataStore: { primary: 'content' },
    changelog: 'V1.0.0 — test fixture',
  }
}

const POST_ITEM = {
  id: 'posts',
  label: 'Posts',
  schemaType: 'post',
  filter: '_type == "post" && projectSlug == $slug',
}

const BLOG_GROUP: ModuleCollectionGroupDef = {
  id: 'blog-module',
  label: 'Blog',
  items: [POST_ITEM],
}

const AUTHOR_ITEM = {
  id: 'authors',
  label: 'Authors',
  schemaType: 'postAuthor',
  filter: '_type == "postAuthor" && projectSlug == $slug',
}

/** Two items, so the group wrapper is kept. */
const MULTI_GROUP: ModuleCollectionGroupDef = {
  id: 'blog-module',
  label: 'Blog',
  items: [POST_ITEM, AUTHOR_ITEM],
}

// ── Group structure ───────────────────────────────────────────────────────────

describe('buildCollectionItems — group structure', () => {
  it('returns empty array for a module with no collections', () => {
    const { S } = createMockS()
    const result = buildCollectionItems('slug', 'tenant', S, makeManifestWithCollections([]))
    expect(result).toHaveLength(0)
  })

  it('returns one item per collection group with items', () => {
    const { S } = createMockS()
    const result = buildCollectionItems('livener-main', 'tenant', S, makeManifestWithCollections([BLOG_GROUP]))
    expect(result).toHaveLength(1)
  })

  it('returns two items for two groups', () => {
    const { S } = createMockS()
    const result = buildCollectionItems('slug', 'tenant', S, makeManifestWithCollections([
      BLOG_GROUP,
      { id: 'events-module', label: 'Events', items: [{ id: 'events', label: 'Events', schemaType: 'event', filter: '_type == "event"' }] },
    ]))
    expect(result).toHaveLength(2)
  })

  it('silently excludes groups with zero items', () => {
    const { S } = createMockS()
    const result = buildCollectionItems('slug', 'tenant', S, makeManifestWithCollections([
      { id: 'empty', label: 'Empty', items: [] },
      BLOG_GROUP,
    ]))
    expect(result).toHaveLength(1)
  })

  it('returns empty array when all groups have zero items', () => {
    const { S } = createMockS()
    const result = buildCollectionItems('slug', 'tenant', S, makeManifestWithCollections([
      { id: 'empty-a', label: 'A', items: [] },
      { id: 'empty-b', label: 'B', items: [] },
    ]))
    expect(result).toHaveLength(0)
  })
})

// ── ID generation — the safety-critical assertions ───────────────────────────

describe('buildCollectionItems — ID generation', () => {
  // ADR-020 Amendment B — a group wrapping ONE document list is a click that
  // buys nothing, and reads absurdly when the two share a name (Forms → Forms →
  // Form Definitions). Single-item groups are flattened to the item itself.

  it('flattens a single-item group to the item, with no group wrapper', () => {
    const { S, tracker } = createMockS()
    const result = buildCollectionItems('livener-main', 'tenant', S, makeManifestWithCollections([BLOG_GROUP]))
    expect(result).toHaveLength(1)
    expect(tracker.ids).toContain('livener-main-posts')
    expect(tracker.ids).not.toContain('livener-main-blog-module')
    expect(tracker.ids).not.toContain('livener-main-blog-module-list')
  })

  it('keeps the group wrapper when a group has more than one item', () => {
    const { S, tracker } = createMockS()
    buildCollectionItems('livener-main', 'tenant', S, makeManifestWithCollections([MULTI_GROUP]))
    expect(tracker.ids).toContain('livener-main-blog-module')
    expect(tracker.ids).toContain('livener-main-blog-module-list')
    expect(tracker.ids).toContain('livener-main-posts')
    expect(tracker.ids).toContain('livener-main-authors')
  })

  it('preserves item ids when flattening — only the path shortens', () => {
    // Flattening must not rename anything; Sanity caches sidebar state by id.
    const { S, tracker } = createMockS()
    buildCollectionItems('livener-main', 'tenant', S, makeManifestWithCollections([BLOG_GROUP]))
    expect(tracker.ids).toEqual(['livener-main-posts'])
  })

  it('generates item list item ID as ${slug}-${item.id}', () => {
    const { S, tracker } = createMockS()
    buildCollectionItems('livener-main', 'tenant', S, makeManifestWithCollections([BLOG_GROUP]))
    expect(tracker.ids).toContain('livener-main-posts')
  })

  it('uses a different slug correctly', () => {
    const { S, tracker } = createMockS()
    buildCollectionItems('martegani-main', 'tenant', S, makeManifestWithCollections([MULTI_GROUP]))
    expect(tracker.ids).toContain('martegani-main-blog-module')
    expect(tracker.ids).toContain('martegani-main-blog-module-list')
    expect(tracker.ids).toContain('martegani-main-posts')
    expect(tracker.ids).not.toContain('livener-main-blog-module')
  })

  it('matches the exact IDs the blog module previously generated for all three collections', () => {
    const { S, tracker } = createMockS()
    const blogManifest = makeManifestWithCollections([
      {
        id: 'blog-module',
        label: 'Blog',
        items: [
          { id: 'posts', label: 'Posts', schemaType: 'post', filter: '_type == "post" && projectSlug == $slug' },
          { id: 'categories', label: 'Categories', schemaType: 'blogCategory', filter: '_type == "blogCategory" && projectSlug == $slug' },
          { id: 'authors', label: 'Authors', schemaType: 'postAuthor', filter: '_type == "postAuthor" && projectSlug == $slug' },
        ],
      },
    ])
    buildCollectionItems('livener-main', 'tenant', S, blogManifest)
    expect(tracker.ids).toContain('livener-main-blog-module')
    expect(tracker.ids).toContain('livener-main-blog-module-list')
    expect(tracker.ids).toContain('livener-main-posts')
    expect(tracker.ids).toContain('livener-main-categories')
    expect(tracker.ids).toContain('livener-main-authors')
  })

  it('keeps the wrapper for a two-item events group', () => {
    const { S, tracker } = createMockS()
    const eventsManifest = makeManifestWithCollections([
      {
        id: 'events-module',
        label: 'Events',
        items: [
          { id: 'event-categories', label: 'Categories', schemaType: 'eventCategory', filter: '_type == "eventCategory" && projectSlug == $slug' },
          { id: 'events', label: 'Events', schemaType: 'event', filter: '_type == "event" && projectSlug == $slug' },
        ],
      },
    ])
    buildCollectionItems('livener-main', 'tenant', S, eventsManifest)
    expect(tracker.ids).toContain('livener-main-events-module')
    expect(tracker.ids).toContain('livener-main-events-module-list')
    expect(tracker.ids).toContain('livener-main-events')
  })
})

// ── Schema types ──────────────────────────────────────────────────────────────

describe('buildCollectionItems — schema types', () => {
  it('passes the correct schemaType to each document list', () => {
    const { S, tracker } = createMockS()
    const manifest = makeManifestWithCollections([
      {
        id: 'blog-module',
        label: 'Blog',
        items: [
          { id: 'posts', label: 'Posts', schemaType: 'post', filter: '_type == "post"' },
          { id: 'categories', label: 'Categories', schemaType: 'blogCategory', filter: '_type == "blogCategory"' },
        ],
      },
    ])
    buildCollectionItems('slug', 'tenant', S, manifest)
    expect(tracker.schemaTypes).toContain('post')
    expect(tracker.schemaTypes).toContain('blogCategory')
  })
})

// ── Live MODULE_REGISTRY integration ─────────────────────────────────────────
//
// MODULE_REGISTRY is imported statically at the top of this file rather than
// lazily inside each test. registry.ts transitively pulls in every module
// schema file and therefore `sanity`; resolving that graph inside a test body
// was costing more than the 5s per-test budget once ADR-020 added
// config-schema.ts to it. A static import moves the cost to collection time.

describe('buildCollectionItems — live MODULE_REGISTRY', () => {
  it('returns no items for the Live module (no collections)', () => {
    const { S } = createMockS()
    const liveModule = MODULE_REGISTRY.find((m) => m.id === 'live')!
    const result = buildCollectionItems('livener-main', 'tenant', S, liveModule)
    expect(result).toHaveLength(0)
  })

  it('returns one group for the Blog module with the correct group ID', () => {
    const { S, tracker } = createMockS()
    const blogModule = MODULE_REGISTRY.find((m) => m.id === 'blog')!
    const result = buildCollectionItems('livener-main', 'tenant', S, blogModule)
    expect(result).toHaveLength(1)
    expect(tracker.ids).toContain('livener-main-blog-module')
    expect(tracker.ids).toContain('livener-main-blog-module-list')
    expect(tracker.ids).toContain('livener-main-posts')
    expect(tracker.ids).toContain('livener-main-categories')
    expect(tracker.ids).toContain('livener-main-authors')
  })

  it('returns one group for the Events module with the correct group ID', () => {
    const { S, tracker } = createMockS()
    const eventsModule = MODULE_REGISTRY.find((m) => m.id === 'events')!
    const result = buildCollectionItems('livener-main', 'tenant', S, eventsModule)
    expect(result).toHaveLength(1)
    expect(tracker.ids).toContain('livener-main-events-module')
    expect(tracker.ids).toContain('livener-main-events-module-list')
    expect(tracker.ids).toContain('livener-main-events')
  })
})
