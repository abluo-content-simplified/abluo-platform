import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { resolveProjectGrant } from '@/lib/modules/client-navigation'
import {
  getDashboardPostList,
  type DashboardPostList,
  type DashboardPostRow,
} from '@/lib/api/client-dashboard'
import { PostsBrowser, type BrowserPost } from '@/components/client/posts/PostsBrowser'
import { TenantAuthorizationError } from '@/lib/api/tenant-scoped-sanity'
import { listPostDrafts, type PostDraftSummary } from '@/lib/api/post-drafts'

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
 * no hardcoded strings (Multilingual-First).
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
  const t = await getTranslations('clientDashboard')

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

  return (
    <Shell title={t('posts.title')}>
      {moduleNotInstalled ? (
        <p className="text-sm text-muted-foreground">{t('posts.moduleNotInstalled')}</p>
      ) : list.posts.length === 0 && drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('posts.emptyNoPosts')}</p>
      ) : (
        <PostsBrowser
          posts={[
            ...drafts
              .filter((d) => !list.posts.some((p) => p._id === d.id))
              .map((d) => draftToBrowserPost(d, projectSlug, list, locale, t)),
            ...list.posts.map((post) => toBrowserPost(post, locale, t)),
          ]}
          languages={list.languages}
          categories={list.categories}
          initialQuery={toQueryString(await searchParams)}
        />
      )}
    </Shell>
  )
}

/** Minimal page frame inside the dashboard shell. */
function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="max-w-3xl space-y-5">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children}
    </div>
  )
}

/** Locale-aware date formatting; falls back to the raw ISO string on error. */
function formatDate(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
  } catch {
    return iso
  }
}

type T = Awaited<ReturnType<typeof getTranslations<'clientDashboard'>>>

/** The one date that matters for each state. */
function dateLine(post: DashboardPostRow, locale: string, t: T): string {
  switch (post.status) {
    case 'published':
      return t('posts.meta.published', { date: formatDate(post.publishedAt ?? post.updatedAt, locale) })
    case 'scheduled':
      return t('posts.meta.scheduled', { date: formatDate(post.publishedAt ?? post.updatedAt, locale) })
    case 'offline':
      return t('posts.meta.offlineSince', { date: formatDate(post.expiresAt ?? post.updatedAt, locale) })
    default:
      return t('posts.meta.edited', { date: formatDate(post.updatedAt, locale) })
  }
}

/** Server-side formatting (dates in one place, no hydration drift). */
function toBrowserPost(post: DashboardPostRow, locale: string, t: T): BrowserPost {
  return {
    _id: post._id,
    title: post.title ?? t('posts.untitled'),
    subtitle: post.subtitle ?? null,
    status: post.status,
    statusLabel: t(`posts.status.${post.status}`),
    searchText: post.searchText,
    categoryKeys: post.categoryKeys ?? [],
    categories: post.categories,
    languages: post.languages,
    primaryDate: post.status === 'draft' ? post.updatedAt : post.publishedAt ?? post.updatedAt,
    updatedAt: post.updatedAt,
    dateLabel: dateLine(post, locale, t),
    offlineLabel:
      post.expiresAt && post.status !== 'offline'
        ? t('posts.meta.offlineOn', { date: formatDate(post.expiresAt, locale) })
        : null,
  }
}

/** A wizard draft as a list row: status draft, opens the wizard. */
function draftToBrowserPost(
  draft: PostDraftSummary,
  projectSlug: string,
  list: DashboardPostList,
  locale: string,
  t: T
): BrowserPost {
  const label = new Map(list.categories.map((c) => [c.value, c.label]))
  const texts = Object.values(draft.titles).join(' \n ')
  return {
    _id: draft.id,
    title: draft.title ?? t('posts.untitledDraft'),
    subtitle: null,
    status: 'draft',
    statusLabel: t('posts.status.draft'),
    searchText: texts.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(),
    categoryKeys: draft.categoryKeys,
    categories: draft.categoryKeys.map((k) => label.get(k) ?? k.replace(/-/g, ' ')),
    languages: list.languages.filter((l) => draft.titles[l]?.trim()),
    primaryDate: draft.updatedAt,
    updatedAt: draft.updatedAt,
    dateLabel: t('posts.meta.edited', { date: formatDate(draft.updatedAt, locale) }),
    offlineLabel: null,
    href: `/${projectSlug}/posts/write/${draft.id}`,
  }
}

function toQueryString(sp: Record<string, string | string[] | undefined>): string {
  const out = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) if (typeof v === 'string') out.set(k, v)
  return out.toString()
}
