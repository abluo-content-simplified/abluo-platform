/**
 * Dashboard provider — People. Reads through the existing `listProjectPeople`
 * (which returns null unless the viewer holds users.invite / users.manage on
 * this project). Home calls it only for the invitation attention rule.
 */
import { listProjectPeople } from '@/lib/people/service'
import type { TenantAuthorizationContext } from '@/lib/api/tenant-context'
import { settle } from '@/lib/api/dashboard/settle'
import { invitationRules, type AttentionItem } from '@/lib/client/attention'

export async function getPeopleAttention(ctx: TenantAuthorizationContext, projectId: string, href: string): Promise<AttentionItem[]> {
  const view = await settle('people.list', () => listProjectPeople(ctx, projectId))
  return view ? invitationRules(view.people, href) : []
}
