'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useClient } from 'sanity'

interface DSDoc {
  _id: string
  name: string
  role: 'active' | 'template'
  projectSlug?: string
}

interface DesignSystemAssignPaneProps {
  options?: {
    projectId?: string
    projectSlug?: string
    currentDSId?: string
  }
}

export function DesignSystemAssignPane({ options }: DesignSystemAssignPaneProps) {
  const { projectId, projectSlug, currentDSId } = options ?? {}
  const sanity = useClient({ apiVersion: '2026-05-21' })

  const [allDS, setAllDS] = useState<DSDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [assigned, setAssigned] = useState(false)
  const [assignedName, setAssignedName] = useState('')
  const [confirming, setConfirming] = useState<DSDoc | null>(null)

  useEffect(() => {
    sanity
      .fetch<DSDoc[]>(
        `*[_type == "designSystem" && !(_id in path("drafts.**"))] | order(name asc) {
          _id, name, role, projectSlug
        }`
      )
      .then((data) => setAllDS(data ?? []))
      .finally(() => setLoading(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return allDS.filter((ds) => !q || (ds.name ?? '').toLowerCase().includes(q))
  }, [allDS, search])

  const groups = useMemo(() => ({
    assignedHere: filtered.filter(
      (ds) => ds.role !== 'template' && ds.projectSlug === projectSlug
    ),
    templates: filtered.filter((ds) => ds.role === 'template'),
    unassigned: filtered.filter((ds) => ds.role !== 'template' && !ds.projectSlug),
    assignedElsewhere: filtered.filter(
      (ds) => ds.role !== 'template' && !!ds.projectSlug && ds.projectSlug !== projectSlug
    ),
  }), [filtered, projectSlug])

  const doAssign = useCallback(async (ds: DSDoc) => {
    if (!projectId) return

    // Clear projectSlug from old DS (best-effort)
    if (currentDSId && currentDSId !== ds._id) {
      sanity.patch(currentDSId).unset(['projectSlug']).commit({ visibility: 'async' }).catch(() => {})
    }

    // Set projectSlug on new DS (best-effort)
    if (projectSlug) {
      sanity.patch(ds._id).set({ projectSlug, role: 'active' }).commit({ visibility: 'async' }).catch(() => {})
    }

    // Patch the project's designSystemRef
    await sanity
      .patch(projectId)
      .set({ designSystemRef: { _type: 'reference', _ref: ds._id } })
      .commit()

    setAssignedName(ds.name ?? ds._id)
    setAssigned(true)
    setConfirming(null)
  }, [projectId, projectSlug, currentDSId, sanity])

  const handleSelect = useCallback((ds: DSDoc) => {
    if (ds.projectSlug && ds.projectSlug !== projectSlug) {
      setConfirming(ds)
    } else {
      doAssign(ds)
    }
  }, [doAssign, projectSlug])

  // ── Success state ──────────────────────────────────────────────────────────

  if (assigned) {
    return (
      <div style={{ padding: 32, maxWidth: 480 }}>
        <div style={{
          padding: 20,
          background: '#f0f7f0',
          border: '1px solid #a5d6a7',
          borderRadius: 6,
          marginBottom: 16,
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1b5e20', marginBottom: 4 }}>
            ✓ Design system assigned
          </div>
          <div style={{ fontSize: 13, color: '#388e3c' }}>
            {assignedName} has been assigned to this project.
          </div>
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '8px 20px',
            fontSize: 13,
            fontWeight: 500,
            background: '#1a1a1a',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          Reload to open editor
        </button>
      </div>
    )
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: 32, fontSize: 13, color: '#888' }}>Loading design systems…</div>
    )
  }

  // ── Picker ─────────────────────────────────────────────────────────────────

  function GroupSection({ title, items, badge }: { title: string; items: DSDoc[]; badge?: (ds: DSDoc) => string }) {
    if (items.length === 0) return null
    return (
      <div style={{ marginBottom: 24 }}>
        <div style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#999',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 8,
        }}>
          {title}
        </div>
        {items.map((ds) => {
          const isCurrent = ds._id === currentDSId
          return (
            <div
              key={ds._id}
              onClick={() => handleSelect(ds)}
              style={{
                padding: '12px 16px',
                border: '1px solid',
                borderColor: isCurrent ? '#a5d6a7' : '#e0e0e0',
                borderRadius: 4,
                marginBottom: 6,
                cursor: 'pointer',
                background: isCurrent ? '#f0f7f0' : '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>
                  {ds.name ?? ds._id}
                </div>
                {badge && (
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                    {badge(ds)}
                  </div>
                )}
              </div>
              {isCurrent && (
                <span style={{ fontSize: 11, color: '#2e7d32', fontWeight: 600 }}>Current</span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const hasAny =
    groups.assignedHere.length +
    groups.templates.length +
    groups.unassigned.length +
    groups.assignedElsewhere.length > 0

  return (
    <div style={{ padding: 32, maxWidth: 560 }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#111', marginBottom: 4 }}>
          {currentDSId ? 'Change Design System' : 'Assign Design System'}
        </div>
        <div style={{ fontSize: 13, color: '#888' }}>
          Select a design system to assign to this project.
        </div>
      </div>

      {/* Confirm reassign from another project */}
      {confirming && (
        <div style={{
          padding: 16,
          background: '#fff8e1',
          border: '1px solid #ffe082',
          borderRadius: 4,
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#5d4037', marginBottom: 10 }}>
            &ldquo;{confirming.name}&rdquo; is already assigned to &ldquo;{confirming.projectSlug}&rdquo;.
            Reassigning will remove it from that project.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => doAssign(confirming)}
              style={{ padding: '6px 16px', fontSize: 13, fontWeight: 500, background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              Reassign
            </button>
            <button
              onClick={() => setConfirming(null)}
              style={{ padding: '6px 16px', fontSize: 13, background: '#fff', border: '1px solid #d0d0d0', borderRadius: 4, cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <input
        placeholder="Search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 12px',
          fontSize: 13,
          border: '1px solid #d0d0d0',
          borderRadius: 4,
          marginBottom: 20,
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />

      {!hasAny && (
        <div style={{ fontSize: 13, color: '#888' }}>No design systems found.</div>
      )}

      <GroupSection title="Assigned to this project" items={groups.assignedHere} />
      <GroupSection title="Available templates" items={groups.templates} badge={() => 'Template'} />
      <GroupSection title="Unassigned" items={groups.unassigned} />
      <GroupSection
        title="Assigned elsewhere"
        items={groups.assignedElsewhere}
        badge={(ds) => `Assigned to ${ds.projectSlug}`}
      />
    </div>
  )
}
