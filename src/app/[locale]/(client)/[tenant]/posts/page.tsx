import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  getDashboardPostList,
  type DashboardPostList,
  type DashboardPostRow,
} from '@/lib/api/client-dashboard'
import { PostsBrowser } from '@/components/client/posts/PostsBrowser'
import { PageHeader } from '@/components/client/ui/PageHeader'
import { NewPostLink } from '@/components/client/posts/post-bits'
import type { BrowserPost } from '@/components/client/posts/types'
import { postSearchText } from '@/lib/client/posts-filter'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { listPostDrafts, type PostDraftSummary } from '@/lib/api/post-drafts'
import { canDeletePublished } from '@/lib/api/post-lifecycle'
import { getProjectSiteDomain } from '@/lib/api/client-dashboard'

/**
 * Client dashboard — Posts list. ADR-017 slice 6 (Phase 1 read path) relocated
 * under the `[tenant]` (projectSlug) segment in Phase 2 (task #81).
 *
 * The active project is now the URL's first path segment (`params.tenant`),
 * re-validated against `ctx.projects` via `resolveProjectGrant` — the ADR-017
 * no-silent-substitute rule (Tom's locked decision #1). An ungranted slug is a
 * `notFound()`, never a fallback to `ctx.projects[0]` (the Phase 1 behaviour
 * this page replaces).
 *
 * Defence in depth: `[tenant]/layout.tsx` already validates the slug and the
 * `(client)` layout already gates the session, but this page still checks both
 * itself — the same belt-and-braces posture as the rest of the dashboard.
 *
 * All user-facing copy comes from the `clientDashboard` next-intl namespace —
 * no hardcoded strings (Multilingual-First). Dates go to the browser as ISO
 * strings and are formatted there, in the viewer's own time zone.
 */
export default async function PostsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { tenant: projectSlug } = await params

  const ctx = await getTenantAuthorizationContext()
  if (!ctx) {
    redirect(`/login?next=/${projectSlug}/posts`)
  }

  const grant = resolveProjectGrant(ctx.projects, projectSlug)
  if (!grant) {
    notFound()
  }

  const locale = await getLocale()
  const canEdit = grant.permissions.includes('blog.post.write')
  const t = await getTranslations('clientDashboard')

  const domain = await getProjectSiteDomain(ctx, grant.projectId).catch(() => null)
  let list: DashboardPostList = { posts: [], languages: [], categories: [] }
  let drafts: PostDraftSummary[] = []
  let moduleNotInstalled = false
  try {
    ;[list, drafts] = await Promise.all([
      getDashboardPostList(ctx, grant.projectId, { locale }),
      // Wizard drafts (ADR-025) live in the drafts perspective; only people who
      // can edit see them. A viewer simply gets none — never an error.
      listPostDrafts(ctx, grant.projectId).catch((error) => {
        if (error instanceof TenantAuthorizationError) return []
        throw error
      }),
    ])
  } catch (error) {
    // A denial here (most likely: the blog module is not installed for this
    // project) is an expected, localized state — not a crash. Anything that
    // is NOT a TenantAuthorizationError is a real fault and re-thrown.
    if (error instanceof TenantAuthorizationError) {
      moduleNotInstalled = true
    } else {
      throw error
    }
  }

  const site = list.defaultLocale ?? locale
  const draftById = new Map(drafts.map((d) => [d.id, d]))
  const posts: BrowserPost[] = [
    ...drafts
      .filter((d) => !list.posts.some((p) => p._id === d.id))
      .map((d) => draftToBrowserPost(d, projectSlug, list, locale, t)),
    ...list.posts.map((post) => {
      const draft = draftById.get(post._id)
      return {
        ...toBrowserPost(post, list.languages, t),
        // Live posts open on their overview (a copy is made on first open).
        href: canEdit ? `/${projectSlug}/posts/write/${post._id}` : null,
        badge: draft ? t('posts.unpublishedChanges') : null,
        // The last edit of either version.
        updatedAt: latest(post.updatedAt, draft?.updatedAt),
        hasLive: true,
        hasDraft: Boolean(draft),
        liveUrl: domain && post.status === 'published' && post.slugDefault ? `https://${domain}/${site}/blog/${post.slugDefault}` : null,
        previewLocale: site,
      }
    }),
  ]

  return (
    <div className="max-w-6xl space-y-5">
      {moduleNotInstalled || posts.length === 0 ? (
        <>
          <PageHeader
            title={t('posts.title')}
            actions={canEdit && !moduleNotInstalled ? <NewPostLink href={`/${projectSlug}/posts/write/new`} label={t('posts.newPost')} /> : null}
          />
          <p className="text-sm text-muted-foreground">
            {moduleNotInstalled ? t('posts.moduleNotInstalled') : t('posts.emptyNoPosts')}
          </p>
        </>
      ) : (
        <PostsBrowser
          title={t('posts.title')}
          posts={posts}
          languages={list.languages}
          categories={list.categories}
          initialQuery={toQueryString(await searchParams)}
          projectSlug={projectSlug}
          canEdit={canEdit}
          canDeleteLive={canDeletePublished(grant)}
        />
      )}
    </div>
  )
}

