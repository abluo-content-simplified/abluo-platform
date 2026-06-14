'use client'

import { useEffect, useState, useCallback } from 'react'
import { StringInputProps, PatchEvent, set, unset } from 'sanity'

interface Tenant {
  tenantId: string
  tenantSlug: string
  displayName: string
}

interface TenantDetail {
  id: string
  slug: string
  display_name: string
  status: string
  plan: string
  created_at: string
}

export function TenantLinker(props: StringInputProps) {
  const { value, onChange } = props

  const [tenants, setTenants] = useState<Tenant[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [detail, setDetail] = useState<TenantDetail | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load tenant list on mount
  useEffect(() => {
    fetch('/api/sanity/tenants')
      .then((r) => r.json())
      .then((data) => setTenants(Array.isArray(data) ? data : []))
      .catch(() => setError('Failed to load tenants'))
      .finally(() => setLoadingList(false))
  }, [])

  // If document already has a tenantId, fetch its detail for display
  useEffect(() => {
    if (!value) return
    setSelectedId(value)
    setLoadingDetail(true)
    fetch(`/api/sanity/tenant?id=${value}`)
      .then((r) => r.json())
      .then((data) => setDetail(data))
      .catch(() => setError('Failed to load linked tenant'))
      .finally(() => setLoadingDetail(false))
  }, [value])

  // When dropdown changes, fetch detail for the newly selected tenant
  const handleSelect = useCallback(async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value
    setSelectedId(id)
    setDetail(null)
    setError(null)

    if (!id) return

    setLoadingDetail(true)
    try {
      const r = await fetch(`/api/sanity/tenant?id=${id}`)
      if (!r.ok) throw new Error('Not found')
      const data = await r.json()
      setDetail(data)
    } catch {
      setError('Failed to load tenant details')
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  // Write all three fields at once
  const handleLink = useCallback(() => {
    if (!detail) return
    onChange(
      PatchEvent.from([
        set(detail.id,           []),               // tenantId (this field)
        set(detail.slug,         ['tenantSlug']),    // sibling
        set(detail.display_name, ['displayName']),   // sibling
      ])
    )
  }, [detail, onChange])

  // Clear the link
  const handleRelink = useCallback(() => {
    setSelectedId('')
    setDetail(null)
    onChange(
      PatchEvent.from([
        unset([]),
        unset(['tenantSlug']),
        unset(['displayName']),
      ])
    )
  }, [onChange])

  // ── Shared info panel ────────────────────────────────────────────────────────

  function InfoPanel({ tenant }: { tenant: TenantDetail }) {
    return (
      <div style={{
        marginTop: 12,
        padding: 12,
        background: '#f8f8f8',
        borderRadius: 4,
        border: '1px solid #e0e0e0',
        fontSize: 13,
      }}>
        <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 12, color: '#444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Tenant Information
        </div>
        {[
          ['Display Name', tenant.display_name],
          ['Slug',         tenant.slug],
          ['Status',       tenant.status],
          ['Plan',         tenant.plan],
          ['Created At',   new Date(tenant.created_at).toLocaleDateString()],
        ].map(([label, val]) => (
          <div key={label} style={{ display: 'flex', marginBottom: 6 }}>
            <span style={{ width: 100, color: '#888', flexShrink: 0 }}>{label}</span>
            <span style={{ color: '#111' }}>{val}</span>
          </div>
        ))}
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (loadingList) {
    return <div style={{ padding: 12, color: '#666', fontSize: 13 }}>Loading tenants…</div>
  }

  // Already linked — show linked state
  if (value && !loadingDetail) {
    return (
      <div style={{ padding: 4 }}>
        <div style={{ fontSize: 13, color: '#2e7d32', fontWeight: 500, marginBottom: 8 }}>
          ✓ Linked: {detail?.display_name ?? value} {detail ? `(${detail.slug})` : ''}
        </div>

        {detail && <InfoPanel tenant={detail} />}

        <button
          onClick={handleRelink}
          style={{
            marginTop: 12,
            padding: '8px 16px',
            fontSize: 13,
            border: '1px solid #ccc',
            borderRadius: 4,
            background: '#fff',
            cursor: 'pointer',
          }}
        >
          Relink Tenant
        </button>
      </div>
    )
  }

  // Unlinked — show selector
  return (
    <div style={{ padding: 4 }}>
      {error && (
        <div style={{ marginBottom: 10, padding: '8px 10px', background: '#ffebee', border: '1px solid #ef9a9a', borderRadius: 4, fontSize: 13, color: '#c62828' }}>
          {error}
        </div>
      )}

      <select
        value={selectedId}
        onChange={handleSelect}
        disabled={loadingDetail}
        style={{
          width: '100%',
          padding: '10px 12px',
          fontSize: 13,
          border: '1px solid #ccc',
          borderRadius: 4,
          background: '#fff',
          cursor: 'pointer',
        }}
      >
        <option value="">— Select a tenant —</option>
        {tenants.map((t) => (
          <option key={t.tenantId} value={t.tenantId}>
            {t.displayName} ({t.tenantSlug})
          </option>
        ))}
      </select>

      {loadingDetail && (
        <div style={{ marginTop: 10, fontSize: 13, color: '#666' }}>Loading tenant details…</div>
      )}

      {detail && !loadingDetail && (
        <>
          <InfoPanel tenant={detail} />
          <button
            onClick={handleLink}
            style={{
              marginTop: 12,
              width: '100%',
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 500,
              border: 'none',
              borderRadius: 4,
              background: '#1a1a1a',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            Link Tenant
          </button>
        </>
      )}
    </div>
  )
}
