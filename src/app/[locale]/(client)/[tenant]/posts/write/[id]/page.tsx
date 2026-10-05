import { notFound, redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import type { PortableTextBlock } from '@portabletext/editor'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { dashboardHomeHref, resolveProjectGrant } from '@/lib/modules/client-navigation'
import { getPostDraft, getPostEditorSite, PostDraftError } from '@/lib/api/post-drafts'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { WizardShell } from '@/components/client/create/WizardShell'
import type { DraftSnapshot } from '@/components/client/create/types'

/**
 * The guided creation wizard for one blog-post draft (ADR-025 · S2c):
 * `/{locale}/{projectSlug}/posts/write/{draftId}`.
 *
 * Nested under `posts`, so the client-surface gate already covers it (no new
 * CLIENT_PROJECT_SEGMENTS entry). The slug is re-validated against the
 * caller's grants; the draft is read through `getPostDraft`, which needs
 * 'blog.post.write' and re-checks ownership — a viewer, another project's
 * draft or an unknown id all get the same 404.
 */
export const dynamic = 'force-dynamic'

export default async function WriteDraftPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: projectSlug, id } = await params

  const ctx = await getTenantAuthorizationContext()
  if (!ctx) redirect(`/login?next=/${projectSlug}/posts/write/${encodeURIComponent(id)}`)

  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) notFound()

  const locale = await getLocale()
  let draft: Awaited<ReturnType<typeof getPostDraft>>
  let site: Awaited<ReturnType<typeof getPostEditorSite>>
  try {
    ;[draft, site] = await Promise.all([
      getPostDraft(ctx, grant.projectId, id),
      getPostEditorSite(ctx, grant.projectId, { locale }),
    ])
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof PostDraftError && error.code === 'not_found') notFound()
    throw error
  }

  const snapshot: DraftSnapshot = { ...draft, body: draft.body as Record<string, PortableTextBlock[]> }

  return <WizardShell draft={snapshot} site={site} homeHref={dashboardHomeHref(projectSlug)} />
}
