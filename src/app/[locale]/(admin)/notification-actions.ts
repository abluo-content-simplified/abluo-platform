'use server'

/**
 * The admin dashboard's Notification Center (ADR-050 D9): the signed-in Abluo
 * admin's own rows (side "abluo"). Each call checks `requireAbluoAdmin()`
 * first. Never throws to the browser.
 */
import { requireAbluoAdmin } from '@/lib/api/auth'
import { countUnreadNotifications, listNotifications, markNotificationsRead } from '@/lib/notification-center/service'
import type { NotificationItem } from '@/lib/notification-center/model'

export async function adminNotificationCountAction(): Promise<number> {
  try {
    const actor = await requireAbluoAdmin()
    return actor ? await countUnreadNotifications(actor.userId, 'abluo') : 0
  } catch {
    return 0
  }
}

export async function adminNotificationListAction(): Promise<NotificationItem[] | null> {
  try {
    const actor = await requireAbluoAdmin()
    return actor ? await listNotifications(actor.userId, 'abluo') : null
  } catch {
    return null
  }
}

export async function adminNotificationMarkReadAction(id?: string): Promise<void> {
  try {
    const actor = await requireAbluoAdmin()
    if (actor) await markNotificationsRead(actor.userId, 'abluo', typeof id === 'string' ? id : undefined)
  } catch {
    /* nicety */
  }
}
