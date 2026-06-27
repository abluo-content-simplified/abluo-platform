'use client'

import { useEffect, useState } from 'react'
import { useClient } from 'sanity'
import { MODULE_REGISTRY } from '../../modules'

/**
 * ModuleList — read-only Project Settings > Modules pane.
 *
 * ADR-011 Phase C1.
 *
 * Displays all registered modules alongside their installation state for a
 * given project. Does not support install / uninstall — those controls arrive
 * in C2.
 *
 * Data sources:
 *   - MODULE_REGISTRY     — authoritative list of known modules
 *   - moduleInstallations — B1 persistence model, fetched via useClient()
 *
 * Each row shows:
 *   - Module label and id
 *   - Installed + enabled  → green badge, version shown
 *   - Installed + disabled → grey badge, version shown, "(disabled)" note
 *   - Not installed        → neutral badge
 */

interface ModuleInstallationRecord {
  moduleId: string
  version?: string
  enabled?: boolean
  installedAt?: string
  provenance?: 'admin' | 'auto'
}

interface ModuleListProps {
  options?: {
    projectSlug?: string
  }
}

// ── Badge styles ──────────────────────────────────────────────────────────────

const badge = (color: 'green' | 'grey' | 'neutral'): React.CSSProperties => {
  const map = {
    green:   { background: '#e8f5e9', color: '#2e7d32', border: '1px solid #c8e6c9' },
    grey:    { background: '#f5f5f5', color: '#9e9e9e', border: '1px solid #e0e0e0' },
    neutral: { background: '#fafafa', color: '#bdbdbd', border: '1px solid #eeeeee' },
  }
  return {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    ...map[color],
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ModuleList({ options }: ModuleListProps) {
  const projectSlug = options?.projectSlug
  const client = useClient({ apiVersion: '2026-05-21' })

  const [installations, setInstallations] = useState<ModuleInstallationRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectSlug) {
      setLoading(false)
      return
    }

    client
      .fetch<ModuleInstallationRecord[]>(
        `*[_type == "project" && projectSlug == $projectSlug && !(_id in path("drafts.**"))][0]
          .moduleInstallations[] {
            moduleId,
            version,
            enabled,
            installedAt,
            provenance
          }`,
        { projectSlug }
      )
      .then((data) => setInstallations(data ?? []))
      .catch(() => setError('Failed to load module installations.'))
      .finally(() => setLoading(false))
  }, [projectSlug]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: '32px', fontSize: 13, color: '#aaa' }}>
        Loading modules…
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  if (error) {
    return (
      <div
        style={{
          padding: '32px',
          fontSize: 13,
          color: '#c62828',
          background: '#ffebee',
          borderRadius: 4,
          margin: 32,
        }}
      >
        {error}
      </div>
    )
  }

  // ── No project slug ───────────────────────────────────────────────────────

  if (!projectSlug) {
    return (
      <div style={{ padding: '32px', fontSize: 13, color: '#aaa' }}>
        No project selected.
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // Build a lookup map: moduleId → installation record
  const installationMap = new Map<string, ModuleInstallationRecord>()
  for (const inst of installations) {
    installationMap.set(inst.moduleId, inst)
  }

  return (
    <div style={{ padding: '32px', maxWidth: 560 }}>

      {/* Header */}
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#999',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 20,
        }}
      >
        Modules — {projectSlug}
      </div>

      {/* Module rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {MODULE_REGISTRY.map((mod) => {
          const inst = installationMap.get(mod.id)
          const isInstalled = !!inst
          const isDisabled = isInstalled && inst.enabled === false

          return (
            <div
              key={mod.id}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                padding: '14px 16px',
                background: '#fafafa',
                border: '1px solid #eeeeee',
                borderRadius: 6,
              }}
            >
              {/* Left — label + id + meta */}
              <div>
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    color: isInstalled && !isDisabled ? '#111' : '#888',
                    marginBottom: 2,
                  }}
                >
                  {mod.label}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: '#bbb',
                    fontFamily: 'monospace',
                  }}
                >
                  {mod.id}
                  {isInstalled && inst.version ? ` · v${inst.version}` : ''}
                  {isInstalled && inst.provenance === 'auto' ? ' · migrated' : ''}
                </div>
              </div>

              {/* Right — status badge */}
              <div style={{ flexShrink: 0, marginLeft: 16 }}>
                {!isInstalled && (
                  <span style={badge('neutral')}>Not installed</span>
                )}
                {isInstalled && !isDisabled && (
                  <span style={badge('green')}>Enabled</span>
                )}
                {isInstalled && isDisabled && (
                  <span style={badge('grey')}>Disabled</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer note */}
      <div
        style={{
          marginTop: 24,
          fontSize: 12,
          color: '#ccc',
          lineHeight: 1.5,
        }}
      >
        Install and uninstall controls arrive in a future release.
      </div>

    </div>
  )
}
