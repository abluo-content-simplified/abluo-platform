/**
 * ADR-032 D3 — every public delivery path filters lifecycle content with
 * `publicFilterFor`. Two nets:
 *
 *  1. QUERY SCAN — every exported GROQ string of the delivery modules below is
 *     public unless listed in NON_PUBLIC (with a reason). A public string must
 *     carry the type's rule for each read of a lifecycle type, and must never
 *     dereference a lifecycle reference without guarding it.
 *  2. FILE INVENTORY — any other source file that reads a lifecycle type must
 *     be listed in OTHER_READERS (with a reason). A new delivery path cannot
 *     appear without someone deciding which side it is on.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LIFECYCLE_TYPES, publicFilterFor, publicFilterForAnyType, type LifecycleType } from '../public-types'
import * as queries from '@/lib/sanity/queries'
import * as sitemapQueries from '@/lib/seo/sitemap-queries'
import * as llms from '@/lib/seo/llms'
import * as postPreview from '@/lib/sanity/post-preview-query'
import * as partnerEvents from '@/lib/connections/api/event-queries'

const ROOT = join(__dirname, '../../../..')

// ── 1. Delivery modules and their exported GROQ strings ──────────────────────

const DELIVERY_MODULES: Record<string, Record<string, unknown>> = {
  'src/lib/sanity/queries.ts': queries,
  'src/lib/seo/sitemap-queries.ts': sitemapQueries,
  'src/lib/seo/llms.ts': llms,
  'src/lib/sanity/post-preview-query.ts': postPreview,
  'src/lib/connections/api/event-queries.ts': partnerEvents,
}

/** Exported strings that read lifecycle content but are NOT public delivery. */
const NON_PUBLIC: Record<string, string> = {
  'src/lib/sanity/queries.ts#dashboardPostsQuery': 'client dashboard (authenticated) — lists every state',
  'src/lib/sanity/queries.ts#galleryDocPreviewQuery': 'private draft preview of one gallery (authenticated preview route)',
  'src/lib/sanity/post-preview-query.ts#postDraftPreviewQuery': 'private draft preview of one post (authenticated preview route)',
  'src/lib/connections/api/event-queries.ts#PARTNER_EVENTS_PAGE_QUERY':
    'partner API sync (ADR-032 D11, slice 5) — reads every state on purpose: visibility is evaluated at the window end in code (partnerRemovalReason) and non-public events leave only as removals { id, deleted: true, reason }, never with content',
  'src/lib/connections/api/event-queries.ts#PARTNER_EVENTS_EXISTING_QUERY':
    'partner API tombstone suppression (ADR-032 D11) — returns only which public ids still exist, never content',
}

/** Reference fields that point at a lifecycle type, and that type. */
const REF_FIELDS: Record<string, LifecycleType> = {
  gallery: 'gallery',
  galleries: 'gallery',
  relatedEvent: 'event',
  event: 'event',
  events: 'event',
  posts: 'post',
  articles: 'newsArticle',
  // ADR-033 — catalogue references. A collection section's items, the listing
  // section's collection, an item's option list and an option's linked item.
  items: 'catalogueItem',
  item: 'catalogueItem',
  collection: 'catalogueCollection',
  list: 'catalogueOptionList',
}

/**
 * The `[...]` (or `(...)`) span that encloses position `at`: the filter or
 * condition a `_type == "…"` read sits in. Brackets inside GROQ string
 * literals are ignored.
 */
function enclosingSpan(q: string, at: number): string {
  const OPEN = '[(', CLOSE = '])'
  let depth = 0
  let start = -1
  for (let i = at - 1; i >= 0; i--) {
    const c = q[i]
    if (CLOSE.includes(c)) depth++
    else if (OPEN.includes(c)) {
      if (depth === 0) { start = i; break }
      depth--
    }
  }
  if (start < 0) return q
  depth = 0
  for (let i = start + 1; i < q.length; i++) {
    const c = q[i]
    if (c === '"') { i = q.indexOf('"', i + 1); if (i < 0) break; continue }
    if (OPEN.includes(c)) depth++
    else if (CLOSE.includes(c)) {
      if (depth === 0) return q.slice(start, i + 1)
      depth--
    }
  }
  return q.slice(start)
}

