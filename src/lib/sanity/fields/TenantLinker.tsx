'use client'

import { useEffect, useState, useCallback } from 'react'
import { ObjectInputProps, PatchEvent, set, unset, useClient } from 'sanity'

interface TenantListItem {
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

interface ClientDocument {
  tenantId?: string
  tenantSlug?: string
  displayName?: string
}

export function TenantLinker(props: ObjectInputProps) {
  const { value, onChange } = props
  const doc = (value ?? {}) as ClientDocument

  const client = useClient({ apiVersion: '2026-05-21' })

  const [tenants, setTenants] = useState<TenantListItem[]>([])
  const [linkedIds, setLinkedIds] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string>('')
  const [detail, setDetail] = useState<TenantDetail | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load tenant list + already-linked IDs in parallel on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/sanity/tenants').then((r) => r.json()),
      client.fetch<string[]>(
        `*[_type == "client" && defined(tenantId) && _id != $currentId && !(_id in path("drafts.**"))].tenantId`,
        { currentId: (value as any)?._id ?? '' }
      ),
    ])
      .then(([tenantList, linked]) => {
        setTenants(Array.isArray(tenantList) ? tenantList : [])
        setLinkedIds(new Set(Array.isArray(linked) ? linked : []))
      })
      .catch(() => setError('Failed to load tenants'))
      .finally(() => setLoadingList(false))
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // If document already has a tenantId, fetch its detail for display
  useEffect(() => {
    if (!doc.tenantId) return
    setSelectedId(doc.tenantId)
    setLoadingDetail(true)
    fetch(`/api/sanity/tenant?id=${doc.tenantId}`)
      .then((r) => r.json())
      .then((data) => setDetail(data))
      .catch(() => setError('Failed to load linked tenant'))
      .finally(() => setLoadingDetail(false))
  }, [doc.tenantId])  // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch detail when user picks from the dropdown
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
      const data: TenantDetail = await r.json()
      setDetail(data)
    } catch {
      setError('Failed to load tenant details')
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  // Write all three fields to the document root
  const handleLink = useCallback(() => {
    if (!detail) return
    onChange(
      PatchEvent.from([
        set(detail.id,           ['tenantId']),
        set(detail.slug,         ['tenantSlug']),
        set(detail.display_name, ['displayName']),
      ])
    )
  }, [detail, onChange])

  // Clear the link
  const handleRelink = useCallback(() => {
    setSelectedId('')
    setDetail(null)
    onChange(
      PatchEvent.from([
        unset(['tenantId']),
        unset(['tenantSlug']),
        unset(['displayName']),
      ])
    )
  }, [onChange])

  // ── Info panel ───────────────────────────────────────────────────────────────

  function InfoPanel({ tenant }: { tenant: TenantDetail }) {
    const rows: [string, string][] = [
      ['Display Name', tenant.display_name],
      ['Slug',         tenant.slug],
      ['Status',       tenant.status],
      ['Plan',         tenant.plan],
      ['Created At',   new Date(tenant.created_at).toLocaleDateString()],
    ]

    return (
      <div style={{
        marginTop: 12,
        padding: 16,
        background: '#f8f8f8',
        borderRadius: 4,
        border: '1px solid #e0e0e0',
        fontSize: 13,
      }}>
        <div style={{
          fontWeight: 600,
          marginBottom: 12,
          fontSize: 11,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Tenant Information
        </div>

        {rows.map(([label, val]) => (
          <div key={label} style={{ display: 'flex', marginBottom: 6 }}>
            <span style={{ width: 110, color: '#888', flexShrink: 0, fontSize: 13 }}>{label}</span>
            <span style={{ color: '#111', fontSize: 13 }}>{val}</span>
          </div>
        ))}

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Tenant ID
          </div>
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#555', wordBreak: 'break-all' }}>
            {tenant.id}
          </div>
        </div>
      </div>
    )
  }

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loadingList) {
    return <div style={{ padding: '16px 0', color: '#666', fontSize: 13 }}>Loading tenants…</div>
  }

  // ── Linked state ─────────────────────────────────────────────────────────────

  if (doc.tenantId) {
    return (
      <div style={{ padding: '4px 0' }}>
        <div style={{ fontSize: 13, color: '#2e7d32', fontWeight: 500, marginBottom: 8 }}>
          ✓ Linked: {doc.displayName ?? doc.tenantId} {doc.tenantSlug ? `(${doc.tenantSlug})` : ''}
        </div>

        {loadingDetail && <div style={{ fontSize: 13, color: '#666' }}>Loading tenant details…</div>}
        {detail && !loadingDetail && <InfoPanel tenant={detail} />}

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

  // ── Unlinked state ───────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '4px 0' }}>
      {error && (
        <div style={{
          marginBottom: 12,
          padding: '8px 12px',
          background: '#ffebee',
          border: '1px solid #ef9a9a',
          borderRadius: 4,
          fontSize: 13,
          color: '#c62828',
        }}>
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
        {tenants.map((t) => {
          const isLinked = linkedIds.has(t.tenantId)
          return (
            <option key={t.tenantId} value={t.tenantId}>
              {isLinked ? '✓' : '○'} {t.displayName} ({t.tenantSlug})
            </option>
          )
        })}
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
