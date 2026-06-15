import { useState, useCallback } from 'react'
import { DocumentActionProps, DocumentActionComponent, useClient } from 'sanity'
import { CopyIcon } from '@sanity/icons'
import { stripMetadata } from './designSystemUtils'

export const DuplicateDesignSystemAction: DocumentActionComponent = (
  props: DocumentActionProps
) => {
  const { draft, published } = props
  const client = useClient({ apiVersion: '2026-05-21' })

  const [dialogOpen, setDialogOpen] = useState(false)
  const [isDuplicating, setIsDuplicating] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doc = (draft ?? published) as Record<string, unknown> | null

  const handleConfirm = useCallback(async () => {
    if (!doc) return
    setIsDuplicating(true)
    setError(null)

    try {
      const stripped = stripMetadata(doc)
      const sourceName = typeof stripped.name === 'string' ? stripped.name : 'Design System'

      // Duplicate is always unassigned — user links it to a project explicitly.
      await client.create({
        _type: 'designSystem',
        ...stripped,
        name: `${sourceName} (Copy)`,
        projectSlug: null,
      })

      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unexpected error occurred.')
    } finally {
      setIsDuplicating(false)
    }
  }, [doc, client])

  const handleClose = useCallback(() => {
    setDialogOpen(false)
    setDone(false)
    setError(null)
  }, [])

  // ── Dialog content ─────────────────────────────────────────────────────────

  const sourceName =
    (doc?.name as string | undefined) ?? (doc?.projectSlug as string | undefined) ?? 'this Design System'

  const renderContent = () => {
    if (done) {
      return (
        <div style={{ padding: '24px', fontSize: 13, color: '#2e7d32' }}>
          ✓ "{sourceName} (Copy)" created and left unassigned. Find it in the Design Systems section to link it to a project.
        </div>
      )
    }
    if (error) {
      return (
        <div style={{ padding: '24px', fontSize: 13, color: '#c62828' }}>{error}</div>
      )
    }
    if (isDuplicating) {
      return (
        <div style={{ padding: '24px', textAlign: 'center', color: '#888', fontSize: 13 }}>
          Duplicating…
        </div>
      )
    }
    return (
      <div style={{ padding: '20px 24px', minWidth: 360, fontSize: 13, color: '#333', lineHeight: 1.6 }}>
        <p style={{ margin: '0 0 12px' }}>
          This will create <strong>"{sourceName} (Copy)"</strong> as an unassigned Design System.
        </p>
        <p style={{ margin: 0, color: '#888', fontSize: 12 }}>
          The copy will not be linked to any project. You can assign it later.
        </p>
      </div>
    )
  }

  const renderFooter = () => {
    if (done || error) {
      return (
        <div style={{ padding: '12px 24px', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleClose} style={secondaryBtn}>Close</button>
        </div>
      )
    }
    if (!isDuplicating) {
      return (
        <div style={{ padding: '12px 24px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={handleClose} style={secondaryBtn}>Cancel</button>
          <button onClick={handleConfirm} style={primaryBtn}>Duplicate</button>
        </div>
      )
    }
    return null
  }

  return {
    label: 'Duplicate',
    icon: CopyIcon,
    disabled: !doc,
    onHandle: () => setDialogOpen(true),
    dialog: dialogOpen
      ? {
          type: 'dialog' as const,
          header: 'Duplicate Design System',
          onClose: handleClose,
          content: renderContent(),
          footer: renderFooter(),
        }
      : false,
  }
}

// ── Minimal inline styles ─────────────────────────────────────────────────────

const primaryBtn: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  border: 'none',
  borderRadius: 4,
  background: '#1a1a1a',
  color: '#fff',
  cursor: 'pointer',
}

const secondaryBtn: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  border: '1px solid #ccc',
  borderRadius: 4,
  background: '#fff',
  color: '#333',
  cursor: 'pointer',
}
