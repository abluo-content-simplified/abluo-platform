'use server'

/**
 * The client dashboard's Notification Center (ADR-050 D9): the signed-in
 * person's own rows (side "client"), re-resolved from the session on every
 * call. An Abluo admin's support visit gets nothing (they are not the client).
 * Never throws to the browser.
 */
import { getTenantAuthorizationContext } from '@/lib/api/tenant-context'
import { countUnreadNotifications, listNotifications, markNotificationsRead } from '@/lib/notification-center/service'
import type { NotificationItem } from '@/lib/notification-center/model'

async function me(projectSlug: unknown): Promise<string | null> {
  if (typeof projectSlug !== 'string' || !projectSlug) return null
  const ctx = await getTenantAuthorizationContext({ project: projectSlug })
  return ctx && !ctx.support ? ctx.userId : null
}

export async function clientNotificationCountAction(projectSlug: string): Promise<number> {
  try {
    const userId = await me(projectSlug)
    return userId ? await countUnreadNotifications(userId, 'client') : 0
  } catch {
    return 0
  }
}

export async function clientNotificationListAction(projectSlug: string): Promise<NotificationItem[] | null> {
  try {
    const userId = await me(projectSlug)
    return userId ? await listNotifications(userId, 'client') : null
  } catch {
    return null
  }
}

export async function clientNotificationMarkReadAction(projectSlug: string, id?: string): Promise<void> {
  try {
    const userId = await me(projectSlug)
    if (userId) await markNotificationsRead(userId, 'client', typeof id === 'string' ? id : undefined)
  } catch {
    /* nicety */
  }
}
