/**
 * The Studio "Publishing" tab — one standard for every lifecycle document type
 * (ADR-032 A22). Everything about WHEN and HOW a document is visible lives in
 * one tab, under the same words the dashboard uses:
 *
 *   Status (read-only) · Publish on · Unpublish on · Featured · Archived (read-only)
 *
 * Field NAMES never change (publishedAt / expiresAt / archivedAt / featured):
 * only titles, descriptions and the tab they sit in. No data migration.
 *
 * Archiving is an action (dashboard), not a date anyone types: archivedAt is
 * read-only and only visible on an archived document.
 */
import { defineField } from 'sanity'
import type { PublishedAtRule } from '@/lib/lifecycle/visibility'
import { PublishingStatusInput } from './PublishingStatusInput'
import { unpublishAfterPublish } from './publishing-summary'

export const PUBLISHING_GROUP = { name: 'publishing', title: 'Publishing' } as const

/**
 * Read-only status line. Never stored: the input never writes a value.
 */
export function publishingStatusField(rule: PublishedAtRule) {
  return defineField({
    name: 'publishingStatus',
    title: 'Status',
    type: 'string',
    group: PUBLISHING_GROUP.name,
    readOnly: true,
    components: { input: PublishingStatusInput },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    options: { lifecycleRule: rule } as any,
  })
}

export function publishOnField(description: string) {
  return defineField({
    name: 'publishedAt',
    title: 'Publish on',
    type: 'datetime',
    group: PUBLISHING_GROUP.name,
    description,
  })
}

export function unpublishOnField(description: string) {
  return defineField({
    name: 'expiresAt',
    title: 'Unpublish on',
    type: 'datetime',
    group: PUBLISHING_GROUP.name,
    description,
    // ADR-025 D4/D5 — the dashboard's "Set unpublish date" writes this too.
    validation: (Rule) =>
      Rule.custom((value, context) =>
        unpublishAfterPublish(value, (context.document as { publishedAt?: unknown } | undefined)?.publishedAt)
      ),
  })
}

/** ADR-032 D6 — written only by the dashboard's Archive / Restore. */
export function archivedFields() {
  return [
    defineField({
      name: 'archivedAt',
      title: 'Archived',
      type: 'datetime',
      group: PUBLISHING_GROUP.name,
      readOnly: true,
      hidden: ({ value }) => !value,
      description: 'Archived from the dashboard. Archived content is never shown on the website; restore it from the dashboard.',
    }),
    defineField({ name: 'archivedBy', title: 'Archived by', type: 'string', group: PUBLISHING_GROUP.name, readOnly: true, hidden: true }),
  ]
}
