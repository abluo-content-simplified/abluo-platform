/**
 * Client dashboard — a post's Activity (ADR-032 D9).
 *
 * Same enforcement as the other post functions: `blog.post.read` before any
 * I/O; the post (published or draft) must be this project's — anything else
 * is "not_found", so ids can't be probed. Dates are shown in the site's time
 * zone (D8): the caller gets it with the list.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { BLOG_POST_READ_PERMISSION } from '@/lib/api/client-dashboard'
import { isPostId, PostDraftError } from '@/lib/api/post-drafts'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { readContentActivity, type ActivityItem } from '@/lib/lifecycle/activity'
import { instant } from '@/lib/lifecycle/visibility'
import { resolveTimeZone } from '@/lib/time/zones'

/** The publication window as dates (D9: "Went offline · 1 Nov 2026, 11:00"). */
export type PublicationWindow =
  | { kind: 'goesLive'; at: string }
  | { kind: 'goesOffline'; at: string }
  | { kind: 'wentOffline'; at: string }
  | null

export type PostActivity = { items: ActivityItem[]; timeZone: string | null; window: PublicationWindow }

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch'>
type Doc = { _type?: string; projectSlug?: string; publishedAt?: unknown; expiresAt?: unknown } | undefined

/** Pure: the boundary worth showing above the list, from the published dates. */
export function publicationWindow(published: Doc, now: Date): PublicationWindow {
  if (!published) return null
  const t = now.getTime()
  const p = instant(published.publishedAt)
  const e = instant(published.expiresAt)
  if (e !== null && e <= t) return { kind: 'wentOffline', at: published.expiresAt as string }
  if (p !== null && p > t) return { kind: 'goesLive', at: published.publishedAt as string }
  if (e !== null) return { kind: 'goesOffline', at: published.expiresAt as string }
  return null
}

export async function getPostActivity(
  ctx: TenantAuthorizationContext,
  projectId: string,
  id: string,
  deps: { client?: Client; read?: typeof readContentActivity; now?: () => Date } = {}
): Promise<PostActivity> {
  assertModuleAction(ctx, projectId, BLOG_POST_READ_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  if (!isPostId(id)) throw new PostDraftError('not_found', 'Unknown post.')
  const client = deps.client ?? sanityWriteClient
  const [published, draft] = (await Promise.all([client.getDocument(id), client.getDocument(`drafts.${id}`)])) as [Doc, Doc]
  const ours = (d: Doc) => Boolean(d && d._type === 'post' && d.projectSlug === grant.projectSlug)
  if ((published && !ours(published)) || (draft && !ours(draft)) || (!published && !draft)) {
    throw new PostDraftError('not_found', 'Unknown post.')
  }
  const [items, zone] = await Promise.all([
    (deps.read ?? readContentActivity)({ projectId, contentType: 'post', contentIds: [id] }),
    client.fetch<string | null>(
      `*[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].timeZone`,
      { projectSlug: grant.projectSlug }
    ),
  ])
  return { items, timeZone: resolveTimeZone(zone) ?? null, window: publicationWindow(published, (deps.now ?? (() => new Date()))()) }
}
