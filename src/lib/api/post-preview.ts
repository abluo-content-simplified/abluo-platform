/**
 * Mints the private draft-preview link (ADR-025 · preview) for the client
 * dashboard. The page it opens is the WEBSITE's own post page, rendered from
 * the draft (`(website)/[tenant]/preview/post/[id]`), so the client sees the
 * post in their real design before publishing.
 *
 * Gate, in order (mirrors post-drafts.ts):
 *   1. `assertModuleAction(ctx, projectId, 'blog.post.write')` — a viewer
 *      can't preview drafts (they can't open them either).
 *   2. The draft is re-read: a `post` draft of the GRANT's project, else
 *      "not_found" (another project's draft and a missing one look the same).
 *   3. A token binding draft + project + user, valid 15 minutes.
 */
import { assertModuleAction } from '@/lib/api/module-action-guard'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { sanityWriteClient } from '@/lib/sanity/server-clients'
import { BLOG_POST_WRITE_PERMISSION } from '@/lib/api/post-drafts'
import { signDraftPreviewToken, previewSecret } from '@/lib/preview/draft-preview-token'
import { hostsForProjectId, lookupHostRoute, resolveScopeFromHost } from '@/lib/tenancy/host-scope'

export type PostPreviewErrorCode = 'forbidden' | 'not_found' | 'unavailable' | 'failed'

export class PostPreviewError extends Error {
  constructor(
    readonly code: PostPreviewErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'PostPreviewError'
  }
}

export type PreviewTheme = 'light' | 'dark'

export type DraftPreviewLink = {
  token: string
  /** Seconds since the epoch. */
  exp: number
  /** '' = same origin as the dashboard; otherwise e.g. `https://ch-psicoterapeuta.com`. */
  origin: string
  projectSlug: string
  /** Themes the site actually has (one entry = no Light/Dark switch). */
  themes: PreviewTheme[]
}

type Client = Pick<typeof sanityWriteClient, 'getDocument' | 'fetch'>
export type PostPreviewDeps = { client?: Client; secret?: Buffer | null; now?: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Which themes a site renders: siteConfig.themeMode + whether its design system has light colours. */
export function previewThemes(themeMode: string | null | undefined, hasLight: boolean): PreviewTheme[] {
  if (themeMode === 'lightOnly') return ['light']
  if (themeMode === 'darkOnly') return ['dark']
  return hasLight ? ['light', 'dark'] : ['dark']
}

/**
 * Where the preview page can be loaded from. Same origin ('') whenever the
 * dashboard's host serves any project by path (platform hosts, dev.abluo.app)
 * or is this project's own host. On ANOTHER project's host, `/{locale}/{this
 * project}/…` would be rewritten into that host's own site, so the link
 * points at one of this project's hosts that is serving (same kind first).
 */
export function previewOrigin(
  requestHost: string | null | undefined,
  project: { projectId: string; projectSlug: string },
  proto: 'https' | 'http' = 'https'
): string {
  const here = lookupHostRoute(requestHost)
  if (!here || here.hostKind === 'platform-alias' || here.projectSlug === project.projectSlug) return ''
  const port = (requestHost ?? '').match(/:(\d+)$/)?.[1]
  const own = hostsForProjectId(project.projectId).filter((r) => r.projectSlug === project.projectSlug)
  const order = [here.hostKind, 'custom-domain', 'preview-subdomain', 'localhost-subdomain']
  for (const kind of order) {
    const hit = own.find((r) => r.hostKind === kind && resolveScopeFromHost(r.host))
    if (hit) {
      const local = hit.hostKind === 'localhost-subdomain'
      return `${local ? 'http' : proto}://${hit.host}${local && port ? `:${port}` : ''}`
    }
  }
  return ''
}

export async function mintDraftPreview(
  ctx: TenantAuthorizationContext,
  projectId: string,
  input: { id: string; host?: string | null; proto?: 'https' | 'http' },
  deps: PostPreviewDeps = {}
): Promise<DraftPreviewLink> {
  assertModuleAction(ctx, projectId, BLOG_POST_WRITE_PERMISSION)
  const grant = ctx.projects.find((p) => p.projectId === projectId)!
  const client = deps.client ?? sanityWriteClient

  if (typeof input?.id !== 'string' || !UUID.test(input.id)) throw new PostPreviewError('not_found', 'Unknown draft id.')
  const secret = deps.secret === undefined ? previewSecret() : deps.secret
  if (!secret) throw new PostPreviewError('unavailable', 'Preview is not configured.')

  const draft = (await client.getDocument(`drafts.${input.id}`)) as { _type?: string; projectSlug?: string } | undefined
  if (!draft || draft._type !== 'post' || draft.projectSlug !== grant.projectSlug) {
    throw new PostPreviewError('not_found', 'Unknown draft id.')
  }

  let site: { themeMode?: string | null; hasLight?: boolean | null } | null = null
  try {
    site = await client.fetch(
      `{
        "themeMode": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].themeMode,
        "hasLight": defined(coalesce(
          *[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].designSystemRef->,
          *[_type == "designSystem" && projectSlug == $projectSlug][0]
        ){ "l": coalesce(colors.lightTheme.background, parentDesignSystem->colors.lightTheme.background) }.l)
      }`,
      { projectSlug: grant.projectSlug }
    )
  } catch {
    site = null // themes default below; the preview itself still works
  }

  const { token, exp } = signDraftPreviewToken(
    { draftId: input.id, projectSlug: grant.projectSlug, userId: ctx.userId },
    { secret, now: deps.now }
  )
  return {
    token,
    exp,
    origin: previewOrigin(input.host, { projectId: grant.projectId, projectSlug: grant.projectSlug }, input.proto),
    projectSlug: grant.projectSlug,
    themes: previewThemes(site?.themeMode, site?.hasLight !== false),
  }
}
