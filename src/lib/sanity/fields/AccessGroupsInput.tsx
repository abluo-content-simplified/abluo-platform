'use client'
// ── Access — Studio pieces for a protected page (ADR-040 §15, R9) ─────────────
//
// AccessGroupsInput  page.access.groups as a checklist of the project's group
//                    NAMES (from Supabase via /api/sanity/access-groups, admin
//                    only) instead of raw ids. Stored values are unchanged:
//                    group ids, as the website reads them.
// pageAccessDocumentsWarning
//                    a validation WARNING (never an error) shown before
//                    publishing a change that would hide documents the site
//                    placed on this page: made public, or other groups.
//
// Studio is English-only admin UI (CLAUDE.md: admin interfaces may hardcode).

import { useEffect, useState } from 'react'
import { set, unset, useFormValue, type ArrayOfPrimitivesInputProps } from 'sanity'
import { Card, Checkbox, Flex, Stack, Text } from '@sanity/ui'
import { documentFitsPage } from '@/lib/access/download-pages'

type Group = { id: string; name: Record<string, string> }

function groupLabel(g: Group): string {
  return g.name.en ?? g.name.it ?? Object.values(g.name)[0] ?? g.id
}

export function AccessGroupsInput(props: ArrayOfPrimitivesInputProps) {
  const { value, onChange, readOnly } = props
  const projectSlug = useFormValue(['projectSlug']) as string | undefined
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectSlug) return
    let alive = true
    fetch(`/api/sanity/access-groups?projectSlug=${encodeURIComponent(projectSlug)}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? (r.json() as Promise<Group[]>) : Promise.reject(new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`))))
      .then((g) => { if (alive) setGroups(g) })
      .catch((e: Error) => { if (alive) setError(e.message) })
    return () => { alive = false }
  }, [projectSlug])

  const selected = new Set(((value as string[] | undefined) ?? []).map((v) => v.toLowerCase()))
  const toggle = (id: string, on: boolean) => {
    const next = new Set(selected)
    if (on) next.add(id.toLowerCase())
    else next.delete(id.toLowerCase())
    const list = [...next].sort()
    onChange(list.length ? set(list) : unset())
  }

  if (error) return <Card padding={3} tone="critical" radius={2}><Text size={1}>Could not load the access groups: {error}. Groups are created in the dashboard, under Access.</Text></Card>
  if (!groups) return <Text size={1} muted>Loading groups…</Text>
  if (groups.length === 0) return <Card padding={3} tone="caution" radius={2}><Text size={1}>This site has no access groups yet. Create one in the dashboard, under Access, then choose it here.</Text></Card>

  const unknown = [...selected].filter((id) => !groups.some((g) => g.id.toLowerCase() === id))
  return (
    <Stack space={3}>
      {groups.map((g) => (
        <Flex key={g.id} align="center" gap={2} as="label">
          <Checkbox checked={selected.has(g.id.toLowerCase())} disabled={readOnly} onChange={(e) => toggle(g.id, e.currentTarget.checked)} />
          <Text size={1}>{groupLabel(g)}</Text>
        </Flex>
      ))}
      {unknown.length > 0 && (
        <Card padding={3} tone="caution" radius={2}>
          <Flex align="center" justify="space-between" gap={3}>
            <Text size={1}>{unknown.length === 1 ? 'One chosen group no longer exists (archived or removed); it opens nothing.' : `${unknown.length} chosen groups no longer exist; they open nothing.`}</Text>
            {!readOnly && <Text size={1}><a href="#" onClick={(e) => { e.preventDefault(); const list = [...selected].filter((id) => !unknown.includes(id)).sort(); onChange(list.length ? set(list) : unset()) }}>Remove</a></Text>}
          </Flex>
        </Card>
      )}
    </Stack>
  )
}

type PlacedDoc = { id: string; title: Record<string, string>; visibility: 'everyone' | 'groups'; groupIds: string[] }

/** Async Sanity validation (used with `.warning()`): never blocks publishing. */
export async function pageAccessDocumentsWarning(value: unknown, context: { document?: unknown }): Promise<true | string> {
  if (typeof window === 'undefined') return true
  const doc = context.document as { _id?: string; projectSlug?: string; sections?: Array<{ _type?: string }> } | undefined
  if (!doc?._id || !doc.projectSlug) return true
  if (!(doc.sections ?? []).some((s) => s?._type === 'downloadSection')) return true
  const access = (value ?? {}) as { visibility?: string; groups?: unknown }
  const restricted = access.visibility === 'restricted'
  const groupIds = restricted && Array.isArray(access.groups) ? access.groups.filter((g): g is string => typeof g === 'string') : []
  let placed: PlacedDoc[] = []
  try {
    const r = await fetch(`/api/sanity/page-documents?projectSlug=${encodeURIComponent(doc.projectSlug)}&pageId=${encodeURIComponent(doc._id)}`, { cache: 'no-store' })
    if (!r.ok) return true
    placed = (await r.json()) as PlacedDoc[]
  } catch {
    return true
  }
  const hidden = placed.filter((d) => !documentFitsPage(d, { restricted, groupIds }))
  if (hidden.length === 0) return true
  const names = hidden.slice(0, 3).map((d) => `“${d.title.en ?? Object.values(d.title)[0] ?? 'Document'}”`).join(', ')
  const more = hidden.length > 3 ? ` and ${hidden.length - 3} more` : ''
  return `${hidden.length === 1 ? '1 document placed on this page' : `${hidden.length} documents placed on this page`} will stop showing with this setting: ${names}${more}. They are members-only documents for other groups${restricted ? '' : ' (a public page shows public documents only)'}.`
}
