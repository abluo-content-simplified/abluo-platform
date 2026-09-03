/**
 * GENERATED — DO NOT EDIT BY HAND, run scripts/generate-route-config.mjs
 *
 * Source of truth: the `projects` and `tenants` tables in Supabase.
 * This file is the build-time COPY of that data that the edge can read
 * synchronously. It is checked in so the edge bundle needs no network, and it
 * is regenerated — never edited — so it cannot drift from the database.
 *
 * If you are here because a host is missing or wrong: fix the row in Supabase,
 * then run `node scripts/generate-route-config.mjs`. Editing this file makes
 * the database and the edge disagree, which is the exact failure the three
 * hand-maintained maps in `src/proxy.ts` are being retired for.
 *
 * There is deliberately no generation timestamp: this file must be diffable
 * against a fresh generation (`--check`) as a drift guard, and a timestamp
 * would make every regeneration a diff.
 *
 * This table is LIVE: `src/proxy.ts` resolves every request host through
 * `src/lib/tenancy/host-scope.ts`, which reads it. A wrong row here is a
 * wrong site at the edge, so regenerate — never hand-edit.
 */

/** How a host came to be in this table. See scripts/generate-route-config.mjs. */
export type GeneratedHostKind =
  | 'custom-domain'
  | 'platform-alias'
  | 'preview-subdomain'
  | 'localhost-subdomain'

/** One normalised host and the project scope it serves. */
export interface GeneratedHostRoute {
  /** Normalised: lowercase, no port, no trailing dot, no leading `www.`. */
  host: string
  hostKind: GeneratedHostKind
  /** `tenants.slug` — the CUSTOMER. */
  tenantSlug: string
  /** `projects.slug` — the WEBSITE. */
  projectSlug: string
  /** `projects.id` — the stable UUID; slugs are renameable, this is not. */
  projectId: string
  /** `projects.default_locale`. */
  defaultLocale: string
  /**
   * `projects.status`: 'draft' | 'preview' | 'active' | 'inactive'.
   * What each one serves depends on the ROW'S `hostKind` — see
   * `servesOnHostKind()` in host-scope.ts. In short: 'active' everywhere,
   * 'preview' on preview/localhost hosts only, 'draft' and 'inactive' nowhere.
   */
  status: string
}