function stripGuards(q: string): string {
  let s = q.split(publicFilterForAnyType()).join(' ')
  for (const t of LIFECYCLE_TYPES) {
    for (const [field, type] of Object.entries(REF_FIELDS)) {
      if (type !== t) continue
      // guarded single reference: select(<rule on field->> => field->…) / [<rule>].field->
      s = s.split(`${publicFilterFor(t, `${field}->`)} => ${field}->`).join(' GUARDED ')
      s = s.split(`[${publicFilterFor(t, `${field}->`)}].${field}->`).join(' GUARDED ')
      // guarded array: field[<rule on @->>]->
      s = s.split(`${field}[${publicFilterFor(t, '@->')}]->`).join(' GUARDED ')
    }
  }
  return s
}

function problems(q: string): string[] {
  const out: string[] = []
  const s = stripGuards(q)
  for (const t of LIFECYCLE_TYPES) {
    const reads = (s.match(new RegExp(`_type\\s*==\\s*["']${t}["']`, 'g')) ?? []).length
    const rules = s.split(publicFilterFor(t)).length - 1
    if (reads > rules) out.push(`${reads} read(s) of "${t}" but ${rules} public rule(s)`)
    // Per read, not just per query: several 'optional' rules are the same
    // string, so a count alone lets one subquery's rule cover another read
    // (a catalogue item query with option-list subqueries). Each read must
    // carry its rule inside its own filter.
    for (const m of s.matchAll(new RegExp(`_type\\s*==\\s*["']${t}["']`, 'g'))) {
      if (!enclosingSpan(s, m.index!).includes(publicFilterFor(t))) out.push(`a read of "${t}" whose filter lacks its public rule`)
    }
  }
  if (new RegExp(`_type\\s+in\\s+\\[[^\\]]*"(${LIFECYCLE_TYPES.join('|')})"`).test(s)) out.push('`_type in [...]` over a lifecycle type — use publicFilterForAnyType')
  for (const field of Object.keys(REF_FIELDS)) {
    if (new RegExp(`\\b${field}(\\[\\])?->`).test(s)) out.push(`unguarded dereference ${field}->`)
  }
  if (/\binternal->\{/.test(s) && !q.includes(publicFilterForAnyType())) out.push('internal link target without publicFilterForAnyType')
  return out
}

const readsLifecycle = (q: string) =>
  LIFECYCLE_TYPES.some((t) => new RegExp(`_type\\s*==\\s*["']${t}["']`).test(q)) ||
  Object.keys(REF_FIELDS).some((f) => new RegExp(`\\b${f}(\\[[^\\]]*\\])?->`).test(q)) ||
  /\binternal->\{/.test(q)

const ENTRIES = Object.entries(DELIVERY_MODULES).flatMap(([file, mod]) =>
  Object.entries(mod)
    .filter(([, v]) => typeof v === 'string')
    .map(([name, v]) => ({ id: `${file}#${name}`, query: v as string })),
)

describe('ADR-032 D3 — public delivery paths carry the visibility rule', () => {
  const pub = ENTRIES.filter((e) => readsLifecycle(e.query) && !(e.id in NON_PUBLIC))

  it('finds the delivery paths (sanity check on the scanner)', () => {
    const ids = pub.map((e) => e.id)
    for (const expected of [
      'src/lib/sanity/queries.ts#postBySlugQuery',
      'src/lib/sanity/queries.ts#newsArticleBySlugQuery',
      'src/lib/sanity/queries.ts#eventBySlugQuery',
      'src/lib/sanity/queries.ts#blogListingManualPostsQuery',
      'src/lib/sanity/queries.ts#pageBySlugQuery',
      'src/lib/seo/sitemap-queries.ts#SITEMAP_POSTS_QUERY',
      'src/lib/seo/llms.ts#LLMS_NEWS_QUERY',
      // ADR-033 D9 / AC 12 — catalogue delivery paths: item page (+ its
      // generateMetadata and JSON-LD, which read the same query), collection
      // page, listing section, landing page, sitemap.
      'src/lib/sanity/queries.ts#catalogueItemBySlugQuery',
      'src/lib/sanity/queries.ts#catalogueItemByOldSlugQuery',
      'src/lib/sanity/queries.ts#catalogueCollectionBySlugQuery',
      'src/lib/sanity/queries.ts#catalogueCollectionByOldSlugQuery',
      'src/lib/sanity/queries.ts#catalogueCollectionByIdQuery',
      'src/lib/sanity/queries.ts#cataloguePageQuery',
      'src/lib/seo/sitemap-queries.ts#SITEMAP_CATALOGUE_ITEMS_QUERY',
      'src/lib/seo/sitemap-queries.ts#SITEMAP_CATALOGUE_COLLECTIONS_QUERY',
    ]) expect(ids).toContain(expected)
  })

  for (const e of pub) {
    it(e.id, () => {
      expect(problems(e.query)).toEqual([])
    })
  }

  it('every NON_PUBLIC entry still exists and still reads lifecycle content', () => {
    for (const id of Object.keys(NON_PUBLIC)) {
      const e = ENTRIES.find((x) => x.id === id)
      expect(e, `stale NON_PUBLIC entry ${id}`).toBeDefined()
      expect(readsLifecycle(e!.query), id).toBe(true)
    }
  })

  it('the scanner rejects an unfiltered read and an unguarded dereference', () => {
    expect(problems('*[_type == "post" && projectSlug == $projectSlug]')).not.toEqual([])
    expect(problems('*[_type == "page"][0]{ "g": gallery->{ _id } }')).not.toEqual([])
    expect(problems('*[_type == "page"][0]{ "g": galleries[]->{ _id } }')).not.toEqual([])
    expect(problems(`*[_type == "post" && ${publicFilterFor('post')}]`)).toEqual([])
  })

  it('the scanner rejects catalogue reads that omit the rule, per read', () => {
    const item = publicFilterFor('catalogueItem')
    const list = publicFilterFor('catalogueOptionList')
    // Root read without its rule, even though a subquery carries an identical
    // 'optional' rule string.
    expect(problems(`*[_type == "catalogueItem" && projectSlug == $projectSlug][0]{ "l": *[_type == "catalogueOptionList" && ${list}][0] }`)).not.toEqual([])
    expect(problems(`*[_type == "catalogueItem" && ${item}][0]{ "l": *[_type == "catalogueOptionList" && ${list}][0] }`)).toEqual([])
    // Collection items dereferenced without the '@->' guard.
    expect(problems(`*[_type == "catalogueCollection" && ${publicFilterFor('catalogueCollection')}][0]{ sections[]{ "items": items[]->{ name } } }`)).not.toEqual([])
    expect(problems(`*[_type == "catalogueCollection" && ${publicFilterFor('catalogueCollection')}][0]{ sections[]{ "items": (items[${publicFilterFor('catalogueItem', '@->')}]->)[projectSlug == $projectSlug]{ name } } }`)).toEqual([])
    // A listing section's collection dereferenced without a guard.
    expect(problems('*[_type == "page"][0]{ sections[]{ "c": collection->{ name } } }')).not.toEqual([])
  })
})

// ── 2. File inventory — every other reader of lifecycle content ──────────────

const OTHER_READERS: Record<string, string> = {
  'src/lib/admin/project-queries.ts': 'admin dashboard (authenticated)',
  'src/lib/api/event-drafts.ts': 'client dashboard event editor (authenticated)',
  'src/lib/api/gallery-drafts.ts': 'client dashboard gallery editor (authenticated)',
  'src/lib/api/gallery-status.ts': 'client dashboard gallery usage (authenticated)',
  'src/lib/api/post-drafts.ts': 'client dashboard post editor (authenticated)',
  'src/lib/api/post-publish.ts': 'client dashboard publish action (authenticated)',
  'src/lib/modules/gallery/schema.ts': 'Studio schema (references, not delivery)',
  'src/lib/modules/types.ts': 'module typing, no query',
  'src/lib/modules/registry.ts': 'Studio structure filters (staff only)',
  'src/lib/lifecycle/visibility.ts': 'the rule itself (a path example in its docs)',
  'src/lib/api/catalogue-lifecycle.ts': 'catalogue lifecycle descriptors — referrer checks before archive/delete (authenticated dashboard)',
  'src/lib/modules/catalogue/validation.ts': 'catalogue save-time validation — slug namespace and currency-change counts (authenticated Studio/dashboard)',
}

const LIFECYCLE_READ = new RegExp(
  `_type\\s*==\\s*\\\\?["'](${LIFECYCLE_TYPES.join('|')})\\\\?["']|\\b(relatedEvent|gallery|galleries)(\\[\\])?->`,
)

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules' || name === 'migrations') continue
      walk(p, out)
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('ADR-032 D3 — every reader of lifecycle content is classified', () => {
  const readers = walk(join(ROOT, 'src'))
    .filter((p) => LIFECYCLE_READ.test(readFileSync(p, 'utf8')))
    .map((p) => relative(ROOT, p).split('\\').join('/'))

  it('no unclassified file reads a lifecycle type', () => {
    const unclassified = readers.filter((f) => !(f in DELIVERY_MODULES) && !(f in OTHER_READERS))
    expect(unclassified, 'add it to DELIVERY_MODULES (public, scanned) or OTHER_READERS (with a reason)').toEqual([])
  })

  it('no stale OTHER_READERS entry', () => {
    for (const f of Object.keys(OTHER_READERS)) expect(readers, f).toContain(f)
  })
})