type T = Awaited<ReturnType<typeof getTranslations<'clientDashboard'>>>

function latest(a: string, b?: string): string {
  if (!b) return a
  return (Date.parse(b) || 0) > (Date.parse(a) || 0) ? b : a
}

/** Every site language with its state; `complete` = title and body in that language. */
function languageStates(languages: string[], complete: (code: string) => boolean) {
  return languages.map((code) => ({ code, complete: complete(code) }))
}

/** A published (live / scheduled / offline) post as a list row. */
function toBrowserPost(post: DashboardPostRow, languages: string[], t: T): BrowserPost {
  const states = languageStates(languages, (l) => post.completeLanguages.includes(l))
  return {
    _id: post._id,
    title: post.title ?? t('posts.untitled'),
    subtitle: post.subtitle ?? null,
    status: post.status,
    searchText: post.searchText,
    categoryKeys: post.categoryKeys ?? [],
    categories: post.categories,
    languages: post.languages,
    primaryDate: post.status === 'draft' ? post.updatedAt : post.publishedAt ?? post.updatedAt,
    updatedAt: post.updatedAt,
    publishedAt: post.publishedAt ?? null,
    expiresAt: post.expiresAt ?? null,
    featured: post.featured === true,
    languageStates: states,
    translationsComplete: states.length ? states.every((s) => s.complete) : undefined,
    thumb: post.coverThumb,
    cardImage: post.coverCard,
  }
}

/** A wizard draft (never published) as a list row: status draft, opens the wizard. */
function draftToBrowserPost(
  draft: PostDraftSummary,
  projectSlug: string,
  list: DashboardPostList,
  locale: string,
  t: T
): BrowserPost {
  const label = new Map(list.categories.map((c) => [c.value, c.label]))
  const states = languageStates(list.languages, (l) => Boolean(draft.titles[l]?.trim()) && draft.bodyLanguages.includes(l))
  return {
    _id: draft.id,
    title: draft.title ?? t('posts.untitledDraft'),
    subtitle: draft.subtitle ?? null,
    status: 'draft',
    searchText: draft.searchText ?? postSearchText({ titles: draft.titles }),
    categoryKeys: draft.categoryKeys,
    categories: draft.categoryKeys.map((k) => label.get(k) ?? k.replace(/-/g, ' ')),
    languages: list.languages.filter((l) => draft.titles[l]?.trim()),
    primaryDate: draft.updatedAt,
    updatedAt: draft.updatedAt,
    publishedAt: null,
    expiresAt: null,
    featured: draft.featured,
    languageStates: states,
    translationsComplete: states.length ? states.every((s) => s.complete) : undefined,
    href: `/${projectSlug}/posts/write/${draft.id}`,
    thumb: draft.coverThumb,
    cardImage: draft.coverCard,
    hasLive: false,
    hasDraft: true,
    liveUrl: null,
    previewLocale: list.defaultLocale ?? Object.keys(draft.titles)[0] ?? locale,
  }
}

function toQueryString(sp: Record<string, string | string[] | undefined>): string {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') out.set(k, v)
  return out.toString()
}
