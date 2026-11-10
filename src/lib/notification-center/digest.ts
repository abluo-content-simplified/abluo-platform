// Server-only.
/**
 * The gentle email digest (ADR-050 D11): one email per person when message
 * notifications have waited 30 minutes and the person has not been in a
 * dashboard since — at most one every 4 hours, production only. The email
 * holds a count and a link, nothing else.
 */
import { after } from 'next/server'
import { runAsTrustedSystemOperation } from '@/lib/supabase/admin'
import { getAppEnvironment, isProductionEnvironment } from '@/lib/notifications/environment'
import { sendEmail } from '@/lib/notifications/resend'
import { ADMIN_ORIGIN, CLIENT_ORIGIN, digestLocale, renderDigest } from './email'
import { DIGEST_KINDS, NOTIFICATION_LIMITS, planDigest, type DigestCandidate } from './model'

export async function sweepNotificationDigest(now = Date.now()): Promise<{ sent: number; skipped?: string }> {
  if (!isProductionEnvironment(getAppEnvironment())) return { sent: 0, skipped: 'not production' }
  return runAsTrustedSystemOperation('notification digest (ADR-050 D11): find people with unread messages who have not been in, email them a count', async (db) => {
    const quiet = new Date(now - NOTIFICATION_LIMITS.digestAfterMinutes * 60_000).toISOString()
    const { data, error } = await db
      .from('notifications')
      .select('id, user_id, side, created_at, project_id')
      .is('read_at', null)
      .is('emailed_at', null)
      .in('kind', [...DIGEST_KINDS])
      .lte('created_at', quiet)
      .limit(2000)
    if (error || !data?.length) return { sent: 0 }
    const rows: DigestCandidate[] = (data as { id: string; user_id: string; side: 'client' | 'abluo'; created_at: string; project_id: string | null }[]).map((r) => ({
      id: r.id, userId: r.user_id, side: r.side, createdAt: r.created_at, projectId: r.project_id,
    }))
    const userIds = [...new Set(rows.map((r) => r.userId))]
    const since = new Date(now - NOTIFICATION_LIMITS.digestEveryHours * 3_600_000).toISOString()
    const [profiles, digests] = await Promise.all([
      db.from('profiles').select('id, last_seen_at, interface_locale').in('id', userIds),
      db.from('notification_emails').select('user_id, sent_at').in('user_id', userIds).gte('sent_at', since),
    ])
    const prof = new Map(((profiles.data ?? []) as { id: string; last_seen_at: string | null; interface_locale: string | null }[]).map((p) => [p.id, p]))
    const lastSeen = new Map(userIds.map((u) => [u, prof.get(u)?.last_seen_at ?? null]))
    const lastDigest = new Map<string, string>()
    for (const d of (digests.data ?? []) as { user_id: string; sent_at: string }[]) {
      const prev = lastDigest.get(d.user_id)
      if (!prev || d.sent_at > prev) lastDigest.set(d.user_id, d.sent_at)
    }
    const plan = planDigest(rows, lastSeen, lastDigest, now)
    const projectIds = [...new Set([...plan.values()].flat().map((r) => r.projectId).filter((p): p is string => Boolean(p)))]
    const projects = new Map<string, { slug: string; default_locale: string | null }>()
    if (projectIds.length) {
      const { data: ps } = await db.from('projects').select('id, slug, default_locale').in('id', projectIds)
      for (const p of (ps ?? []) as { id: string; slug: string; default_locale: string | null }[]) projects.set(p.id, p)
    }
    let sent = 0
    for (const [userId, items] of plan) {
      const { data: u } = await db.auth.admin.getUserById(userId)
      const email = u?.user?.email
      if (!email) continue
      const abluo = items.some((i) => i.side === 'abluo')
      const sites = [...new Set(items.map((i) => i.projectId).filter((p): p is string => Boolean(p)))]
      const firstProject = sites[0] ? projects.get(sites[0]) : undefined
      const url = abluo ? `${ADMIN_ORIGIN}/messages` : sites.length === 1 && firstProject ? `${CLIENT_ORIGIN}/${encodeURIComponent(firstProject.slug)}/messages` : CLIENT_ORIGIN
      const mail = renderDigest({ locale: digestLocale(prof.get(userId)?.interface_locale, firstProject?.default_locale), count: items.length, url })
      const res = await sendEmail({ to: [email], subject: mail.subject, html: mail.html, text: mail.text })
      if (!res.ok) {
        console.error('[notifications] digest failed', res.error)
        continue
      }
      sent++
      await db.from('notifications').update({ emailed_at: new Date(now).toISOString() }).in('id', items.map((i) => i.id))
      await db.from('notification_emails').insert({ user_id: userId, items: items.length, environment: getAppEnvironment() })
    }
    return { sent }
  })
}

let lastRun = 0
/**
 * Opportunistic trigger (Vercel Hobby crons run once a day): dashboard
 * requests call this; it runs the digest at most every 5 minutes per server
 * instance, after the response. Never throws.
 */
export function maybeSweepDigest(): void {
  const now = Date.now()
  if (now - lastRun < 5 * 60_000 || !isProductionEnvironment(getAppEnvironment())) return
  lastRun = now
  try {
    after(async () => {
      try {
        await sweepNotificationDigest(now)
      } catch (e) {
        console.error('[notifications] digest sweep failed', e instanceof Error ? e.message : e)
      }
    })
  } catch {
    // No request scope (tests, scripts): the daily cron covers it.
  }
}
