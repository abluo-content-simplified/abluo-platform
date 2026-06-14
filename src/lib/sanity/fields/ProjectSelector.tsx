'use client'

import { useEffect, useState, useCallback } from 'react'
import { useFormValue, PatchEvent, set } from 'sanity'

interface Project {
  id: string
  slug: string
  name: string
}

export function ProjectSelector(props: any) {
  const { value, onChange } = props
  const tenantId = useFormValue(['tenantId']) as string
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch projects for the selected tenant
  useEffect(() => {
    if (!tenantId) {
      setProjects([])
      setLoading(false)
      return
    }

    const fetchProjects = async () => {
      try {
        setLoading(true)
        const response = await fetch(`/api/sanity/projects?tenantId=${tenantId}`)
        const data = await response.json()
        setProjects(Array.isArray(data) ? data : [])
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load projects')
        setProjects([])
      } finally {
        setLoading(false)
      }
    }

    fetchProjects()
  }, [tenantId])

  const handleProjectSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const selectedProjectId = e.target.value
      onChange(PatchEvent.from([set(selectedProjectId || null, [])]))
    },
    [onChange]
  )

  if (!tenantId) {
    return <div style={{ padding: '12px', color: '#999' }}>Select a tenant first</div>
  }

  if (loading) {
    return <div style={{ padding: '12px', color: '#666' }}>Loading projects...</div>
  }

  if (error) {
    return <div style={{ padding: '12px', color: '#d32f2f' }}>Error: {error}</div>
  }

  if (projects.length === 0) {
    return <div style={{ padding: '12px', color: '#666' }}>No projects found for this tenant</div>
  }

  return (
    <select
      value={value || ''}
      onChange={handleProjectSelect}
      style={{
        width: '100%',
        padding: '8px 12px',
        fontSize: '14px',
        border: '1px solid #ccc',
        borderRadius: '4px',
      }}
    >
      <option value="">— Select a Project —</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name} ({project.slug})
        </option>
      ))}
    </select>
  )
}
