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

// ── EVERY tenant-owned dereference carries a tenant clause ───────────────────
//
// headerCta was the first one scoped (v1.0.30); the block above pins it in the
// shape it was written. It was not the only one. Six more `formDefinition`
// dereferences survived that wave — the contact section's overlay form and the
// form section's definition (each duplicated across PAGE_SECTIONS_PROJECTION
// and homePageQuery's inline copy), the siteConfig WhatsApp form, and the
// module config's form slots — and each was the same leak with a different
// field name.
//
// These checks are written against the SHAPE rather than a list of names, so a
// new form reference added tomorrow is covered the day it is written: any
// dereference into the form projection is a failure, and every reference-keyed
// subquery must carry the tenant clause on its own filter.

/** Every exported string, including the projection fragments. */
const allStrings = Object.fromEntries(exportedStrings) as Record<string, string>

/**
 * The root filter of every subquery in `query` that selects a document by a
 * reference on the enclosing scope (`_id == ^.something._ref`), whitespace
 * collapsed. Sliced to the OUTER `][0]{` so the nested project lookups stay
 * inside the filter under test — a tenant clause sitting anywhere else in the
 * string scopes nothing.
 */
function referenceKeyedFilters(query: string): string[] {
  const filters: string[] = []
  const marker = /_id == \^\.(\w+)\._ref/g
  let match: RegExpExecArray | null
  while ((match = marker.exec(query)) !== null) {
    filters.push(
      query
        .slice(query.lastIndexOf('*[', match.index), query.indexOf('][0]{', match.index))
        .replace(/\s+/g, ' '),
    )
  }
  return filters
}

describe('no query dereferences straight into the form projection', () => {
  // The exact shape of the leak: `->` reaches ANY document by id, so a
  // formDefinition reference copied or hand-edited across clients resolves and
  // renders the other client's form. FORM_DEFINITION_PROJECTION opens with
  // `_id, formId, formType,` — a `->` immediately in front of it is a bare
  // dereference of a TENANT-owned document from a PROJECT-scoped query.
  const BARE_FORM_DEREF = /->\s*\{\s*_id,\s*formId,\s*formType,/

  it.each(exportedStrings.map(([name]) => name))('%s has no bare form dereference', (name) => {
    expect(
      BARE_FORM_DEREF.test(allStrings[name]),
      `${name} dereferences a formDefinition with \`->\`, which crosses out of ` +
        `the project scope its root filter established. Select it through a ` +
        `filtered subquery instead (scopedFormDefinition in queries.ts).`,
    ).toBe(false)
  })
})

describe('every reference-keyed form subquery is tenant-scoped', () => {
  // name -> the reference fields it must scope. Both the count and the field
  // names are asserted, so deleting a scoped dereference (or adding an
  // unscoped sibling next to it) fails here rather than silently passing.
  const EXPECTED: Record<string, string[]> = {
    // headerCta.form + the footer/floating WhatsApp form.
    websiteSiteConfigQuery: ['formRef', 'whatsappForm'],
    // All three module-owned form slots (ADR-020 module config).
    projectModuleConfigQuery: ['whatsappForm', 'internalFormRef', 'ctaForm'],
    // contactSection overlay + formSection / formOverlayButtonSection.
    PAGE_SECTIONS_PROJECTION: ['contactForm', 'form'],
    // homePageQuery carries its own inline copy of those two sections.
    homePageQuery: ['contactForm', 'form'],
  }

  it.each(Object.keys(EXPECTED))('%s scopes exactly its known form references', (name) => {
    const fields = [...allStrings[name].matchAll(/_id == \^\.(\w+)\._ref/g)].map((m) => m[1])
    expect(fields).toEqual(EXPECTED[name])
  })

  // The page-section fragment has no root filter of its own, so its subqueries
  // inherit $projectSlug from the page queries that splice it in. Assert those
  // consumers actually bind it — PROJECT_TENANT_SLUG has no other way to name
  // the tenant, and an unbound parameter resolves the tenant to null, which
  // matches no form and blanks the section.
  it.each(['pageHomeQuery', 'pageBySlugQuery'])(
    '%s binds $projectSlug for the spliced section subqueries',
    (name) => {
      expect(allStrings[name]).toContain('projectSlug == $projectSlug')
      expect(allStrings[name]).toContain('_id == ^.contactForm._ref')
    },
  )

  const scoped = Object.keys(EXPECTED).flatMap((name) =>
    referenceKeyedFilters(allStrings[name]).map(
      (filter, i) => [`${name}#${i}`, filter] as const,
    ),
  )

  it('finds all nine reference-keyed form subqueries', () => {
    expect(scoped.length).toBe(9)
  })

  it.each(scoped.map(([label]) => label))(
    '%s constrains tenantSlug in the same filter as the reference lookup',
    (label) => {
      const filter = scoped.find(([l]) => l === label)![1]
      expect(filter).toContain('_type == "formDefinition"')
      expect(filter).toContain('._ref')
      expect(filter).toContain('tenantSlug ==')
    },
  )

  it.each(scoped.map(([label]) => label))(
    '%s resolves the tenant from the project document, not from $tenantSlug',
    (label) => {
      // $tenantSlug is injected by fetchForTenant but holds the URL tenant slug
      // from TENANT_TO_PROJECT, a PROJECT-grain value: "nologo" for a site whose
      // owning tenant is "freeriders". Scoping on it would permanently blank
      // No!Logo's forms. See src/lib/tenancy/ids.ts.
      const filter = scoped.find(([l]) => l === label)![1]
      expect(filter).not.toContain('$tenantSlug')
      expect(filter).toContain(
        '*[_type == "project" && projectSlug == $projectSlug][0].tenantSlug',
      )
      expect(filter).toContain('clientRef->tenantSlug')
    },
  )

  it.each(scoped.map(([label]) => label))(
    '%s still lets an unscoped template resolve for every project',
    (label) => {
      // role == "template" documents carry tenantSlug: null and belong to no
      // tenant — they must stay reachable from every project.
      const filter = scoped.find(([l]) => l === label)![1]
      expect(filter).toContain('role == "template"')
    },
  )
})

// ── The legacy tenant derivation is gone from the query layer ────────────────

describe('no query derives a tenant by stripping a slug suffix', () => {
  it.each(exportedStrings.map(([name]) => name))('%s contains no -main strip', (name) => {
    const query = (queries as Record<string, string>)[name]
    expect(query).not.toContain('-main')
  })
})
