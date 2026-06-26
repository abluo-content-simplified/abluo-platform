'use client'

import { useEffect, useState, useCallback } from 'react'
import { ObjectInputProps, PatchEvent, set, unset, useClient } from 'sanity'
import { DesignSystemPicker, type DSDoc } from './DesignSystemPicker'
import { MODULE_REGISTRY } from '../../modules'

interface SanityClientDoc {
  _id: string
  displayName: string
  tenantSlug: string
  tenantId: string
}

interface SupabaseProject {
  id: string
  slug: string
  name: string
  domain: string | null
  createdAt: string
}

// Minimal shape of a moduleInstallations entry for display purposes.
// config is intentionally omitted (Record<string, unknown>, unused here).
interface ModuleInstallationDisplay {
  moduleId: string
  version?: string
  enabled?: boolean
}

interface ProjectDocument {
  _id?: string
  projectId?: string
  projectSlug?: string
  projectName?: string
  tenantId?: string
  clientRef?: { _type: 'reference'; _ref: string }
  customDomain?: string
  designSystemRef?: { _type: 'reference'; _ref: string }
  /** ADR-011 Phase B1 — first-class installation records. */
  moduleInstallations?: ModuleInstallationDisplay[]
  /** Legacy — migration bridge. Read only if moduleInstallations is absent. */
  enabledModules?: string[]
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const row = (label: string, val: string | null | undefined) =>
  val ? (
    <div key={label} style={{ display: 'flex', marginBottom: 6 }}>
      <span style={{ width: 110, color: '#888', flexShrink: 0, fontSize: 13 }}>{label}</span>
      <span style={{ color: '#111', fontSize: 13 }}>{val}</span>
    </div>
  ) : null

// ── Component ─────────────────────────────────────────────────────────────────

export function ProjectLinker(props: ObjectInputProps) {
  const { value, onChange, renderDefault } = props
  const doc = (value ?? {}) as ProjectDocument

  const sanity = useClient({ apiVersion: '2026-05-21' })

  // Client list
  const [clients, setClients] = useState<SanityClientDoc[]>([])
  const [loadingClients, setLoadingClients] = useState(true)

  // Selected client
  const [selectedClientId, setSelectedClientId] = useState<string>(
    doc.clientRef?._ref ?? ''
  )
  const [clientTenantId, setClientTenantId] = useState<string>(
    doc.tenantId ?? ''
  )

  // Project list
  const [projects, setProjects] = useState<SupabaseProject[]>([])
  const [linkedProjectIds, setLinkedProjectIds] = useState<Set<string>>(new Set())
  const [loadingProjects, setLoadingProjects] = useState(false)

  // Selected project
  const [selectedProject, setSelectedProject] = useState<SupabaseProject | null>(null)

  const [error, setError] = useState<string | null>(null)

  // ── Load clients + already-linked project IDs ──────────────────────────────

  useEffect(() => {
    Promise.all([
      sanity.fetch<SanityClientDoc[]>(
        `*[_type == "client" && defined(tenantId) && !(_id in path("drafts.**"))] | order(displayName asc) {
          _id, displayName, tenantSlug, tenantId
        }`
      ),
      sanity.fetch<string[]>(
        `*[_type == "project" && defined(projectId) && !(_id in path("drafts.**")) && _id != $currentId].projectId`,
        { currentId: doc._id ?? '' }
      ),
    ])
      .then(([clientList, linkedIds]) => {
        setClients(clientList ?? [])
        setLinkedProjectIds(new Set(linkedIds ?? []))
      })
      .catch(() => setError('Failed to load clients'))
      .finally(() => setLoadingClients(false))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Load projects when tenant is known ────────────────────────────────────

  useEffect(() => {
    const tenantId = clientTenantId
    if (!tenantId) {
      setProjects([])
      return
    }
    setLoadingProjects(true)
    setError(null)
    fetch(`/api/sanity/projects?tenantId=${tenantId}`)
      .then((r) => r.json())
      .then((data) => setProjects(Array.isArray(data) ? data : []))
      .catch(() => setError('Failed to load projects'))
      .finally(() => setLoadingProjects(false))
  }, [clientTenantId])

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleClientSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const clientId = e.target.value
      setSelectedClientId(clientId)
      setSelectedProject(null)
      setError(null)
      const found = clients.find((c) => c._id === clientId)
      setClientTenantId(found?.tenantId ?? '')
    },
    [clients]
  )

  const handleProjectSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value
      const found = projects.find((p) => p.id === id) ?? null
      setSelectedProject(found)
      setError(null)
    },
    [projects]
  )

  const handleLink = useCallback(() => {
    if (!selectedProject || !selectedClientId) return
    const selectedClient = clients.find((c) => c._id === selectedClientId)

    onChange(
      PatchEvent.from([
        set({ _type: 'reference', _ref: selectedClientId }, ['clientRef']),
        set(selectedProject.id,                              ['projectId']),
        set(selectedProject.slug,                            ['projectSlug']),
        set(selectedProject.name,                            ['projectName']),
        set(selectedClient?.tenantId ?? clientTenantId,      ['tenantId']),
        ...(selectedProject.domain
          ? [set(selectedProject.domain, ['customDomain'])]
          : [unset(['customDomain'])]),
      ])
    )
  }, [selectedProject, selectedClientId, clients, clientTenantId, onChange])

  const handleRelink = useCallback(() => {
    setSelectedClientId('')
    setSelectedProject(null)
    setClientTenantId('')
    onChange(
      PatchEvent.from([
        unset(['clientRef']),
        unset(['projectId']),
        unset(['projectSlug']),
        unset(['projectName']),
        unset(['tenantId']),
        unset(['customDomain']),
      ])
    )
  }, [onChange])

  const handleAssignDS = useCallback(
    (ds: DSDoc) => {
      onChange(PatchEvent.from(set({ _type: 'reference', _ref: ds._id }, ['designSystemRef'])))
    },
    [onChange]
  )

  const handleRemoveDS = useCallback(() => {
    onChange(PatchEvent.from(unset(['designSystemRef'])))
  }, [onChange])

  // ── Sub-components ────────────────────────────────────────────────────────

  function InfoPanel({ project }: { project: SupabaseProject }) {
    return (
      <div style={{
        marginTop: 12,
        padding: 16,
        background: '#f8f8f8',
        borderRadius: 4,
        border: '1px solid #e0e0e0',
      }}>
        <div style={{
          fontWeight: 600,
          marginBottom: 12,
          fontSize: 11,
          color: '#666',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}>
          Project Information
        </div>

        {row('Name',       project.name)}
        {row('Slug',       project.slug)}
        {row('Domain',     project.domain)}
        {row('Created At', new Date(project.createdAt).toLocaleDateString())}

        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e0e0e0' }}>
          <div style={{ fontSize: 11, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Project ID
          </div>
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#555', wordBreak: 'break-all' }}>
            {project.id}
          </div>
        </div>
      </div>
    )
  }

  function Divider() {
    return (
      <div style={{
        margin: '24px 0',
        borderTop: '1px solid #e0e0e0',
      }} />
    )
  }

  // ── Loading ───────────────────────────────────────────────────────────────

  if (loadingClients) {
    return <div style={{ padding: '16px 0', color: '#666', fontSize: 13 }}>Loading…</div>
  }

  // ── Error ─────────────────────────────────────────────────────────────────

  const ErrorBanner = error ? (
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
  ) : null

  // ── Linked state ──────────────────────────────────────────────────────────

  if (doc.projectId) {
    const linkedClient = clients.find((c) => c._id === doc.clientRef?._ref)

    return (
      <div style={{ padding: '4px 0' }}>
        <div style={{ fontSize: 13, color: '#2e7d32', fontWeight: 500, marginBottom: 4 }}>
          ✓ Linked: {doc.projectName ?? doc.projectId}
        </div>
        {linkedClient && (
          <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
            Client: {linkedClient.displayName} ({linkedClient.tenantSlug})
          </div>
        )}

        <div style={{
          padding: 16,
          background: '#f8f8f8',
          borderRadius: 4,
          border: '1px solid #e0e0e0',
        }}>
          <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 11, color: '#666', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Project Information
          </div>
          {row('Name',   doc.projectName)}
          {row('Slug',   doc.projectSlug)}
          {row('Domain', doc.customDomain)}
          {doc.tenantId && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #e0e0e0' }}>
              <div style={{ fontSize: 11, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Project ID</div>
              <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#555', wordBreak: 'break-all' }}>{doc.projectId}</div>
            </div>
          )}
        </div>

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
          Relink Project
        </button>

        <Divider />

        {/* ── Design System ─────────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 12,
            color: '#666',
            fontWeight: 500,
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Design System
          </div>
          <DesignSystemPicker
            projectSlug={doc.projectSlug}
            currentDSRef={doc.designSystemRef?._ref}
            onAssign={handleAssignDS}
            onRemove={handleRemoveDS}
          />
        </div>

        <Divider />

        {/* ── Modules ───────────────────────────────────────────── */}
        {/* ADR-011 entry point: module management UI will replace this section in C2. */}
        {/* Phase B1: reads from moduleInstallations first; falls back to enabledModules. */}
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 12,
            color: '#666',
            fontWeight: 500,
            marginBottom: 8,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            Modules
          </div>
          {doc.moduleInstallations && doc.moduleInstallations.length > 0 ? (
            // Migrated project — read from moduleInstallations
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {doc.moduleInstallations.map((inst) => (
                <span
                  key={inst.moduleId}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 4,
                    background: inst.enabled === false ? '#f5f5f5' : '#f0f0f0',
                    color: inst.enabled === false ? '#aaa' : '#333',
                    border: `1px solid ${inst.enabled === false ? '#e8e8e8' : '#e0e0e0'}`,
                  }}
                >
                  {MODULE_REGISTRY.find((m) => m.id === inst.moduleId)?.label ?? inst.moduleId}
                  {inst.enabled === false && ' (disabled)'}
                </span>
              ))}
            </div>
          ) : doc.enabledModules && doc.enabledModules.length > 0 ? (
            // Unmigrated project — fall back to legacy enabledModules
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {doc.enabledModules.map((mod) => (
                <span
                  key={mod}
                  style={{
                    padding: '4px 12px',
                    fontSize: 12,
                    fontWeight: 500,
                    borderRadius: 4,
                    background: '#f0f0f0',
                    color: '#333',
                    border: '1px solid #e0e0e0',
                  }}
                >
                  {MODULE_REGISTRY.find((m) => m.id === mod)?.label ?? mod}
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: '#999' }}>
              No modules enabled
            </div>
          )}
        </div>

        <Divider />
        {renderDefault(props)}
      </div>
    )
  }

  // ── Unlinked state ────────────────────────────────────────────────────────

  return (
    <div style={{ padding: '4px 0' }}>
      {ErrorBanner}

      {/* Step 1 — Client */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 500 }}>
          Client
        </div>
        <select
          value={selectedClientId}
          onChange={handleClientSelect}
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
          <option value="">— Select a client —</option>
          {clients.map((c) => (
            <option key={c._id} value={c._id}>
              {c.displayName} ({c.tenantSlug})
            </option>
          ))}
        </select>
      </div>

      {/* Step 2 — Project */}
      {selectedClientId && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 6, fontWeight: 500 }}>
            Project
          </div>

          {loadingProjects ? (
            <div style={{ fontSize: 13, color: '#666' }}>Loading projects…</div>
          ) : projects.length === 0 ? (
            <div style={{ fontSize: 13, color: '#999' }}>No projects found for this client</div>
          ) : (
            <select
              value={selectedProject?.id ?? ''}
              onChange={handleProjectSelect}
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
              <option value="">— Select a project —</option>
              {projects.map((p) => {
                const isLinked = linkedProjectIds.has(p.id)
                return (
                  <option key={p.id} value={p.id}>
                    {isLinked ? '✓' : '○'} {p.name} ({p.slug})
                  </option>
                )
              })}
            </select>
          )}
        </div>
      )}

      {/* Info panel + Link button */}
      {selectedProject && (
        <>
          <InfoPanel project={selectedProject} />
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
            Link Project
          </button>
        </>
      )}
    </div>
  )
}
