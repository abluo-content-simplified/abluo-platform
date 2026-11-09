import { notFound, redirect } from 'next/navigation'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  getTestimonial,
  getTestimonialPrivate,
  isTestimonialId,
  TESTIMONIAL_DELETE_PERMISSION,
  TESTIMONIAL_PRIVATE_READ_PERMISSION,
  TESTIMONIAL_READ_PERMISSION,
  TESTIMONIAL_WRITE_PERMISSION,
  TestimonialError,
  type TestimonialPrivateRead,
  type TestimonialSnapshot,
} from '@/lib/api/testimonials'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { TESTIMONIALS_MODULE_ID, TESTIMONIAL_TAG_KIND } from '@/lib/modules/testimonials/model'
import { listTerms } from '@/lib/taxonomy/service'
import { toPickerTerm, type PickerTerm } from '@/components/client/taxonomy/term-picker-model'
import { TestimonialEditor } from '@/components/client/testimonials/TestimonialEditor'
import { PageShell } from '@/components/app/ui/PageShell'

/**
 * One testimonial's editor (client dashboard · Testimonials, ADR-048 D9), in
 * the shared page frame. Shows the draft when there is one, else the published
 * testimonial; GET never creates a draft (the editor opens one on the first
 * change). Needs testimonials.read; without testimonials.write the editor is
 * read-only. The private details are only read with testimonials.private.read.
 * Anything not this project's testimonial is a 404.
 */
export const dynamic = 'force-dynamic'

export default async function TestimonialPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug, id } = await params
  const from = (await searchParams).from
  const ctx = await getTenantAuthorizationContext({ purpose: 'render' })
  if (!ctx) redirect(`/login?next=/${projectSlug}/testimonials/${encodeURIComponent(id)}`)
  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant || !isTestimonialId(id) || !grant.permissions.includes(TESTIMONIAL_READ_PERMISSION)) notFound()

  let testimonial: TestimonialSnapshot
  try {
    testimonial = await getTestimonial(ctx, grant.projectId, id)
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof TestimonialError && error.code === 'not_found') notFound()
    throw error
  }

  const canSeePrivate = grant.permissions.includes(TESTIMONIAL_PRIVATE_READ_PERMISSION)
  let priv: TestimonialPrivateRead | null = null
  if (canSeePrivate) {
    try {
      priv = await getTestimonialPrivate(ctx, grant.projectId, { id })
    } catch {
      priv = { available: false }
    }
  }
  let tagTerms: PickerTerm[] = []
  try {
    tagTerms = (await listTerms(ctx, grant.projectId, TESTIMONIALS_MODULE_ID, TESTIMONIAL_TAG_KIND)).terms.map((x) => toPickerTerm(x))
  } catch {
    tagTerms = []
  }

  return (
    <PageShell>
      <TestimonialEditor
        key={testimonial.id}
        projectSlug={projectSlug}
        initial={testimonial}
        initialPrivate={priv}
        tagTerms={tagTerms}
        canWrite={grant.permissions.includes(TESTIMONIAL_WRITE_PERMISSION)}
        canDelete={grant.permissions.includes(TESTIMONIAL_DELETE_PERMISSION)}
        canAddTag={grant.permissions.includes('testimonials.taxonomy.write')}
        canTranslate={grant.enabledModuleIds.includes('translate')}
        createdFrom={from === 'submission' || from === 'submission-no-consent' ? from : null}
      />
    </PageShell>
  )
}
