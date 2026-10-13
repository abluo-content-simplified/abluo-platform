'use client'

/**
 * PublishingStatusInput — the read-only status line at the top of the
 * Publishing tab (ADR-032 A22). Shows what the WEBSITE shows (the published
 * version), in the site's time zone, using the same status rule as the
 * dashboard. Never writes a value.
 */
import { useEffect, useState } from 'react'
import { Card, Stack, Text } from '@sanity/ui'
import { useClient, useFormValue, type StringInputProps } from 'sanity'
import type { LifecycleFields, PublishedAtRule } from '@/lib/lifecycle/visibility'
import { validZone } from '@/components/app/lifecycle/zoned-time'
import { publishingSummary } from './publishing-summary'

type Loaded = { published: LifecycleFields | null; zone: string | null }

export function PublishingStatusInput(props: StringInputProps) {
  const client = useClient({ apiVersion: '2026-05-21' })
  const rule = ((props.schemaType.options as { lifecycleRule?: PublishedAtRule } | undefined)?.lifecycleRule) ?? 'required'
  const rawId = useFormValue(['_id']) as string | undefined
  const projectSlug = useFormValue(['projectSlug']) as string | undefined
  const rev = useFormValue(['_rev']) as string | undefined
  const formPublishedAt = useFormValue(['publishedAt']) as string | undefined
  const formExpiresAt = useFormValue(['expiresAt']) as string | undefined
  const id = rawId?.replace(/^drafts\./, '')

  const [loaded, setLoaded] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!id) return
    let live = true
    client
      .fetch<Loaded>(
        `{
          "published": *[_id == $id][0]{ publishedAt, expiresAt, archivedAt },
          "zone": *[_type == "siteConfig" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0].timeZone
        }`,
        { id, projectSlug: projectSlug ?? '' }
      )
      .then((r) => live && setLoaded(r))
      .catch(() => live && setLoaded({ published: null, zone: null }))
    return () => {
      live = false
    }
  }, [client, id, projectSlug, rev])

  if (!loaded) return <Text size={1} muted>Loading status…</Text>

  const zone = validZone(loaded.zone) ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  const summary = publishingSummary(loaded.published, rule, zone, new Date())
  const pending =
    loaded.published != null &&
    ((formPublishedAt ?? null) !== (loaded.published.publishedAt ?? null) ||
      (formExpiresAt ?? null) !== (loaded.published.expiresAt ?? null))

  return (
    <Card padding={3} radius={2} tone={summary.tone} border>
      <Stack space={3}>
        <Text size={2} weight="semibold">{summary.label}</Text>
        <Text size={1}>{summary.detail}</Text>
        {pending && <Text size={1} muted>You changed the dates below. They take effect when you click Publish.</Text>}
      </Stack>
    </Card>
  )
}
