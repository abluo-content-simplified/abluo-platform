'use client'

import { useEffect, useMemo, useState } from 'react'
import { useClient, useCurrentUser } from 'sanity'
import { useRouter } from 'sanity/router'
import { MODULE_REGISTRY } from '@/lib/modules'
import { TAXONOMY_TERM_TYPE } from '@/lib/taxonomy/ids'
import { buildNewTerm, kindLabel, taxonomyModules, termListFilter } from '@/lib/taxonomy/studio'

/**
 * "New category or tag" — creates a taxonomyTerm with its deterministic _id
 * (term.<project>.<module>.<kind>.<key>). The id depends on the key, which
 * Sanity's own "+" cannot know up front, so creation is this tiny form: the
 * default-language label in, the key derived from it (same slugifier as the
 * dashboard), the record written with createIfNotExists, then opened for
 * editing (translations, colour, order …).
 */
export function NewTermPane({ options }: { options?: Record<string, unknown> }) {
  const projectSlug = String(options?.projectSlug ?? '')
  const client = useClient({ apiVersion: '2026-05-21' })
  const user = useCurrentUser()
  const router = useRouter()
  const choices = useMemo(
    () => taxonomyModules(MODULE_REGISTRY).flatMap((m) => (m.taxonomies ?? []).map((t) => ({ module: m.id, moduleLabel: m.label, kind: t.kind }))),
    []
  )
  const [choice, setChoice] = useState(0)
  const [label, setLabel] = useState('')
  const [defaultLocale, setDefaultLocale] = useState('en')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    client
      .fetch<string | null>(`*[_type == "siteConfig" && projectSlug == $projectSlug][0].defaultLocale`, { projectSlug })
      .then((l) => l && setDefaultLocale(l))
      .catch(() => undefined)
  }, [client, projectSlug])

  const selected = choices[choice]

  async function create() {
    if (!selected) return
    setBusy(true)
    setMessage(null)
    try {
      const { filter, params } = termListFilter(projectSlug, selected.module, selected.kind)
      const existing = await client.fetch<{ key: string; order?: number }[]>(`*[${filter}]{ key, order }`, params)
      const built = buildNewTerm({
        projectSlug,
        module: selected.module,
        kind: selected.kind,
        label,
        defaultLocale,
        existingKeys: existing.map((t) => t.key),
        existingOrders: existing.map((t) => t.order).filter((n): n is number => typeof n === 'number'),
        now: new Date().toISOString(),
        userId: user?.email ?? user?.id,
      })
      if (!built.ok) {
        setMessage(built.message)
        return
      }
      await client.createIfNotExists(built.doc as { _id: string; _type: string })
      setLabel('')
      router.navigateIntent('edit', { id: built.doc._id as string, type: TAXONOMY_TERM_TYPE })
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Could not create the term.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 480, fontSize: 14 }}>
      <h2 style={{ fontSize: 18, margin: '0 0 16px' }}>New category or tag</h2>
      <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 6 }}>Module and kind</label>
      <select value={choice} onChange={(e) => setChoice(Number(e.target.value))} style={{ width: '100%', padding: 8, marginBottom: 16 }}>
        {choices.map((c, i) => (
          <option key={`${c.module}-${c.kind}`} value={i}>
            {c.moduleLabel} · {kindLabel(c.kind)}
          </option>
        ))}
      </select>
      <label style={{ display: 'block', fontSize: 12, color: '#666', marginBottom: 6 }}>Label ({defaultLocale}, the default language)</label>
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !busy && label.trim() && create()}
        style={{ width: '100%', padding: 8, marginBottom: 16, boxSizing: 'border-box' }}
      />
      <button type="button" onClick={create} disabled={busy || !label.trim()} style={{ padding: '8px 16px', cursor: 'pointer' }}>
        {busy ? 'Creating…' : 'Create'}
      </button>
      {message && <p role="alert" style={{ color: '#c62828', marginTop: 12 }}>{message}</p>}
      <p style={{ color: '#888', fontSize: 12, marginTop: 16 }}>
        The key is derived from the label and never changes. After creating, add translations and reorder in the editor.
      </p>
    </div>
  )
}
