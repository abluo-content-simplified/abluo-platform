'use client'

/**
 * StubPane — shared placeholder component for Project Settings sections
 * that are named but not yet implemented.
 *
 * ADR-011 Phase C1. Used for: Domains, Analytics, Billing, Integrations.
 * When a section is ready for implementation, replace its S.component(StubPane)
 * with a dedicated component — no other changes required.
 */

interface StubPaneProps {
  options?: {
    label?: string
    message?: string
  }
}

export function StubPane({ options }: StubPaneProps) {
  const label = options?.label ?? 'Coming Soon'
  const message =
    options?.message ?? 'This section is coming in a future release.'

  return (
    <div
      style={{
        padding: '32px',
        maxWidth: 480,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: '#999',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          marginBottom: 12,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          color: '#aaa',
          lineHeight: 1.6,
        }}
      >
        {message}
      </div>
    </div>
  )
}
