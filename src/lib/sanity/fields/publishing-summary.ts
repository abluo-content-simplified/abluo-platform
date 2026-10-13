/**
 * The read-only status line at the top of a document's Publishing tab in
 * Studio (ADR-032 A22). Pure: the Studio input fetches the published document
 * and the site's time zone and hands them here, so Studio and the dashboard
 * always say the same thing (both go through `deriveStatus`).
 *
 * It describes the PUBLISHED version — what the website shows — not the form,
 * which may hold unpublished edits.
 */
import { deriveStatus, type LifecycleStatus } from '@/lib/lifecycle/status'
import type { LifecycleFields, PublishedAtRule } from '@/lib/lifecycle/visibility'

export type PublishingSummary = {
  status: LifecycleStatus
  /** e.g. "Scheduled" */
  label: string
  /** e.g. "Goes live on 1 Jan 2027, 10:00 (Rome time, GMT+1)." */
  detail: string
  tone: 'positive' | 'caution' | 'default' | 'critical'
}

const LABEL: Record<LifecycleStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  published: 'Published',
  unpublished: 'Unpublished',
  archived: 'Archived',
}

const TONE: Record<LifecycleStatus, PublishingSummary['tone']> = {
  draft: 'default',
  scheduled: 'caution',
  published: 'positive',
  unpublished: 'default',
  archived: 'critical',
}

/** "Rome time" from "Europe/Rome"; the zone id itself for anything unusual. */
export function zoneName(zone: string): string {
  const city = zone.split('/').pop()
  return city ? `${city.replace(/_/g, ' ')} time` : zone
}

function when(iso: string, zone: string): string {
  const d = new Date(iso)
  const date = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(d)
  const offset =
    new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(d)
      .find((p) => p.type === 'timeZoneName')?.value ?? ''
  return `${date} (${zoneName(zone)}${offset ? `, ${offset}` : ''})`
}

export function publishingSummary(
  published: LifecycleFields | null | undefined,
  rule: PublishedAtRule,
  zone: string,
  now: Date
): PublishingSummary {
  const s = deriveStatus({ published, rule }, now)
  const base = { status: s.status, label: LABEL[s.status], tone: TONE[s.status] }

  switch (s.status) {
    case 'draft':
      return { ...base, detail: 'Not on the website yet. Set Publish on and click Publish.' }
    case 'scheduled':
      return {
        ...base,
        detail:
          `Goes live on ${when(s.publishOn as string, zone)}.` +
          (s.unpublishOn ? ` Comes off the website on ${when(s.unpublishOn, zone)}.` : ''),
      }
    case 'published':
      return {
        ...base,
        detail: s.unpublishOn
          ? `On the website until ${when(s.unpublishOn, zone)}.`
          : 'On the website, with no end date.',
      }
    case 'unpublished': {
      const expiresAt = published?.expiresAt
      const publishedAt = published?.publishedAt
      if (expiresAt && publishedAt && new Date(expiresAt) <= new Date(publishedAt)) {
        return { ...base, detail: 'Unpublish on is not after Publish on, so it can never go live. Fix the dates and publish again.' }
      }
      if (expiresAt && new Date(expiresAt).getTime() <= now.getTime()) {
        return { ...base, detail: `Off the website since ${when(expiresAt, zone)}.` }
      }
      return { ...base, detail: 'Not on the website: it has no Publish on date.' }
    }
    case 'archived':
      return {
        ...base,
        detail:
          (published?.archivedAt ? `Archived on ${when(published.archivedAt, zone)}. ` : '') +
          'Never shown on the website. Restore it from the dashboard.',
      }
  }
}

/** Validation for Unpublish on: it must come after Publish on. */
export function unpublishAfterPublish(value: unknown, publishedAt: unknown): true | string {
  if (typeof value !== 'string' || typeof publishedAt !== 'string') return true
  if (new Date(value) > new Date(publishedAt)) return true
  const shown = new Date(publishedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  return `Must be after Publish on (${shown}). Change one of the two dates, otherwise this cannot be published.`
}
