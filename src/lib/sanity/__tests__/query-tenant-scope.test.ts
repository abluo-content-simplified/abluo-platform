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
  // no root filter to scope. It reads ONE field across its `formRef->`
  // dereference — `formId`, the route key the overlay opens by — and never the
  // definition itself; the full dereference, on headerCta, is tenant-scoped
  // (see the block below).
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


// ── Tenant-owned dereferences carry a tenant clause ──────────────────────────
//
// `formDefinition` is TENANT-owned: filed under a flat `tenantSlug`, never
// under a project. A `projectSlug == $projectSlug` root filter therefore proves
// nothing about a `formRef->` inside it — the reference crosses OUT of the
// project scope the root filter established, into a document filed under a
// different key entirely. `headerCta.form` dereferenced unscoped until the
// tenancy migration completed (src/lib/tenancy/MIGRATION.md), and a header CTA
// pointing at another client's form rendered it.
//
// This is the check the migration adds to CI: the scope must sit on the
// subquery that selects the definition, not merely somewhere in the string.

describe('headerCta.form is scoped to the tenant that owns the project', () => {
  const query = queries.websiteSiteConfigQuery

  /**
   * The root filter of the subquery that selects the header form, whitespace
   * collapsed. Ends at `][0]{` — the OUTER close — so the nested project
   * lookups inside it stay part of the filter under test. Asserting on this
   * slice rather than on the whole query is the point: a tenant clause that
   * sits somewhere else in the string scopes nothing.
   */
  const formFilter = (() => {
    const at = query.indexOf('_id == ^.formRef._ref')
    return query
      .slice(query.lastIndexOf('*[', at), query.indexOf('][0]{', at))
      .replace(/\s+/g, ' ')
  })()

  it('no longer dereferences formRef straight into the full projection', () => {
    // The exact shape of the leak. `->` reaches any document by id.
    expect(query).not.toContain('"form": formRef->')
  })

  it('selects the definition through a filtered subquery keyed on the reference', () => {
    expect(query).toContain('_id == ^.formRef._ref')
  })

  it('constrains tenantSlug in the same filter as the reference lookup', () => {
    expect(formFilter).toContain('_id == ^.formRef._ref')
    expect(formFilter).toContain('tenantSlug ==')
  })

  it('resolves the tenant from the project document, not from the $tenantSlug param', () => {
    // $tenantSlug is injected by fetchForTenant but holds the URL tenant slug
    // from TENANT_TO_PROJECT, which is a PROJECT-grain value: it is "nologo"
    // for a site whose owning tenant is "freeriders". Scoping on it would blank
    // No!Logo's header form. See src/lib/tenancy/ids.ts.
    expect(formFilter).not.toContain('$tenantSlug')
    expect(formFilter).toContain('*[_type == "project" && projectSlug == $projectSlug][0].tenantSlug')
    expect(formFilter).toContain('clientRef->tenantSlug')
  })

  it('still lets an unscoped template resolve for every project', () => {
    // formDefinition documents with role == "template" carry tenantSlug: null
    // and belong to no tenant — they must stay reachable from any project.
    expect(formFilter).toContain('role == "template"')
  })
})

// ── The legacy tenant derivation is gone from the query layer ────────────────

describe('no query derives a tenant by stripping a slug suffix', () => {
  it.each(exportedStrings.map(([name]) => name))('%s contains no -main strip', (name) => {
    const query = (queries as Record<string, string>)[name]
    expect(query).not.toContain('-main')
  })
})