/** Sorted by host. Host is unique across the table — collisions throw at generation. */
export const GENERATED_HOST_ROUTES: readonly GeneratedHostRoute[] = [
  {
    host: "abluo.app",
    hostKind: "custom-domain",
    tenantSlug: "abluo",
    projectSlug: "abluo",
    projectId: "84702a83-b59a-434d-8dd4-99ea7292f873",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "abluo.localhost",
    hostKind: "localhost-subdomain",
    tenantSlug: "abluo",
    projectSlug: "abluo",
    projectId: "84702a83-b59a-434d-8dd4-99ea7292f873",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "abluo.preview.abluo.app",
    hostKind: "preview-subdomain",
    tenantSlug: "abluo",
    projectSlug: "abluo",
    projectId: "84702a83-b59a-434d-8dd4-99ea7292f873",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "amelie.localhost",
    hostKind: "localhost-subdomain",
    tenantSlug: "amelie",
    projectSlug: "amelie",
    projectId: "fb34c7e4-6ecf-489a-b56a-8acbf75909cd",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "amelie.preview.abluo.app",
    hostKind: "preview-subdomain",
    tenantSlug: "amelie",
    projectSlug: "amelie",
    projectId: "fb34c7e4-6ecf-489a-b56a-8acbf75909cd",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "ch-psicoterapeuta.com",
    hostKind: "custom-domain",
    tenantSlug: "hoffmann",
    projectSlug: "hoffmann",
    projectId: "6d709178-f33a-4b4a-be52-521189e11290",
    defaultLocale: "it",
    status: "active",
  },
  {
    host: "dev.abluo.app",
    hostKind: "platform-alias",
    tenantSlug: "abluo",
    projectSlug: "abluo",
    projectId: "84702a83-b59a-434d-8dd4-99ea7292f873",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "hoffmann.localhost",
    hostKind: "localhost-subdomain",
    tenantSlug: "hoffmann",
    projectSlug: "hoffmann",
    projectId: "6d709178-f33a-4b4a-be52-521189e11290",
    defaultLocale: "it",
    status: "active",
  },
  {
    host: "hoffmann.preview.abluo.app",
    hostKind: "preview-subdomain",
    tenantSlug: "hoffmann",
    projectSlug: "hoffmann",
    projectId: "6d709178-f33a-4b4a-be52-521189e11290",
    defaultLocale: "it",
    status: "active",
  },
  {
    host: "livener.localhost",
    hostKind: "localhost-subdomain",
    tenantSlug: "livener",
    projectSlug: "livener",
    projectId: "6cf3b0d5-e878-4625-a231-f0b0176d4c4f",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "livener.net",
    hostKind: "custom-domain",
    tenantSlug: "livener",
    projectSlug: "livener",
    projectId: "6cf3b0d5-e878-4625-a231-f0b0176d4c4f",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "livener.preview.abluo.app",
    hostKind: "preview-subdomain",
    tenantSlug: "livener",
    projectSlug: "livener",
    projectId: "6cf3b0d5-e878-4625-a231-f0b0176d4c4f",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "nologo.cloud",
    hostKind: "custom-domain",
    tenantSlug: "freeriders",
    projectSlug: "nologo",
    projectId: "cd14c981-e458-48b6-9cd3-bb8c089d5cbc",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "nologo.localhost",
    hostKind: "localhost-subdomain",
    tenantSlug: "freeriders",
    projectSlug: "nologo",
    projectId: "cd14c981-e458-48b6-9cd3-bb8c089d5cbc",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "nologo.preview.abluo.app",
    hostKind: "preview-subdomain",
    tenantSlug: "freeriders",
    projectSlug: "nologo",
    projectId: "cd14c981-e458-48b6-9cd3-bb8c089d5cbc",
    defaultLocale: "en",
    status: "active",
  },
  {
    host: "studiomartegani.com",
    hostKind: "custom-domain",
    tenantSlug: "studiomartegani",
    projectSlug: "studiomartegani",
    projectId: "58980fd3-0c72-4549-9a8c-f42ca6d5750a",
    defaultLocale: "it",
    status: "active",
  },
  {
    host: "studiomartegani.localhost",
    hostKind: "localhost-subdomain",
    tenantSlug: "studiomartegani",
    projectSlug: "studiomartegani",
    projectId: "58980fd3-0c72-4549-9a8c-f42ca6d5750a",
    defaultLocale: "it",
    status: "active",
  },
  {
    host: "studiomartegani.preview.abluo.app",
    hostKind: "preview-subdomain",
    tenantSlug: "studiomartegani",
    projectSlug: "studiomartegani",
    projectId: "58980fd3-0c72-4549-9a8c-f42ca6d5750a",
    defaultLocale: "it",
    status: "active",
  },
  {
    host: "t42.localhost",
    hostKind: "localhost-subdomain",
    tenantSlug: "freeriders",
    projectSlug: "t42",
    projectId: "eaab108c-3dca-471a-a16c-d6db96a74fe4",
    defaultLocale: "en",
    status: "inactive",
  },
  {
    host: "t42.preview.abluo.app",
    hostKind: "preview-subdomain",
    tenantSlug: "freeriders",
    projectSlug: "t42",
    projectId: "eaab108c-3dca-471a-a16c-d6db96a74fe4",
    defaultLocale: "en",
    status: "inactive",
  },
] as const

/**
 * Hosts the platform serves that resolve to NO project, ever. Present so a
 * caller can distinguish "known platform host" from "host I have never heard
 * of" — both resolve to null, but only the second one is a bug.
 */
export const GENERATED_PLATFORM_HOSTS: readonly string[] = [
  "admin.abluo.app",
  "localhost",
  "preview.abluo.app",
] as const
