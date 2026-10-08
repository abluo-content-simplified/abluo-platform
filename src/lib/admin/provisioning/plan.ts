/**
 * The step planner (pure): wizard input + the facts read at start → every
 * Supabase row and Sanity document the new project needs, with deterministic
 * ids, in the order they must be written.
 *
 * The plan is computed ONCE, when the run starts, and stored on the run
 * (`project_provisioning_runs.plan`). A retry replays the stored plan — it
 * never re-plans — so a design-system copy, ids and placeholder text cannot
 * drift between attempts.
 *
 * Shapes follow what the platform already reads, and how existing tenants were
 * bootstrapped (No!Logo / TMZ provisioning, `AutoCreateSiteConfigAction`,
 * `ProjectLinker`):
 *   • client      — tenantId, tenantSlug, displayName (ProjectLinker reads these)
 *   • project     — clientRef, projectId, projectSlug, projectName, tenantId,
 *                   tenantSlug, defaultLocale, status, designSystemRef
 *   • siteConfig  — projectSlug, siteName, defaultLocale, supportedLocales
 *   • home page   — `page` with pageType "home" (the legacy `homePage` type is
 *                   not used for new projects), slug "home" per language
 */
import type { SupportedLocale } from '@/lib/i18n/locales'
import { buildProjectDesignSystem, type DesignSystemSource, type NewDesignSystemDoc, type SanityReference } from './design-system-copy'
import { NEW_PROJECT_STATUS, PROVISION_STEPS, sanityDocIds, type ProvisionStepId, type ValidWizardInput } from './model'
import { START_PAGE_COPY } from './placeholders'

export const PLAN_VERSION = 1

export type PlanContext = {
  /** The existing client's id, or a fresh UUID for a new client — chosen once, at start. */
  tenantId: string
  /** A fresh UUID for the new project — chosen once, at start. */
  projectId: string
  /** The client as it is (existing) or will be (new). */
  tenant: { slug: string; name: string }
  /** The existing client's Sanity `client` document, when there is one. */
  existingClientDocId: string | null
  /** The picked design system, as read from Sanity at start. */
  designSystem: DesignSystemSource
}

type Doc = Record<string, unknown> & { _id: string; _type: string }

export type ProvisioningPlan = {
  version: typeof PLAN_VERSION
  tenantId: string
  projectId: string
  tenantSlug: string
  projectSlug: string
  supabase: {
    tenant: { mode: 'existing'; id: string } | { mode: 'new'; row: { id: string; slug: string; display_name: string; status: 'active' } }
    project: {
      row: {
        id: string
        slug: string
        tenant_id: string
        name: string
        default_locale: string
        status: typeof NEW_PROJECT_STATUS
        custom_domain: null
      }
    }
  }
  sanity: {
    client: { mode: 'existing'; id: string } | { mode: 'new'; doc: Doc }
    designSystem: NewDesignSystemDoc
    project: Doc
    siteConfig: Doc
    homePage: Doc
  }
  invite: { email: string; name: string; role: 'owner'; locale: SupportedLocale } | null
  /** The steps this run executes, in order. */
  steps: ProvisionStepId[]
}

const ref = (id: string): SanityReference => ({ _type: 'reference', _ref: id })

function localized<T extends 'localizedString' | 'localizedText'>(type: T, locales: readonly SupportedLocale[], value: (l: SupportedLocale) => string) {
  return { _type: type, ...Object.fromEntries(locales.map((l) => [l, value(l)])) }
}

function block(key: string, text: string) {
  return { _type: 'block', _key: key, style: 'normal', markDefs: [], children: [{ _type: 'span', _key: `${key}s`, text, marks: [] }] }
}

