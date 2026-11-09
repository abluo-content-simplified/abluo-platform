/**
 * What the Testimonials dashboard needs from the project's settings, in one
 * read: whether the module accepts testimonials from visitors (module config
 * `acceptSubmissions`, ADR-048 D10) and the site's time zone (dates are shown
 * in project local time). Needs testimonials.read; the project comes from the
 * GRANT, never from the caller.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { TESTIMONIAL_ACCEPT_SUBMISSIONS_KEY, TESTIMONIALS_MODULE_ID, TESTIMONIAL_PERMISSIONS } from '@/lib/modules/testimonials/model'

export interface TestimonialsDashboardConfig {
  acceptSubmissions: boolean
  timeZone: string | null
}

type Reader = { fetch: (query: string, params: Record<string, unknown>) => Promise<unknown> }

export const TESTIMONIALS_CONFIG_QUERY = `{
  "accept": *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].moduleInstallations[moduleId == $moduleId && enabled != false][0].config.${TESTIMONIAL_ACCEPT_SUBMISSIONS_KEY},
  "timeZone": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].timeZone
}`

export async function readTestimonialsDashboardConfig(
  ctx: TenantAuthorizationContext,
  projectId: string,
  deps: { client?: Reader } = {}
): Promise<TestimonialsDashboardConfig> {
  assertModuleAction(ctx, projectId, TESTIMONIAL_PERMISSIONS.read)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  const client = deps.client ?? (sanityWriteClient as unknown as Reader)
  try {
    const r = (await client.fetch(TESTIMONIALS_CONFIG_QUERY, { projectSlug: grant.projectSlug, moduleId: TESTIMONIALS_MODULE_ID })) as { accept?: unknown; timeZone?: unknown } | null
    return { acceptSubmissions: r?.accept === true, timeZone: typeof r?.timeZone === 'string' && r.timeZone ? r.timeZone : null }
  } catch {
    // The list works without it: no time zone (the viewer's own) and the form shown as off.
    return { acceptSubmissions: false, timeZone: null }
  }
}
