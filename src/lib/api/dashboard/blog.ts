/**
 * Dashboard provider — Blog (ADR-029 §3.2). Reads through the existing
 * enforced data layer only: `getDashboardPostList` (assertModuleAction
 * blog.post.read → tenant-scoped client) and `listPostDrafts`
 * (assertModuleAction blog.post.write). Home calls it only when a blog widget
 * or blog attention rule is visible, and asks only for the reads it needs.
 */
import { getDashboardPostList, type DashboardPostList, type DashboardPostRow } from '@/lib/api/client-dashboard'
import { listPostDrafts, type PostDraftSummary } from '@/lib/api/post-drafts'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { settle } from '@/lib/api/dashboard/settle'
import {
  missingLanguageRule,
  scheduledSoonRule,
  staleDraftsRule,
  type AttentionItem,
  type AttentionRuleId,
} from '@/lib/client/attention'

export type BlogGlance = { published: number; scheduled: number; drafts: number }

export type BlogDashboard = {
  /** null when not read or not allowed. */
  list: DashboardPostList | null
  drafts: PostDraftSummary[] | null
  glance: BlogGlance | null
  attention: AttentionItem[]
}

export type BlogAttentionInput = {
  rules: ReadonlySet<AttentionRuleId>
  /** Links (derived from the surface registry by the caller). */
  hrefs: { drafts: string; scheduled: string; missingLanguage: string }
  untitled: string
  when: (iso: string) => string
  now?: number
}

/** Counts for the "Posts" tile. Drafts = never-published posts, each counted once. */
export function blogGlance(posts: readonly Pick<DashboardPostRow, '_id' | 'status'>[], drafts: readonly Pick<PostDraftSummary, 'id' | 'hasLive'>[] | null): BlogGlance {
  const draftIds = new Set(posts.filter((p) => p.status === 'draft').map((p) => p._id))
  for (const d of drafts ?? []) if (!d.hasLive) draftIds.add(d.id)
  return {
    published: posts.filter((p) => p.status === 'published').length,
    scheduled: posts.filter((p) => p.status === 'scheduled').length,
    drafts: draftIds.size,
  }
}

/** The blog's attention items from data already read. Pure. */
export function blogAttention(list: DashboardPostList | null, drafts: PostDraftSummary[] | null, input: BlogAttentionInput): AttentionItem[] {
  const now = input.now ?? Date.now()
  const out: (AttentionItem | null)[] = []
  if (drafts && input.rules.has('stalePostDrafts')) {
    out.push(staleDraftsRule('post', drafts.map((d) => ({ updatedAt: d.updatedAt, title: d.title ?? input.untitled })), input.hrefs.drafts, now))
  }
  if (list && input.rules.has('scheduledSoon')) {
    out.push(scheduledSoonRule(list.posts.map((p) => ({ ...p, title: p.title ?? input.untitled })), input.hrefs.scheduled, input.when, now))
  }
  if (list && input.rules.has('missingLanguage')) {
    out.push(
      missingLanguageRule(
        list.posts.map((p) => ({ status: p.status, completeLanguages: p.completeLanguages, title: p.title ?? input.untitled })),
        list.languages,
        input.hrefs.missingLanguage,
      ),
    )
  }
  return out.filter((i): i is AttentionItem => !!i)
}

export async function getBlogDashboard(
  ctx: TenantAuthorizationContext,
  projectId: string,
  opts: { locale: string; readList: boolean; readDrafts: boolean; glance: boolean; attention: BlogAttentionInput | null },
): Promise<BlogDashboard> {
  const [list, drafts] = await Promise.all([
    opts.readList ? settle('blog.list', () => getDashboardPostList(ctx, projectId, { locale: opts.locale })) : null,
    opts.readDrafts ? settle('blog.drafts', () => listPostDrafts(ctx, projectId)) : null,
  ])
  return {
    list,
    drafts,
    glance: opts.glance && list ? blogGlance(list.posts, drafts) : null,
    attention: opts.attention ? blogAttention(list, drafts, opts.attention) : [],
  }
}
