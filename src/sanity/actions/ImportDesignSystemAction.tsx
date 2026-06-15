import { useRef, useState, useCallback } from 'react'
import { DocumentActionProps, DocumentActionComponent, useClient } from 'sanity'
import { validateImport, stripMetadata } from './designSystemUtils'

type ImportMode = 'create' | 'overwrite' | 'preview'

type DialogState =
  | { step: 'closed' }
  | { step: 'choose'; data: Record<string, unknown>; filename: string; schemaVersion?: number }
  | { step: 'applying' }
  | { step: 'done'; mode: ImportMode }
  | { step: 'error'; message: string }

export const ImportDesignSystemAction: DocumentActionComponent = (
  props: DocumentActionProps
) => {
  const { id, draft, published } = props
  const client = useClient({ apiVersion: '2026-05-21' })
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [dialog, setDialog] = useState<DialogState>({ step: 'closed' })
  const [mode, setMode] = useState<ImportMode>('create')

  const currentDoc = (draft ?? published) as Record<string, unknown> | null

  // ── File selected ──────────────────────────────────────────────────────────

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      e.target.value = '' // allow re-selecting the same file

      let raw: unknown
      try {
        raw = JSON.parse(await file.text())
      } catch {
        setDialog({ step: 'error', message: 'Could not parse file — ensure it is valid JSON.' })
        return
      }

      const result = validateImport(raw)
      if (!result.valid) {
        setDialog({ step: 'error', message: result.error })
        return
      }

      setDialog({
        step: 'choose',
        data: result.data,
        filename: file.name,
        schemaVersion: result.schemaVersion,
      })
    },
    []
  )

  // ── Apply import ───────────────────────────────────────────────────────────

  const handleApply = useCallback(async () => {
    if (dialog.step !== 'choose') return
    const { data } = dialog

    setDialog({ step: 'applying' })

    try {
      if (mode === 'create') {
        // Strip projectSlug — new document is intentionally unassigned.
        // The user will link it to a project explicitly afterward.
        const { projectSlug: _, ...rest } = data as Record<string, unknown>
        const name = typeof rest.name === 'string' ? rest.name : 'Imported Design System'
        await client.create({
          _type: 'designSystem',
          ...rest,
          name: `${name} (Imported)`,
          projectSlug: null,
        })
      } else if (mode === 'overwrite') {
        // Patch all imported fields onto the current document.
        // Fields not present in the import are left untouched.
        const stripped = stripMetadata(data)
        await client.patch(id).set(stripped).commit()
      } else if (mode === 'preview') {
        // TODO: Preview Changes — show a diff of current vs imported values
        // before applying. Not implemented in this phase.
        throw new Error('Preview Changes is not yet implemented.')
      }
      setDialog({ step: 'done', mode })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.'
      setDialog({ step: 'error', message })
    }
  }, [dialog, mode, client, id])

  const handleClose = useCallback(() => {
    setDialog({ step: 'closed' })
    setMode('create')
  }, [])

  // ── Trigger file picker ────────────────────────────────────────────────────

  const handleOpen = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  // ── Attach hidden file input to document body (once) ──────────────────────

  const attachFileInput = useCallback((el: HTMLInputElement | null) => {
    fileInputRef.current = el
  }, [])

  // ── Dialog content ─────────────────────────────────────────────────────────

  const renderContent = () => {
    if (dialog.step === 'choose') {
      return (
        <div style={{ padding: '20px 24px', minWidth: 400 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>File</div>
            <div style={{ fontSize: 13, color: '#111' }}>{dialog.filename}</div>
            {dialog.schemaVersion != null && (
              <div style={{ fontSize: 12, color: '#aaa', marginTop: 2 }}>
                Schema version: {dialog.schemaVersion}
              </div>
            )}
          </div>

          <div style={{ fontSize: 12, color: '#888', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Import mode
          </div>

          {(
            [
              { value: 'create', label: 'Create New', description: 'Creates an unassigned copy — you link it to a project afterward.' },
              { value: 'overwrite', label: 'Overwrite Current', description: 'Replaces all fields in this Design System. Cannot be undone.' },
              { value: 'preview', label: 'Preview Changes', description: 'Coming soon — see a diff before applying.' },
            ] as { value: ImportMode; label: string; description: string }[]
          ).map((opt) => {
            const isDisabled = opt.value === 'preview'
            return (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  padding: '10px 12px',
                  marginBottom: 6,
                  borderRadius: 6,
                  border: `1px solid ${mode === opt.value && !isDisabled ? '#1a1a1a' : '#e5e5e5'}`,
                  background: isDisabled ? '#fafafa' : mode === opt.value ? '#f8f8f8' : '#fff',
                  cursor: isDisabled ? 'not-allowed' : 'pointer',
                  opacity: isDisabled ? 0.5 : 1,
                }}
              >
                <input
                  type="radio"
                  name="import-mode"
                  value={opt.value}
                  checked={mode === opt.value}
                  disabled={isDisabled}
                  onChange={() => setMode(opt.value)}
                  style={{ marginTop: 2, cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: isDisabled ? '#aaa' : '#111' }}>
                    {opt.label}
                  </div>
                  <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                    {opt.description}
                  </div>
                </div>
              </label>
            )
          })}

          {mode === 'overwrite' && (
            <div style={{
              marginTop: 12,
              padding: '10px 14px',
              background: '#fff8f0',
              border: '1px solid #f5c58a',
              borderRadius: 6,
              fontSize: 12,
              color: '#7a4a00',
            }}>
              This will overwrite the current Design System. Fields not present in the imported file will remain untouched.
            </div>
          )}
        </div>
      )
    }

    if (dialog.step === 'applying') {
      return (
        <div style={{ padding: '24px', textAlign: 'center', color: '#888', fontSize: 13 }}>
          Applying import…
        </div>
      )
    }

    if (dialog.step === 'done') {
      const message = dialog.mode === 'create'
        ? 'New Design System created. Find it in the Design Systems section to link it to a project.'
        : 'Design System updated successfully.'
      return (
        <div style={{ padding: '24px', fontSize: 13, color: '#2e7d32' }}>
          ✓ {message}
        </div>
      )
    }

    if (dialog.step === 'error') {
      return (
        <div style={{ padding: '24px', fontSize: 13, color: '#c62828' }}>
          {dialog.message}
        </div>
      )
    }

    return null
  }

  const renderFooter = () => {
    if (dialog.step === 'done' || dialog.step === 'error') {
      return (
        <div style={{ padding: '12px 24px', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={handleClose} style={secondaryBtn}>Close</button>
        </div>
      )
    }
    if (dialog.step === 'choose') {
      return (
        <div style={{ padding: '12px 24px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={handleClose} style={secondaryBtn}>Cancel</button>
          <button onClick={handleApply} style={primaryBtn}>Continue</button>
        </div>
      )
    }
    return null
  }

  // ── Action descriptor ──────────────────────────────────────────────────────

  return {
    label: 'Import JSON',
    disabled: !currentDoc,
    onHandle: handleOpen,
    dialog: dialog.step !== 'closed'
      ? {
          type: 'dialog' as const,
          header: 'Import Design System',
          onClose: handleClose,
          content: (
            <>
              {/* Hidden file input — lives outside the dialog DOM */}
              <input
                ref={attachFileInput}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              {renderContent()}
            </>
          ),
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