/** The start page: one hero, one text section, placeholder copy in every supported language. */
export function buildHomePage(id: string, projectSlug: string, projectName: string, locales: readonly SupportedLocale[]): Doc {
  return {
    _id: id,
    _type: 'page',
    projectSlug,
    pageType: 'home',
    title: localized('localizedString', locales, (l) => START_PAGE_COPY[l].pageTitle),
    slug: { _type: 'localizedSlug', ...Object.fromEntries(locales.map((l) => [l, { _type: 'slug', current: 'home' }])) },
    backgroundPattern: 'none',
    sections: [
      {
        _type: 'heroSection',
        _key: 'hero',
        background: 'usePagePattern',
        variant: 'standard',
        headline: localized('localizedText', locales, () => projectName),
        subheadline: localized('localizedText', locales, (l) => START_PAGE_COPY[l].heroSubheadline),
      },
      {
        _type: 'textSection',
        _key: 'intro',
        background: 'usePagePattern',
        title: localized('localizedString', locales, (l) => START_PAGE_COPY[l].textTitle),
        content: { _type: 'localizedPortableText', ...Object.fromEntries(locales.map((l) => [l, [block('p1', START_PAGE_COPY[l].textBody)]])) },
      },
    ],
  }
}

export function planProvisioning(input: ValidWizardInput, ctx: PlanContext): ProvisioningPlan {
  const { project } = input
  const ids = sanityDocIds(project.slug, ctx.tenant.slug)
  const clientDocId = ctx.existingClientDocId ?? ids.client
  const locales = project.supportedLocales

  const tenant: ProvisioningPlan['supabase']['tenant'] =
    input.client.mode === 'existing'
      ? { mode: 'existing', id: ctx.tenantId }
      : { mode: 'new', row: { id: ctx.tenantId, slug: ctx.tenant.slug, display_name: ctx.tenant.name, status: 'active' } }

  const client: ProvisioningPlan['sanity']['client'] = ctx.existingClientDocId
    ? { mode: 'existing', id: ctx.existingClientDocId }
    : { mode: 'new', doc: { _id: ids.client, _type: 'client', tenantId: ctx.tenantId, tenantSlug: ctx.tenant.slug, displayName: ctx.tenant.name } }

  const designSystem = buildProjectDesignSystem(ctx.designSystem, { docId: ids.designSystem, projectSlug: project.slug, name: project.name })

  const projectDoc: Doc = {
    _id: ids.project,
    _type: 'project',
    clientRef: ref(clientDocId),
    projectId: ctx.projectId,
    projectSlug: project.slug,
    projectName: project.name,
    tenantId: ctx.tenantId,
    tenantSlug: ctx.tenant.slug,
    defaultLocale: project.defaultLocale,
    // Sanity's own status list is active / inactive / archived; it only feeds
    // the sitemap and llms.txt (`status == "active"`). Routing is decided by
    // the Supabase status. A site that is not launched stays out of both.
    status: 'inactive',
    designSystemRef: ref(ids.designSystem),
  }

  const siteConfig: Doc = {
    _id: ids.siteConfig,
    _type: 'siteConfig',
    projectSlug: project.slug,
    siteName: project.name,
    defaultLocale: project.defaultLocale,
    supportedLocales: [...locales],
  }

  const invite = input.owner ? { email: input.owner.email, name: input.owner.name, role: 'owner' as const, locale: project.defaultLocale } : null

  return {
    version: PLAN_VERSION,
    tenantId: ctx.tenantId,
    projectId: ctx.projectId,
    tenantSlug: ctx.tenant.slug,
    projectSlug: project.slug,
    supabase: {
      tenant,
      project: {
        row: {
          id: ctx.projectId,
          slug: project.slug,
          tenant_id: ctx.tenantId,
          name: project.name,
          default_locale: project.defaultLocale,
          status: NEW_PROJECT_STATUS,
          custom_domain: null,
        },
      },
    },
    sanity: {
      client,
      designSystem,
      project: projectDoc,
      siteConfig,
      homePage: buildHomePage(ids.homePage, project.slug, project.name, locales),
    },
    invite,
    steps: PROVISION_STEPS.filter((s) => s !== 'invite.owner' || invite !== null),
  }
}
