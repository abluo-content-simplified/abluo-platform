import { notFound, redirect } from 'next/navigation'
import { getLocale } from 'next-intl/server'
import type { PortableTextBlock } from '@portabletext/editor'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { dashboardHomeHref, resolveProjectGrant } from '@/lib/modules/client-navigation'
import { getPostDraft, getPostEditorSite, PostDraftError } from '@/lib/api/post-drafts'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { WizardShell } from '@/components/client/create/WizardShell'
import type { DraftSnapshot } from '@/components/client/create/types'
import { OpenForEdit } from '@/components/client/create/OpenForEdit'
import { canDeletePublished, canOpenPublishedPost } from '@/lib/api/post-lifecycle'
import { getAiFeatureFlags } from '@/lib/ai/features'
import { getViewerFirstName } from '@/lib/api/viewer-profile'

/**
 * The guided creation wizard for one blog-post draft (ADR-025 · S2c):
 * `/{locale}/{projectSlug}/posts/write/{draftId}`.
 *
 * Nested under `posts`, so the client-surface gate already covers it (no new
 * CLIENT_PROJECT_SEGMENTS entry). The slug is re-validated against the
 * caller's grants; the draft is read through `getPostDraft`, which needs
 * 'blog.post.write' and re-checks ownership — a viewer, another project's
 * draft or an unknown id all get the same 404.
 *
 * A PUBLISHED post's id with no draft yet renders `OpenForEdit`, which creates
 * the editable copy from the browser (a server action on mount — never on a
 * GET render or a link prefetch) and then reloads into the overview.
 */
export const dynamic = 'force-dynamic'

/** The URL segment of a wizard that has no document yet. */
const NEW_DRAFT_SEGMENT = 'new'

function emptyPostDraft(): Awaited<ReturnType<typeof getPostDraft>> {
  return {
    id: '',
    rev: '',
    title: {},
    subtitle: {},
    excerpt: {},
    body: {},
    categories: [],
    cover: null,
    step: 'type',
    furthest: 'type',
    mode: 'create',
    live: null,
    cta: null,
    gallery: null,
  }
}

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
      // "+ Add content" opens /posts/write/new: an empty wizard, NO document yet.
      // getPostEditorSite is still the write gate (blog.post.write). The first
      // real content creates the draft (lazy creation, WizardShell).
      id === NEW_DRAFT_SEGMENT ? Promise.resolve(emptyPostDraft()) : getPostDraft(ctx, grant.projectId, id),
      getPostEditorSite(ctx, grant.projectId, { locale }),
    ])
  } catch (error) {
    if (error instanceof TenantAuthorizationError) notFound()
    if (error instanceof PostDraftError && error.code === 'not_found') {
      if (await canOpenPublishedPost(ctx, grant.projectId, id)) {
        return <OpenForEdit projectSlug={projectSlug} id={id} postsHref={`/${projectSlug}/posts`} />
      }
      notFound()
    }
    throw error
  }

  const firstName = await getViewerFirstName(ctx)
  const snapshot: DraftSnapshot = { ...draft, body: draft.body as Record<string, PortableTextBlock[]> }

  return (
    <WizardShell
      draft={snapshot}
      // The Gallery step shows only on sites with the Gallery module installed.
      site={{ ...site, firstName, galleries: grant.enabledModuleIds.includes('gallery') ? site.galleries : undefined }}
      homeHref={dashboardHomeHref(projectSlug)}
      postsHref={`/${projectSlug}/posts`}
      canDelete={canDeletePublished(grant)}
      aiImprove={getAiFeatureFlags().improve}
    />
  )
}
