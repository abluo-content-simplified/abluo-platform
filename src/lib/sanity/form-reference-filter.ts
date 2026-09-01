import { deriveTenantSlug, type ProjectScope } from '@/lib/tenancy/project-scope'

// ─── Tenant scope for reference filters ───────────────────────────────────────
//
// A `formDefinition` is TENANT-owned: it is filed under a flat `tenantSlug`
// field, not under a project. Two websites of one client therefore SHARE their
// forms, and no website may ever reach another client's.
//
// The reference-filter callbacks below run on a CTA or a page section, so the
// document they are handed is the PAGE (or siteConfig) — it carries
// `projectSlug` and nothing about tenancy. Getting from that project to its
// tenant used to be a regex strip of a trailing "-main" off the project slug,
// a naming convention posing as an ownership record; it was wrong for project
// `nologo`, owned by
// client `freeriders` (see src/lib/tenancy/MIGRATION.md).
//
// It is now a LOOKUP: the callback reads the project document with the Studio's
// own client and hands it to `deriveTenantSlug()`, which stays the single
// derivation in the codebase. Sanity's reference filters may be async and are
// given a `getClient`, so this costs one small query per picker open.
//
// A project with no resolvable tenant selects NOTHING — never everything.


// ── Why this lives in its own leaf module ────────────────────────────────────
//
// It was extracted from `src/lib/sanity/schema.ts` so that
// `src/lib/modules/config-schema.ts` — which GENERATES the module-config Sanity
// types from MODULE_REGISTRY — can use the same resolver for the pickers it
// emits, without a cycle. The existing graph is:
//
//   sanity/schema.ts → modules/config-schema.ts → modules/registry.ts
//
// so neither `registry.ts` nor `config-schema.ts` can import `schema.ts`; and
// `registry.ts` is deliberately DECLARATIVE (a manifest carries a GROQ *string*
// in `referenceFilter`, which the Modules pane interpolates while binding
// `$tenantSlug` itself — ModuleList.tsx), so a resolver function cannot be
// declared there either. This file imports nothing from either side, so both
// can import it. `schema.ts` re-exports both symbols, and identity is preserved:
// every picker in the schema compares equal to this one function.

/** Studio API version used by the tenancy lookups in this file. */
const TENANCY_API_VERSION = '2026-05-21'

/**
 * The "select nothing" sentinel. A reference filter must never fall open when
 * it cannot establish a scope: an unscoped picker offers every tenant's forms.
 */
const NO_TENANT_SCOPE = { filter: '_id == "@@no-tenant-scope@@"' } as const

/** The shape Sanity hands a reference-filter resolver, narrowed to what we read. */
interface ReferenceFilterContext {
  document?: Record<string, unknown> | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getClient?: (options: { apiVersion: string }) => any
}

/**
 * Resolve the tenant that owns the project a document belongs to.
 *
 * Prefers the published `project` document over its draft: a draft's tenancy is
 * not yet the site's tenancy. `amelie` exists only as a draft, so the fallback
 * branch is load-bearing, not defensive.
 *
 * Exported for tests — it is the seam where the Studio meets `deriveTenantSlug`.
 */
export async function resolveProjectScope(
  context: ReferenceFilterContext
): Promise<ProjectScope | null> {
  const projectSlug = (context.document as { projectSlug?: string } | undefined)?.projectSlug
  if (!projectSlug) return null
  const getClient = context.getClient
  if (!getClient) return null

  const project = await getClient({ apiVersion: TENANCY_API_VERSION }).fetch(
    `coalesce(
      *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0],
      *[_type == "project" && projectSlug == $projectSlug][0]
    ){ projectSlug, tenantSlug, "clientTenantSlug": clientRef->tenantSlug }`,
    { projectSlug }
  )

  return deriveTenantSlug({
    projectSlug,
    tenantSlug: (project as { tenantSlug?: string } | null)?.tenantSlug,
    clientTenantSlug: (project as { clientTenantSlug?: string } | null)?.clientTenantSlug,
  })
}

/**
 * Reference filter for every picker that selects an ACTIVE form definition.
 *
 * Shared by every picker that selects an active form, so they can never drift
 * apart — they are the same tenant boundary asked five times:
 *   • `cta.formRef`
 *   • `formSection.form`
 *   • `contactSection.contactForm`
 *   • `formOverlayButtonSection.form`
 *   • `siteConfig.whatsappForm` (deprecated, hidden — scoped anyway)
 *
 * The first two are objects nested in a page and the last is a document of its
 * own, but all five resolve identically: Sanity hands the filter callback the
 * DOCUMENT being edited, and every one of those documents (`page`, `siteConfig`)
 * carries `projectSlugField`. Nothing here needs a bound GROQ param.
 *
 * `role == "active"` is preserved verbatim from both call sites: templates
 * (`role == "template"`, `tenantSlug: null`) are unscoped by design and stay
 * visible where they are already offered — the Modules → Forms "add from
 * template" list — but neither of these pickers ever offered them, and this
 * change does not start.
 */
export async function activeFormReferenceFilter(context: ReferenceFilterContext) {
  const scope = await resolveProjectScope(context)
  if (!scope) return NO_TENANT_SCOPE
  return {
    filter: '_type == "formDefinition" && role == "active" && tenantSlug == $tenantSlug',
    params: { tenantSlug: scope.tenantSlug as string },
  }
}
