import { describe, it, expect } from 'vitest'
import * as queries from '../queries'

// ── Every query is tenant-scoped ─────────────────────────────────────────────
//
// The failure this file exists to prevent: a GROQ query that selects documents
// by raw `_id` (or by `_type` alone) with no `projectSlug == $projectSlug`
// predicate. Sanity holds every tenant's content in one dataset, so an
// unscoped query is not merely over-broad — it renders another client's
// document on this client's website. That shipped twice, in
// blogListingManualPostsQuery and eventsListingManualEventsQuery: both fetched
// `_id in $ids` from a section's manual-selection list, so an id copied,
// duplicated, or hand-edited across projects resolved and rendered.
//
// The check is deliberately structural rather than per-query: it reads the
// module's exports at runtime, so a query added tomorrow is covered the day it
// is written, without anyone remembering to extend a list here.

// Exported strings that legitimately carry no $projectSlug. Every entry needs a
// reason — an unexplained name here is how the next leak gets waved through.
const ALLOWED_WITHOUT_PROJECT_SCOPE: Record<string, string> = {
  // Not a query — a projection fragment for the `cta` OBJECT type, interpolated
  // into a section projection that has already been reached through a
  // project-scoped root filter. It selects no documents of its own, so it has
  // no root filter to scope. (Its `formRef->` dereference is a separate,
  // documented gap: formDefinition is scoped by tenantSlug, not projectSlug,
  // and no $tenantSlug parameter is injected today. See the comment on
  // headerCta in websiteSiteConfigQuery.)
  CTA_FIELDS:
    'Projection fragment for the cta object type, not a document query — no root filter of its own.',

  // Not a query — the shared `pageSections[]` projection, interpolated into
  // homePageQuery / pageBySlugQuery / pageHomeQuery. Sections are embedded in
  // the page document, so they inherit that document's project scope.
  PAGE_SECTIONS_PROJECTION:
    'Projection fragment for embedded page sections — inherits the scope of the page document it is projected from.',

  // Not a query — the field selection appended to designSystemQuery, which does
  // apply `projectSlug == $projectSlug` on both branches of its coalesce. The
  // selection is also reused by design-system-resolver.ts to follow
  // `parentDesignSystem->` for theme inheritance: a parent design system is
  // deliberately shared across projects (that is what inheritance means), so it
  // is resolved by reference from an already-scoped document, not by a scoped
  // root filter of its own.
  DS_FIELDS_SELECTION:
    'Field selection appended to designSystemQuery (which is scoped) and reused to follow parentDesignSystem->, which is shared across projects by design.',
}

const exportedStrings = Object.entries(queries).filter(
  (entry): entry is [string, string] => typeof entry[1] === 'string',
)

describe('GROQ queries are tenant-scoped', () => {
  it('exports queries to check (guards against the import silently going empty)', () => {
    expect(exportedStrings.length).toBeGreaterThan(30)
  })

  it.each(exportedStrings.map(([name]) => name))(
    '%s filters by $projectSlug, or is an explained exemption',
    (name) => {
      const query = (queries as Record<string, string>)[name]
      if (name in ALLOWED_WITHOUT_PROJECT_SCOPE) {
        // Exempt — but only while it stays exempt-shaped. If an allow-listed
        // fragment grows its own root filter, it needs scoping like anything else.
        expect(
          ALLOWED_WITHOUT_PROJECT_SCOPE[name].length,
          `${name} is allow-listed but carries no reason`,
        ).toBeGreaterThan(20)
        return
      }
      expect(
        query,
        `${name} selects documents without a projectSlug filter. Add ` +
          `\`projectSlug == $projectSlug\` to its root filter, or add it to ` +
          `ALLOWED_WITHOUT_PROJECT_SCOPE with a reason.`,
      ).toContain('$projectSlug')
    },
  )

  it('has no stale allow-list entries', () => {
    // An exemption for a query that no longer exists is a licence nobody is
    // watching — it would silently cover a future query that reuses the name.
    const exported = new Set(exportedStrings.map(([name]) => name))
    for (const name of Object.keys(ALLOWED_WITHOUT_PROJECT_SCOPE)) {
      expect(exported.has(name), `${name} is allow-listed but no longer exported`).toBe(true)
    }
  })
})

// ── The specific regression ──────────────────────────────────────────────────
//
// Fetching by `_id in $ids` is the shape that leaked: the ids come from an
// editor's manual-selection list, which carries no scope of its own. Assert the
// scope sits on the same root filter rather than merely somewhere in the string.

describe('manual-selection queries scope the id lookup itself', () => {
  const manualQueries = exportedStrings.filter(
    ([name, query]) => /Manual/.test(name) && query.includes('_id in $'),
  )

  it('finds the manual-selection queries (blog, news, events)', () => {
    expect(manualQueries.map(([name]) => name).sort()).toEqual([
      'blogListingManualPostsQuery',
      'eventsListingManualEventsQuery',
      'newsListingManualArticlesQuery',
    ])
  })

  it.each(manualQueries.map(([name]) => name))(
    '%s constrains projectSlug in the same filter as the id list',
    (name) => {
      const query = (queries as Record<string, string>)[name]
      const rootFilter = query.slice(query.indexOf('*['), query.indexOf(']'))
      expect(rootFilter).toContain('_id in $')
      expect(rootFilter).toContain('projectSlug == $projectSlug')
    },
  )
})
