'use client'

import { useState } from 'react'
import { deployment, environmentLabel } from '@/lib/deployment'

/**
 * Deployment badge — shown only on non-production environments.
 *
 * Displays: DEV • V0.8.2 • 383aca8
 * Click opens a diagnostics panel with full build metadata.
 *
 * Uses plain inline styles — no Tailwind/design-system dependency —
 * so it renders identically across all tenant themes.
 */

// Build time in the VIEWER'S timezone, with the zone named so there is never a
// doubt about which clock it is. `toUTCString()` was showing GMT to everyone,
// which reads as an hour or two "wrong" to anyone not on UTC -- in Italy the
// build that happened at 17:20 local was reported as 15:20.
// This component is already a client component, so the browser's own zone is
// available; `undefined` locale means "use the viewer's".
function formatBuilt(iso: string | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export function DevBadge() {
  const label = environmentLabel()
  const [open, setOpen] = useState(false)

  // Hidden in production — zero DOM footprint
  if (!label) return null

  const accentColor = label === 'PREVIEW' ? '#f59e0b' : '#6366f1'
  const badgeText = `${label} • ${deployment.commitSha}`

  return (
    <>
      {/* Badge pill */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Deployment info"
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 99999,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 10px',
          borderRadius: 20,
          background: 'rgba(0,0,0,0.75)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: `1px solid ${accentColor}44`,
          color: '#fff',
          fontSize: 10,
          fontFamily: 'monospace',
          fontWeight: 600,
          letterSpacing: '0.05em',
          cursor: 'pointer',
          userSelect: 'none',
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
          lineHeight: 1,
        }}
      >
        <span style={{ color: accentColor, fontWeight: 700 }}>{label}</span>
        <span style={{ opacity: 0.5 }}>•</span>
        <span style={{ opacity: 0.65 }}>{deployment.commitSha}</span>
      </button>

      {/* Diagnostics panel */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 99998,
            }}
          />
          {/* Panel */}
          <div
            style={{
              position: 'fixed',
              bottom: 52,
              right: 16,
              zIndex: 99999,
              minWidth: 240,
              padding: '14px 16px',
              borderRadius: 12,
              background: 'rgba(10,10,10,0.92)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              border: `1px solid ${accentColor}55`,
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              fontFamily: 'monospace',
              fontSize: 11,
              lineHeight: 1.7,
              color: '#e5e7eb',
            }}
          >
            <p style={{ margin: '0 0 8px', fontWeight: 700, fontSize: 10, letterSpacing: '0.1em', color: accentColor, textTransform: 'uppercase' }}>
              Deployment
            </p>
            {[
              ['Environment', label],
              ['Commit',      deployment.commitSha],
              ['Branch',      deployment.branch],
              ['Built',       formatBuilt(deployment.buildTime)],
            ].map(([key, val]) => (
              <div key={key} style={{ display: 'flex', gap: 8 }}>
                <span style={{ opacity: 0.45, minWidth: 90 }}>{key}</span>
                <span style={{ opacity: 0.9 }}>{val}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}
