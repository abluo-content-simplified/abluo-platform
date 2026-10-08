/**
 * "Get your site ready" — the setup checklist on the dashboard Home.
 *
 * Pure: Home reads the facts through the existing dashboard providers (the
 * same enforced reads the other Home blocks use) and passes them in; this
 * module decides which items the person sees, which are done, and whether the
 * card shows at all. It never fetches.
 *
 * Rules (Tom, 2026-10-08):
 *   - An item is shown only to someone who can act on it — gated through the
 *     same check as the tenant-surface registry (`surfaceAllowed`).
 *   - "Done" is detected from real data. A fact that could not be read (null)
 *     leaves its item out rather than showing a false "not done".
 *   - The card disappears when every shown item is done, or when the person
 *     hid it for this project (stored server-side, migration 039).
 *
 * Copy: `clientDashboard.home.setup.items.<id>.{title,detail,doneDetail}`.
 */
import { surfaceAllowed, type SurfaceGrant, type SurfaceRequirement } from '@/lib/client/surfaces'

export type SetupItemId = 'firstPost' | 'photos' | 'team' | 'analytics' | 'domain'

/** Order on screen. */
export const SETUP_ITEM_ORDER: readonly SetupItemId[] = ['firstPost', 'photos', 'team', 'analytics', 'domain']

/** Who sees each item (the people who can act on it). Same vocabulary as the surface registry. */
export const SETUP_ITEM_RULES: Readonly<Record<SetupItemId, SurfaceRequirement>> = {
  // Writing needs the blog installed and the write permission.
  firstPost: { module: 'blog', permission: 'blog.post.write' },
  photos: { permission: 'media.library.manage' },
  // Owner / Site admin: the people who can invite.
  team: { anyPermission: ['users.invite', 'users.manage'] },
  // Abluo connects Google; the person who reads analytics is the one who asks.
  analytics: { permission: 'analytics.read' },
  // Abluo connects the domain; shown to the site's Owner / Site admin.
  domain: { anyPermission: ['users.invite', 'users.manage'] },
}

/**
 * Items that need a page to do them: without a link (the page is not in this
 * person's navigation) the item is left out. Analytics and domain are done by
 * Abluo, so they may show without a link.
 */
const NEEDS_LINK: ReadonlySet<SetupItemId> = new Set(['firstPost', 'photos', 'team'])

/** A team counts as invited once the site has this many people (active + pending invitations). */
export const TEAM_DONE_AT = 2

/** What Home read. `null` = not read / unknown → the item is left out. */
export type SetupFacts = {
  publishedPosts: number | null
  mediaAssets: number | null
  /** People with access plus pending invitations (expired and archived not counted). */
  teamSize: number | null
  /** An analytics snapshot with data exists. */
  analyticsConnected: boolean | null
  /** The site is live on its own domain. */
  domainConnected: boolean | null
}

export type SetupItem = { id: SetupItemId; done: boolean; href: string | null }

export type SetupChecklist = {
  items: SetupItem[]
  doneCount: number
  total: number
  /** Show the card: something to show, not all done, not hidden by the person. */
  visible: boolean
}

function doneFor(id: SetupItemId, f: SetupFacts): boolean | null {
  switch (id) {
    case 'firstPost':
      return f.publishedPosts === null ? null : f.publishedPosts >= 1
    case 'photos':
      return f.mediaAssets === null ? null : f.mediaAssets >= 1
    case 'team':
      return f.teamSize === null ? null : f.teamSize >= TEAM_DONE_AT
    case 'analytics':
      return f.analyticsConnected
    case 'domain':
      return f.domainConnected
  }
}

export function buildSetupChecklist(input: {
  grant: SurfaceGrant
  facts: SetupFacts
  hrefs: Partial<Record<SetupItemId, string | null>>
  dismissed: boolean
}): SetupChecklist {
  const items: SetupItem[] = []
  for (const id of SETUP_ITEM_ORDER) {
    if (!surfaceAllowed(input.grant, SETUP_ITEM_RULES[id])) continue
    const href = input.hrefs[id] ?? null
    if (NEEDS_LINK.has(id) && !href) continue
    const done = doneFor(id, input.facts)
    if (done === null || done === undefined) continue
    items.push({ id, done, href })
  }
  const doneCount = items.filter((i) => i.done).length
  return {
    items,
    doneCount,
    total: items.length,
    visible: !input.dismissed && items.length > 0 && doneCount < items.length,
  }
}

/** Which facts Home needs to read for this grant (skips reads for items the person won't see). */
export function setupFactsWanted(grant: SurfaceGrant): Set<SetupItemId> {
  return new Set(SETUP_ITEM_ORDER.filter((id) => surfaceAllowed(grant, SETUP_ITEM_RULES[id])))
}

/** People + pending invitations — what counts for "Invite your team". */
export function teamSizeOf(people: readonly { status: string }[]): number {
  return people.filter((p) => p.status === 'active' || p.status === 'invited').length
}
