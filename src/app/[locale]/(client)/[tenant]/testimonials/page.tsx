import { notFound, redirect } from 'next/navigation'
import { landingListQuery } from '@/lib/client/search-landing'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  listTestimonials,
  readTestimonialNames,
  TESTIMONIAL_DELETE_PERMISSION,
  TESTIMONIAL_PRIVATE_READ_PERMISSION,
  TESTIMONIAL_READ_PERMISSION,
  TESTIMONIAL_WRITE_PERMISSION,
  type TestimonialListItem,
  type TestimonialSite,
} from '@/lib/api/testimonials'
import { listTestimonialSubmissions, type TestimonialSubmission } from '@/lib/api/testimonial-submissions'
import { readTestimonialsDashboardConfig } from '@/lib/api/testimonials-config'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { TestimonialsScreen } from '@/components/client/testimonials/TestimonialsScreen'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * Client dashboard — Testimonials (ADR-048 D9), in the shared page frame: the
 * project's testimonials as a table (or cards), and — for people who may see
 * who gave them — the Submissions tab (Phase 2). Reads through
 * `listTestimonials` (testimonials.read, project-scoped); a project without
 * the Testimonials module gets a 404 like any unknown page. Filters live in
 * the query string; `?new=1` creates a draft and opens it; `?tab=submissions`
 * opens the second tab.
 */
export const dynamic = 'force-dynamic'

export default async function TestimonialsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug } = await params
  const address = await searchParams
  const query = landingListQuery(address)
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/testimonials`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !grant.permissions.includes(TESTIMONIAL_READ_PERMISSION)) notFound()
  const canSeePrivate = grant.permissions.includes(TESTIMONIAL_PRIVATE_READ_PERMISSION)

  let testimonials: TestimonialListItem[]
  let site: TestimonialSite
  try {
    const result = await listTestimonials(ctx, grant.projectId)
    testimonials = result.testimonials
    site = result.site
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    throw error
  }
  const config = await readTestimonialsDashboardConfig(ctx, grant.projectId)
  const names = canSeePrivate
    ? Object.fromEntries(await readTestimonialNames(ctx, grant.projectId, testimonials.map((t) => t.publicId)).catch(() => new Map<string, string>()))
    : {}

  let submissions: TestimonialSubmission[] | null = null
  if (canSeePrivate) {
    try {
      submissions = await listTestimonialSubmissions(ctx, grant.projectId)
    } catch {
      submissions = null
    }
  }
  const tabParam = Array.isArray(address.tab) ? address.tab[0] : address.tab

  return (
    <PageShell>
      <TestimonialsScreen
        projectSlug={projectSlug}
        testimonials={testimonials}
        names={names}
        defaultLocale={site.defaultLocale}
        languages={site.languages}
        timeZone={config.timeZone}
        canWrite={grant.permissions.includes(TESTIMONIAL_WRITE_PERMISSION)}
        canDelete={grant.permissions.includes(TESTIMONIAL_DELETE_PERMISSION)}
        submissions={submissions}
        submissionsLoadFailed={canSeePrivate && submissions === null}
        acceptSubmissions={config.acceptSubmissions}
        initialTab={canSeePrivate && tabParam === 'submissions' ? 'submissions' : 'testimonials'}
        initialQuery={query}
      />
    </PageShell>
  )
}
