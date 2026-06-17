'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useClient } from 'sanity'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DSDoc {
  _id: string
  name: string
  role: 'active' | 'template'
  projectSlug?: string
}

interface DSGroups {
  assignedHere: DSDoc[]
  templates: DSDoc[]
  unassigned: DSDoc[]
  assignedElsewhere: DSDoc[]
}

export interface DesignSystemPickerProps {
  /** projectSlug of the current project — used for grouping and DS sync */
  projectSlug?: string
  /** _ref of the currently assigned design system, or undefined */
  currentDSRef?: string
  /** Called when the user selects a DS to assign */
  onAssign: (ds: DSDoc) => void
  /** Called when the user removes the current assignment */
  onRemove?: () => void
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const btn = (variant: 'primary' | 'secondary' | 'ghost'): React.CSSProperties => ({
  padding: '6px 14px',
  fontSize: 13,
  fontWeight: 500,
  border: variant === 'ghost' ? 'none' : '1px solid',
  borderColor: variant === 'primary' ? 'transparent' : '#d0d0d0',
  borderRadius: 4,
  background: variant === 'primary' ? '#1a1a1a' : variant === 'secondary' ? '#fff' : 'transparent',
  color: variant === 'primary' ? '#fff' : '#333',
  cursor: 'pointer',
  lineHeight: '1.4',
})

const sectionHead: React.CSSProperties = {
  fontSize: 11,
  color: '#999',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  padding: '10px 14px 6px',
}

// ── PickerPanel ───────────────────────────────────────────────────────────────

interface PickerPanelProps {
  groups: DSGroups
  search: string
  onSearch: (v: string) => void
  onSelect: (ds: DSDoc) => void
  onClose: () => void
  currentDSRef?: string
  confirming: DSDoc | null
  onConfirm: () => void
  onCancelConfirm: () => void
}

function PickerPanel({
  groups,
  search,
  onSearch,
  onSelect,
  onClose,
  currentDSRef,
  confirming,
  onConfirm,
  onCancelConfirm,
}: PickerPanelProps) {
  const { assignedHere, templates, unassigned, assignedElsewhere } = groups
  const hasResults =
    assignedHere.length + templates.length + unassigned.length + assignedElsewhere.length > 0

  function DSItem({ ds, badge }: { ds: DSDoc; badge?: string }) {
    const isCurrent = ds._id === currentDSRef
    return (
      <div
        onClick={() => onSelect(ds)}
        style={{
          padding: '10px 14px',
          cursor: 'pointer',
          background: isCurrent ? '#f0f0f0' : 'transparent',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#111' }}>
            {ds.name ?? ds._id}
          </div>
          {badge && (
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{badge}</div>
          )}
        </div>
        {isCurrent && (
          <span style={{ fontSize: 11, color: '#2e7d32', fontWeight: 600 }}>Current</span>
        )}
      </div>
    )
  }

  return (
    <div style={{
      marginTop: 8,
      border: '1px solid #d0d0d0',
      borderRadius: 4,
      background: '#fff',
      boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        borderBottom: '1px solid #eee',
      }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>
          Select Design System
        </span>
        <button style={btn('ghost')} onClick={onClose}>✕</button>
      </div>

      {/* Search */}
      <div style={{ padding: '8px 14px', borderBottom: '1px solid #f0f0f0' }}>
        <input
          autoFocus
          placeholder="Search…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '7px 10px',
            fontSize: 13,
            border: '1px solid #d0d0d0',
            borderRadius: 4,
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Confirm reassign prompt */}
      {confirming && (
        <div style={{
          padding: 14,
          background: '#fff8e1',
          borderBottom: '1px solid #ffe082',
        }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: '#5d4037', marginBottom: 8 }}>
            &ldquo;{confirming.name}&rdquo; is already assigned to &ldquo;{confirming.projectSlug}&rdquo;.
            Reassigning will remove it from that project.
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn('primary')} onClick={onConfirm}>Reassign</button>
            <button style={btn('secondary')} onClick={onCancelConfirm}>Cancel</button>
          </div>
        </div>
      )}

      {/* Grouped list */}
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        {!hasResults && (
          <div style={{ padding: 14, fontSize: 13, color: '#888' }}>
            No design systems found
          </div>
        )}

        {assignedHere.length > 0 && (
          <>
            <div style={sectionHead}>Assigned to This Project</div>
            {assignedHere.map((ds) => <DSItem key={ds._id} ds={ds} />)}
          </>
        )}

        {templates.length > 0 && (
          <>
            <div style={sectionHead}>Available Templates</div>
            {templates.map((ds) => <DSItem key={ds._id} ds={ds} badge="Template" />)}
          </>
        )}

        {unassigned.length > 0 && (
          <>
            <div style={sectionHead}>Unassigned</div>
            {unassigned.map((ds) => <DSItem key={ds._id} ds={ds} />)}
          </>
        )}

        {assignedElsewhere.length > 0 && (
          <>
            <div style={sectionHead}>Assigned Elsewhere</div>
            {assignedElsewhere.map((ds) => (
              <DSItem key={ds._id} ds={ds} badge={`Assigned to ${ds.projectSlug}`} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// ── DesignSystemPicker ────────────────────────────────────────────────────────

export function DesignSystemPicker({
  projectSlug,
  currentDSRef,
  onAssign,
  onRemove,
}: DesignSystemPickerProps) {
  const sanity = useClient({ apiVersion: '2026-05-21' })

  const [allDS, setAllDS] = useState<DSDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [confirming, setConfirming] = useState<DSDoc | null>(null)

  const currentDS = useMemo(
    () => allDS.find((ds) => ds._id === currentDSRef) ?? null,
    [allDS, currentDSRef]
  )

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

  const groups = useMemo((): DSGroups => {
    const q = search.toLowerCase()
    const filtered = allDS.filter((ds) => !q || (ds.name ?? '').toLowerCase().includes(q))
    return {
      assignedHere: filtered.filter(
        (ds) => ds.role !== 'template' && !!ds.projectSlug && ds.projectSlug === projectSlug
      ),
      templates: filtered.filter((ds) => ds.role === 'template'),
      unassigned: filtered.filter(
        (ds) => ds.role !== 'template' && !ds.projectSlug
      ),
      assignedElsewhere: filtered.filter(
        (ds) => ds.role !== 'template' && !!ds.projectSlug && ds.projectSlug !== projectSlug
      ),
    }
  }, [allDS, search, projectSlug])

  const closePicker = useCallback(() => {
    setPickerOpen(false)
    setConfirming(null)
    setSearch('')
  }, [])

  const assign = useCallback(
    (ds: DSDoc) => {
      // Sync projectSlug on old DS (best-effort)
      if (currentDSRef && currentDSRef !== ds._id) {
        sanity.patch(currentDSRef).unset(['projectSlug']).commit({ visibility: 'async' }).catch(() => {})
      }
      // Sync projectSlug on new DS (best-effort)
      if (projectSlug) {
        sanity.patch(ds._id).set({ projectSlug, role: 'active' }).commit({ visibility: 'async' }).catch(() => {})
      }

      // Optimistically update local DS list
      setAllDS((prev) =>
        prev.map((d) => {
          if (d._id === ds._id) return { ...d, projectSlug: projectSlug ?? d.projectSlug, role: 'active' }
          if (d._id === currentDSRef) return { ...d, projectSlug: undefined }
          return d
        })
      )

      onAssign(ds)
      closePicker()
    },
    [currentDSRef, projectSlug, sanity, onAssign, closePicker]
  )

  const handleSelect = useCallback(
    (ds: DSDoc) => {
      // DS assigned elsewhere → require confirmation before reassigning
      if (ds.projectSlug && ds.projectSlug !== projectSlug) {
        setConfirming(ds)
      } else {
        assign(ds)
      }
    },
    [assign, projectSlug]
  )

  const handleRemove = useCallback(() => {
    if (currentDSRef) {
      sanity.patch(currentDSRef).unset(['projectSlug']).commit({ visibility: 'async' }).catch(() => {})
      setAllDS((prev) =>
        prev.map((d) => (d._id === currentDSRef ? { ...d, projectSlug: undefined } : d))
      )
    }
    onRemove?.()
  }, [currentDSRef, sanity, onRemove])

  if (loading) {
    return <div style={{ fontSize: 13, color: '#888', padding: '8px 0' }}>Loading…</div>
  }

  // ── Assigned state ─────────────────────────────────────────────────────────

  if (currentDSRef && currentDS) {
    return (
      <div>
        <div style={{
          padding: '12px 14px',
          background: '#f8f8f8',
          border: '1px solid #e0e0e0',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#111' }}>
              {currentDS.name ?? currentDS._id}
            </div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
              {currentDS.role === 'template' ? 'Template' : 'Active'}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={btn('secondary')} onClick={() => setPickerOpen(true)}>
              Change
            </button>
            {onRemove && (
              <button style={btn('ghost')} onClick={handleRemove}>
                Remove
              </button>
            )}
          </div>
        </div>

        {pickerOpen && (
          <PickerPanel
            groups={groups}
            search={search}
            onSearch={setSearch}
            onSelect={handleSelect}
            onClose={closePicker}
            currentDSRef={currentDSRef}
            confirming={confirming}
            onConfirm={() => confirming && assign(confirming)}
            onCancelConfirm={() => setConfirming(null)}
          />
        )}
      </div>
    )
  }

  // ── Empty state ────────────────────────────────────────────────────────────

  return (
    <div>
      <div style={{
        padding: '12px 14px',
        background: '#fafafa',
        border: '1px dashed #d0d0d0',
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 13, color: '#888' }}>No design system assigned</span>
        <button style={btn('secondary')} onClick={() => setPickerOpen(true)}>
          + Assign
        </button>
      </div>

      {pickerOpen && (
        <PickerPanel
          groups={groups}
          search={search}
          onSearch={setSearch}
          onSelect={handleSelect}
          onClose={closePicker}
          currentDSRef={undefined}
          confirming={confirming}
          onConfirm={() => confirming && assign(confirming)}
          onCancelConfirm={() => setConfirming(null)}
        />
      )}
    </div>
  )
}
