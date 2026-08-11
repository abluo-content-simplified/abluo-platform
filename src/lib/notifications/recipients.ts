/**
 * Recipient resolution — ADR-019. Studio-managed, read at send time.
 *
 * Recipients live on the Sanity project document (`notifications.recipients`),
 * edited by an admin in Project Settings → Notifications. The consumer resolves
 * them by mapping the event's tenant/URL slug (e.g. 'livener') to the Sanity
 * projectSlug (e.g. 'livener-main') via TENANT_TO_PROJECT, then reading the
 * project's recipient groups and filtering by topic + enabled.
 *
 * Resolving at SEND time (not emit time) means recipient changes take effect
 * for events already sitting in the outbox.
 */
import { tryTenantToProjectSlug, sanityClient } from '@/lib/sanity/client'
import { projectNotificationsQuery } from '@/lib/sanity/queries'

export interface RecipientGroup {
  /** Topic this group applies to; 'all' matches every topic. */
  topic?: string
  emails?: string[]
  enabled?: boolean
}

/**
 * Pure filter — testable without Sanity. Returns a deduped, lowercased email
 * list for `topic` across all enabled groups (a group with topic 'all' or no
 * topic matches every topic).
 */
export function filterRecipientGroups(groups: RecipientGroup[] | null | undefined, topic: string): string[] {
  const out = new Set<string>()
  for (const g of groups ?? []) {
    if (!g || g.enabled === false) continue
    if (g.topic && g.topic !== 'all' && g.topic !== topic) continue
    for (const raw of g.emails ?? []) {
      const e = (raw ?? '').trim().toLowerCase()
      if (e) out.add(e)
    }
  }
  return [...out]
}

/** Resolves recipients for (tenant/URL projectSlug, topic) from Studio config. */
export async function resolveRecipients(projectSlug: string, topic: string): Promise<string[]> {
  const sanitySlug = tryTenantToProjectSlug(projectSlug)
  if (!sanitySlug) {
    console.warn(`[notifications] no Sanity project mapping for "${projectSlug}" — no recipients resolved`)
    return []
  }
  let groups: RecipientGroup[] | null = null
  try {
    groups = await sanityClient.fetch<RecipientGroup[] | null>(projectNotificationsQuery, { projectSlug: sanitySlug })
  } catch (error) {
    console.warn(`[notifications] failed to read recipients for "${sanitySlug}": ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
  return filterRecipientGroups(groups, topic)
}
