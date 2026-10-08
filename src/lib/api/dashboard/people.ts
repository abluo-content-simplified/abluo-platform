/**
 * Dashboard provider — People. Reads through the existing `listProjectPeople`
 * (which returns null unless the viewer holds users.invite / users.manage on
 * this project). Home calls it for the invitation attention rule and the
 * setup checklist's team size.
 */
import { listProjectPeople } from '@/lib/people/service'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { settle } from '@/lib/api/dashboard/settle'
import { invitationRules, type AttentionItem } from '@/lib/client/attention'
import { teamSizeOf } from '@/lib/client/setup-checklist'

export async function getPeopleAttention(ctx: TenantAuthorizationContext, projectId: string, href: string): Promise<AttentionItem[]> {
  return (await getPeopleDashboard(ctx, projectId, { attentionHref: href }))?.attention ?? []
}

/**
 * One read for Home: the invitation attention items (when `attentionHref` is
 * given) and the team size for the setup checklist. Null when the person may
 * not see people here or the read failed.
 */
export async function getPeopleDashboard(
  ctx: TenantAuthorizationContext,
  projectId: string,
  opts: { attentionHref: string | null },
): Promise<{ attention: AttentionItem[]; teamSize: number } | null> {
  const view = await settle('people.list', () => listProjectPeople(ctx, projectId))
  if (!view) return null
  return {
    attention: opts.attentionHref ? invitationRules(view.people, opts.attentionHref) : [],
    teamSize: teamSizeOf(view.people),
  }
}
