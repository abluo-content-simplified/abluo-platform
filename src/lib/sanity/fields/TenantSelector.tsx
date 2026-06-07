'use client'

import { useEffect, useState, useCallback } from 'react'
import { useFormValue, PatchEvent, set, unset } from 'sanity'

interface Tenant {
  tenantId: string
  tenantSlug: string
  displayName: string
}

export function TenantSelector(props: any) {
  const { value, onChange, path } = props
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch tenants on mount
  useEffect(() => {
    const fetchTenants = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/sanity/tenants')
        const data = await response.json()
        setTenants(Array.isArray(data) ? data : [])
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load tenants')
        setTenants([])
      } finally {
        setLoading(false)
      }
    }

    fetchTenants()
  }, [])

  const handleTenantSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const selectedTenantId = e.target.value
      if (!selectedTenantId) {
        // Clear all three fields
        onChange(
          PatchEvent.from([
            unset(['tenantId']),
            unset(['tenantSlug']),
            unset(['displayName']),
          ])
        )
        return
      }

      // Find selected tenant
      const selected = tenants.find((t) => t.tenantId === selectedTenantId)
      if (selected) {
        // Set all three fields at once
        onChange(
          PatchEvent.from([
            set(selected.tenantId, ['tenantId']),
            set(selected.tenantSlug, ['tenantSlug']),
            set(selected.displayName, ['displayName']),
          ])
        )
      }
    },
    [tenants, onChange]
  )

  if (loading) {
    return (
      <div style={{ padding: '12px', color: '#666' }}>
        Loading tenants...
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '12px', color: '#d32f2f' }}>
        Error: {error}
      </div>
    )
  }

  if (tenants.length === 0) {
    return (
      <div style={{ padding: '12px', color: '#666' }}>
        No tenants found in Supabase
      </div>
    )
  }

  return (
    <div>
      <select
        value={value?.tenantId || ''}
        onChange={handleTenantSelect}
        style={{
          width: '100%',
          padding: '8px 12px',
          fontSize: '14px',
          border: '1px solid #ccc',
          borderRadius: '4px',
          fontFamily: 'inherit',
        }}
      >
        <option value="">— Select a Tenant —</option>
        {tenants.map((tenant) => (
          <option key={tenant.tenantId} value={tenant.tenantId}>
            {tenant.displayName} ({tenant.tenantSlug})
          </option>
        ))}
      </select>
    </div>
  )
}
