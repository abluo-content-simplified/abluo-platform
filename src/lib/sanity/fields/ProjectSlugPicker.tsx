'use client'

import { useEffect, useState, useCallback } from 'react'
import { StringInputProps, PatchEvent, set, unset, useClient } from 'sanity'

interface ProjectOption {
  projectSlug: string
  projectName: string
  clientName: string
  label: string // "Client / Project"
}

export function ProjectSlugPicker(props: StringInputProps) {
  const { value, onChange } = props
  const client = useClient({ apiVersion: '2026-05-21' })

  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [currentLabel, setCurrentLabel] = useState<string | null>(null)

  useEffect(() => {
    client
      .fetch<{ projectSlug: string; projectName: string; clientName: string }[]>(
        `*[_type == "project" && defined(projectSlug) && !(_id in path("drafts.**"))] | order(projectName asc) {
          projectSlug,
          projectName,
          "clientName": clientRef->displayName
        }`
      )
      .then((results) => {
        const opts: ProjectOption[] = results.map((r) => ({
          projectSlug: r.projectSlug,
          projectName: r.projectName ?? r.projectSlug,
          clientName: r.clientName ?? 'Unknown',
          label: `${r.clientName ?? 'Unknown'} / ${r.projectName ?? r.projectSlug}`,
        }))
        setProjects(opts)

        if (value) {
          const found = opts.find((p) => p.projectSlug === value)
          if (found) setCurrentLabel(found.label)
        }
      })
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSelect = useCallback(
    (slug: string) => {
      onChange(PatchEvent.from(set(slug)))
    },
    [onChange]
  )

  const handleChange = useCallback(() => {
    onChange(PatchEvent.from(unset()))
    setCurrentLabel(null)
    setSearch('')
  }, [onChange])

  // ── Locked state ──────────────────────────────────────────────────────────

  if (value) {
    const label = loading ? value : (currentLabel ?? value)

    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: '#f7f7f7',
        border: '1px solid #e5e5e5',
        borderRadius: 4,
      }}>
        <div>
          <div style={{
            fontSize: 11,
            color: '#999',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            marginBottom: 2,
          }}>
            Linked Project
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: '#111' }}>
            {label}
          </div>
        </div>
        <button
          type="button"
          onClick={handleChange}
          style={{
            fontSize: 12,
            color: '#888',
            border: 'none',
            background: 'none',
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: 3,
          }}
          onMouseEnter={(e) => { (e.target as HTMLElement).style.color = '#333' }}
          onMouseLeave={(e) => { (e.target as HTMLElement).style.color = '#888' }}
        >
          Change
        </button>
      </div>
    )
  }

  // ── Picker state ──────────────────────────────────────────────────────────

  if (loading) {
    return <div style={{ fontSize: 13, color: '#888', padding: '8px 0' }}>Loading projects…</div>
  }

  const filtered = projects.filter((p) =>
    p.label.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <input
        type="text"
        placeholder="Search project…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
        style={{
          width: '100%',
          padding: '10px 12px',
          fontSize: 13,
          border: '1px solid #ccc',
          borderRadius: 4,
          marginBottom: 6,
          boxSizing: 'border-box',
          outline: 'none',
        }}
      />

      {filtered.length === 0 ? (
        <div style={{ fontSize: 13, color: '#999', padding: '8px 12px' }}>
          No projects found
        </div>
      ) : (
        <div style={{
          border: '1px solid #e5e5e5',
          borderRadius: 4,
          overflow: 'hidden',
          maxHeight: 280,
          overflowY: 'auto',
        }}>
          {filtered.map((p, i) => (
            <button
              key={p.projectSlug}
              type="button"
              onClick={() => handleSelect(p.projectSlug)}
              style={{
                display: 'block',
                width: '100%',
                padding: '10px 14px',
                textAlign: 'left',
                fontSize: 13,
                color: '#111',
                border: 'none',
                borderBottom: i < filtered.length - 1 ? '1px solid #f0f0f0' : 'none',
                background: '#fff',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#f5f5f5' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#fff' }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
