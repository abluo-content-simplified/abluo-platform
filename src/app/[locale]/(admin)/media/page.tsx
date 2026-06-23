'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@sanity/client'
import { Search, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { UploadDialog } from '@/components/media/UploadDialog'
import { EditSheet } from '@/components/media/EditSheet'
import { LOCALE_CODES } from '@/lib/i18n/locales'

interface Tenant {
  _id: string
  displayName: string
  tenantSlug: string
}

interface Project {
  _id: string
  projectName: string
  projectSlug: string
  supportedLocales?: string[]
}

interface ClientWithProject {
  _id: string
  displayName: string
  tenantSlug: string
  supportedLocales?: string[]
}

interface MediaAsset {
  _id: string
  _createdAt: string
  name?: string
  altText: Record<string, string> | string
  description?: Record<string, string> | string
  tags: string[]
  uploadedBy?: string
  uploadedByName?: string
  tenant: Tenant
  project?: Project
  projectSlug?: string
  image: {
    asset: {
      _id: string
      url: string
      metadata?: {
        dimensions?: { width: number; height: number }
        size?: number
      }
      originalFilename: string
    }
  }
}

interface MediaResponse {
  success: boolean
  data: MediaAsset[]
  pagination: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

const sanityClient = createClient({
  projectId: process.env.NEXT_PUBLIC_SANITY_PROJECT_ID || '3n7t84j3',
  dataset: process.env.NEXT_PUBLIC_SANITY_DATASET || 'production',
  apiVersion: '2026-05-21',
  useCdn: false,
})

export default function MediaPage() {
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Filters & pagination
  const [selectedTenant, setSelectedTenant] = useState<string>('')
  const [selectedProject, setSelectedProject] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [allTags, setAllTags] = useState<string[]>([])
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkTagToAdd, setBulkTagToAdd] = useState('')
  const [bulkTagToRemove, setBulkTagToRemove] = useState('')
  const [bulkMoveProject, setBulkMoveProject] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  // Default to all platform locales; narrows to tenant's supportedLocales once a tenant is selected.
  const [languages, setLanguages] = useState<string[]>(LOCALE_CODES)

  const limit = 20
  const offset = currentPage * limit

  // Fetch tenants on mount
  useEffect(() => {
    const fetchTenants = async () => {
      try {
        const data = await sanityClient.fetch<Tenant[]>(
          `*[_type == "client" && !(_id in path("drafts.**"))] | order(displayName asc) {
            _id, displayName, tenantSlug
          }`
        )
        setTenants(data)
      } catch (err) {
        console.error('Failed to fetch tenants:', err)
      }
    }
    fetchTenants()
  }, [])

  // Fetch projects when tenant changes
  useEffect(() => {
    if (!selectedTenant) {
      setProjects([])
      setLanguages(LOCALE_CODES) // Reset to all platform locales when no tenant selected
      return
    }

    const fetchProjects = async () => {
      try {
        const data = await sanityClient.fetch<Project[]>(
          `*[_type == "project" && clientRef._ref == $tenantId && !(_id in path("drafts.**"))] | order(projectName asc) {
            _id, projectName, projectSlug,
            "supportedLocales": siteConfig->supportedLocales
          }`,
          { tenantId: selectedTenant }
        )
        setProjects(data)
        // Narrow to this tenant's enabled locales; fall back to all platform locales.
        const tenantLocales = data[0]?.supportedLocales
        setLanguages(tenantLocales && tenantLocales.length > 0 ? tenantLocales : LOCALE_CODES)
      } catch (err) {
        console.error('Failed to fetch projects:', err)
      }
    }
    fetchProjects()
  }, [selectedTenant])

  // Fetch all tags when filters change
  useEffect(() => {
    const fetchTags = async () => {
      try {
        const params = new URLSearchParams({
          ...(selectedTenant && { tenant: selectedTenant }),
          ...(selectedProject && { project: selectedProject }),
        })
        const response = await fetch(`/api/media/tags?${params}`)
        const data = await response.json()
        if (data.success) {
          setAllTags(data.data)
        }
      } catch (err) {
        console.error('Failed to fetch tags:', err)
      }
    }
    fetchTags()
  }, [selectedTenant, selectedProject])

  // Fetch media assets
  useEffect(() => {
    const fetchAssets = async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          limit: limit.toString(),
          offset: offset.toString(),
          ...(selectedTenant && { tenant: selectedTenant }),
          ...(selectedProject && { project: selectedProject }),
          ...(searchQuery && { search: searchQuery }),
          ...(selectedTags.length > 0 && { tags: selectedTags.join(',') }),
        })

        const response = await fetch(`/api/media?${params}`)
        const data = (await response.json()) as MediaResponse

        if (data.success) {
          setAssets(data.data)
          setTotalCount(data.pagination.total)
        } else {
          setError('Failed to load media')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load media')
      } finally {
        setLoading(false)
      }
    }

    fetchAssets()
  }, [selectedTenant, selectedProject, searchQuery, selectedTags, currentPage, refreshKey])

  const totalPages = Math.ceil(totalCount / limit)

  // Selection handlers
  const toggleSelectId = (id: string) => {
    const newSelected = new Set(selectedIds)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedIds(newSelected)
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === assets.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(assets.map((a) => a._id)))
    }
  }

  // Bulk action handlers
  const handleBulkAddTag = async () => {
    if (!bulkTagToAdd.trim() || selectedIds.size === 0) return
    setBulkLoading(true)
    try {
      for (const id of selectedIds) {
        const asset = assets.find((a) => a._id === id)
        if (asset) {
          const newTags = [...(asset.tags || []), bulkTagToAdd.toLowerCase().trim()]
          await fetch(`/api/media/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: newTags }),
          })
        }
      }
      setBulkTagToAdd('')
      setSelectedIds(new Set())
      setRefreshKey((prev) => prev + 1)
    } finally {
      setBulkLoading(false)
    }
  }

  const handleBulkRemoveTag = async () => {
    if (!bulkTagToRemove.trim() || selectedIds.size === 0) return
    setBulkLoading(true)
    try {
      for (const id of selectedIds) {
        const asset = assets.find((a) => a._id === id)
        if (asset) {
          const newTags = (asset.tags || []).filter((t) => t !== bulkTagToRemove.toLowerCase().trim())
          await fetch(`/api/media/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: newTags }),
          })
        }
      }
      setBulkTagToRemove('')
      setSelectedIds(new Set())
      setRefreshKey((prev) => prev + 1)
    } finally {
      setBulkLoading(false)
    }
  }

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0 || !window.confirm(`Delete ${selectedIds.size} asset(s)?`)) return
    setBulkLoading(true)
    try {
      for (const id of selectedIds) {
        await fetch(`/api/media/${id}`, { method: 'DELETE' })
      }
      setSelectedIds(new Set())
      setRefreshKey((prev) => prev + 1)
    } finally {
      setBulkLoading(false)
    }
  }

  return (
    <div className="px-10 py-10 max-w-7xl">
      {/* Header */}
      <div className="mb-10 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-900 tracking-tight">Media Library</h1>
          <p className="text-sm text-zinc-400 mt-1">Manage images and media assets across all projects.</p>
        </div>
        <button
          onClick={() => setShowUploadDialog(true)}
          className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white rounded text-sm font-medium hover:bg-zinc-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Upload
        </button>
      </div>

      {/* Filters */}
      <div className="mb-8 space-y-4 bg-white rounded-lg border border-zinc-200 p-6">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search by filename..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setCurrentPage(0)
            }}
            className="w-full pl-9 pr-4 py-2 text-sm border border-zinc-200 rounded bg-white placeholder-zinc-400 focus:outline-none focus:border-zinc-400"
          />
        </div>

        {/* Filter dropdowns */}
        <div className="grid grid-cols-3 gap-4">
          {/* Tenant filter */}
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1">Tenant</label>
            <select
              value={selectedTenant}
              onChange={(e) => {
                setSelectedTenant(e.target.value)
                setSelectedProject('')
                setCurrentPage(0)
              }}
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400"
            >
              <option value="">All Tenants</option>
              {tenants.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.displayName}
                </option>
              ))}
            </select>
          </div>

          {/* Project filter */}
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1">Project</label>
            <select
              value={selectedProject}
              onChange={(e) => {
                setSelectedProject(e.target.value)
                setCurrentPage(0)
              }}
              disabled={!selectedTenant}
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400 disabled:bg-zinc-50 disabled:text-zinc-400"
            >
              <option value="">All Projects</option>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.projectName}
                </option>
              ))}
            </select>
          </div>

          {/* Tags filter */}
          <div>
            <label className="text-xs font-medium text-zinc-600 block mb-1">Tags</label>
            <select
              multiple
              value={selectedTags}
              onChange={(e) => {
                const selected = Array.from(e.target.selectedOptions, (option) => option.value)
                setSelectedTags(selected)
                setCurrentPage(0)
              }}
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400"
              size={1}
            >
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mb-6">
          {error}
        </div>
      )}

      {/* Empty state */}
      {!loading && assets.length === 0 && (
        <div className="rounded border border-zinc-200 bg-white px-6 py-12 text-center">
          <p className="text-sm text-zinc-400">No media assets found.</p>
        </div>
      )}

      {/* Media table */}
      {assets.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white overflow-hidden mb-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600 w-12">
                    <input
                      type="checkbox"
                      checked={selectedIds.size > 0 && selectedIds.size === assets.length}
                      onChange={toggleSelectAll}
                      className="rounded border-zinc-300"
                    />
                  </th>
                  <th className="px-6 py-3 text-left font-medium text-zinc-600">Image</th>
                  <th className="px-6 py-3 text-left font-medium text-zinc-600">Filename</th>
                  <th className="px-6 py-3 text-left font-medium text-zinc-600">Tenant</th>
                  <th className="px-6 py-3 text-left font-medium text-zinc-600">Project</th>
                  <th className="px-6 py-3 text-left font-medium text-zinc-600">Alt Text</th>
                  <th className="px-6 py-3 text-left font-medium text-zinc-600">Dimensions</th>
                  <th className="px-6 py-3 text-left font-medium text-zinc-600">Size</th>
                  <th className="px-6 py-3 text-left font-medium text-zinc-600">Uploaded</th>
                  <th className="px-6 py-3 text-left font-medium text-zinc-600">Tags</th>
                  <th className="px-4 py-3 text-center font-medium text-zinc-600 w-12">⋮</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200">
                {assets.map((asset) => (
                  <tr
                    key={asset._id}
                    className={`hover:bg-zinc-50 transition-colors cursor-pointer ${selectedIds.has(asset._id) ? 'bg-blue-50' : ''}`}
                    onClick={() => setSelectedAsset(asset)}>
                    {/* Checkbox */}
                    <td className="px-4 py-4" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(asset._id)}
                        onChange={() => toggleSelectId(asset._id)}
                        className="rounded border-zinc-300"
                      />
                    </td>

                    {/* Thumbnail */}
                    <td className="px-6 py-4 relative"
                      onMouseEnter={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setHoveredAssetId(asset._id)
                        setHoverPos({ x: rect.left + rect.width, y: rect.top })
                      }}
                      onMouseLeave={() => setHoveredAssetId(null)}
                    >
                      <img
                        src={`${asset.image.asset.url}?w=80&h=80&fit=crop`}
                        alt={typeof asset.altText === 'string' ? asset.altText : ''}
                        className="h-12 w-12 rounded object-cover"
                      />
                    </td>

                    {/* Filename */}
                    <td className="px-6 py-4 text-xs text-zinc-900 font-mono">
                      {asset.image.asset.originalFilename}
                    </td>

                    {/* Tenant */}
                    <td className="px-6 py-4 text-xs text-zinc-600">
                      {asset.tenant?.displayName}
                    </td>

                    {/* Project */}
                    <td className="px-6 py-4 text-xs text-zinc-600">
                      {asset.project?.projectName || '—'}
                    </td>

                    {/* Alt Text */}
                    <td className="px-6 py-4 text-xs text-zinc-600 max-w-xs truncate">
                      {typeof asset.altText === 'string' ? asset.altText : Object.values(asset.altText || {})[0] || '—'}
                    </td>

                    {/* Dimensions */}
                    <td className="px-6 py-4 text-xs text-zinc-600">
                      {asset.image.asset.metadata?.dimensions
                        ? `${asset.image.asset.metadata.dimensions.width} × ${asset.image.asset.metadata.dimensions.height}`
                        : '—'}
                    </td>

                    {/* Size */}
                    <td className="px-6 py-4 text-xs text-zinc-600">
                      {asset.image.asset.metadata?.size
                        ? `${(asset.image.asset.metadata.size / 1024 / 1024).toFixed(1)}MB`
                        : '—'}
                    </td>

                    {/* Uploaded */}
                    <td className="px-6 py-4 text-xs text-zinc-600">
                      {new Date(asset._createdAt).toLocaleDateString()}
                    </td>

                    {/* Tags */}
                    <td className="px-6 py-4">
                      <div className="flex flex-wrap gap-1">
                        {asset.tags && asset.tags.length > 0 ? (
                          asset.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="inline-block px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded text-[10px] font-medium"
                            >
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                        {asset.tags && asset.tags.length > 2 && (
                          <span className="inline-block px-2 py-0.5 text-zinc-400 text-[10px]">
                            +{asset.tags.length - 2}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Row menu - use fixed positioning to avoid clipping */}
                    <td className="px-4 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="group">
                        <button className="text-zinc-400 hover:text-zinc-600 transition-colors text-lg">⋮</button>
                        <div className="hidden group-hover:block fixed bg-white border border-zinc-200 rounded shadow-xl z-50 w-40">
                          <button
                            onClick={() => setSelectedAsset(asset)}
                            className="block w-full text-left px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50 border-b border-zinc-100"
                          >
                            Edit
                          </button>
                          <button
                            onClick={async () => {
                              if (asset.name || asset.altText || asset.tags) {
                                setSelectedAsset({ ...asset, name: `${asset.name || 'Copy'} (copy)` })
                              }
                            }}
                            className="block w-full text-left px-4 py-3 text-sm text-zinc-700 hover:bg-zinc-50 border-b border-zinc-100"
                          >
                            Duplicate
                          </button>
                          <button
                            onClick={async () => {
                              if (window.confirm('Delete this asset?')) {
                                await fetch(`/api/media/${asset._id}`, { method: 'DELETE' })
                                setRefreshKey((prev) => prev + 1)
                              }
                            }}
                            className="block w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-xs text-zinc-500">
            Showing {offset + 1}–{Math.min(offset + limit, totalCount)} of {totalCount} assets
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
              disabled={currentPage === 0}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs border border-zinc-200 text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 disabled:text-zinc-300 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-3 w-3" />
              Previous
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i)}
                  className={`px-2 py-1.5 rounded text-xs transition-colors ${
                    i === currentPage
                      ? 'bg-zinc-900 text-white'
                      : 'border border-zinc-200 text-zinc-600 hover:border-zinc-400'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
            <button
              onClick={() => setCurrentPage(Math.min(totalPages - 1, currentPage + 1))}
              disabled={currentPage === totalPages - 1}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs border border-zinc-200 text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 disabled:text-zinc-300 disabled:cursor-not-allowed transition-colors"
            >
              Next
              <ChevronRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {loading && <div className="text-center py-10 text-sm text-zinc-400">Loading...</div>}

      {/* Upload Dialog */}
      {showUploadDialog && (
        <UploadDialog
          tenants={tenants}
          projects={projects}
          allTags={allTags}
          selectedTenant={selectedTenant}
          selectedProject={selectedProject}
          onTenantChange={setSelectedTenant}
          onProjectChange={setSelectedProject}
          onClose={() => setShowUploadDialog(false)}
          onUploadComplete={() => {
            setRefreshKey((prev) => prev + 1)
            setCurrentPage(0)
          }}
        />
      )}

      {/* Edit Sheet */}
      {selectedAsset && (
        <EditSheet
          asset={selectedAsset}
          allTags={allTags}
          languages={languages}
          onClose={() => setSelectedAsset(null)}
          onSave={(updatedAsset) => {
            // Immediately patch the asset in the list so reopening it
            // shows the saved data without waiting for the async re-fetch.
            setAssets((prev) => prev.map((a) => a._id === updatedAsset._id ? updatedAsset : a))
            // Also trigger a background list refresh for consistency.
            setRefreshKey((prev) => prev + 1)
          }}
          onDelete={() => {
            setRefreshKey((prev) => prev + 1)
            setCurrentPage(0)
          }}
        />
      )}

      {/* Hover preview */}
      {hoveredAssetId && (
        <div
          className="fixed z-40 bg-white rounded-lg shadow-xl border border-zinc-200 p-3"
          style={{
            left: `${hoverPos.x + 10}px`,
            top: `${hoverPos.y - 200}px`,
            maxWidth: '350px',
          }}
          onMouseEnter={() => {}}
          onMouseLeave={() => setHoveredAssetId(null)}
        >
          {(() => {
            const hoveredAsset = assets.find((a) => a._id === hoveredAssetId)
            if (!hoveredAsset) return null
            return (
              <div className="space-y-2">
                <img
                  src={`${hoveredAsset.image.asset.url}?w=400`}
                  alt={typeof hoveredAsset.altText === 'string' ? hoveredAsset.altText : ''}
                  className="w-full rounded object-cover max-h-72"
                />
                <div className="text-xs space-y-1">
                  <p className="font-medium text-zinc-900 truncate">
                    {hoveredAsset.name || hoveredAsset.image.asset.originalFilename}
                  </p>
                  <p className="text-zinc-600 truncate">{typeof hoveredAsset.altText === 'string' ? hoveredAsset.altText : ''}</p>
                  {hoveredAsset.tags && hoveredAsset.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {hoveredAsset.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-zinc-100 text-zinc-600 rounded text-[10px]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50 bg-white rounded-full shadow-lg border border-zinc-200 px-6 py-4">
          <div className="flex items-center gap-6">
            <span className="text-sm font-medium text-zinc-900">
              {selectedIds.size} asset{selectedIds.size !== 1 ? 's' : ''} selected
            </span>

            {/* Add tag */}
            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={bulkTagToAdd}
                onChange={(e) => setBulkTagToAdd(e.target.value)}
                placeholder="Add tag..."
                list="bulk-tag-suggestions"
                className="px-3 py-1 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400 w-32"
              />
              <datalist id="bulk-tag-suggestions">
                {allTags.map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
              <button
                onClick={handleBulkAddTag}
                disabled={bulkLoading || !bulkTagToAdd.trim()}
                className="px-3 py-1 text-sm bg-zinc-900 text-white rounded hover:bg-zinc-800 disabled:bg-zinc-400 transition-colors"
              >
                Add
              </button>
            </div>

            {/* Remove tag */}
            <div className="flex gap-2 items-center">
              <select
                value={bulkTagToRemove}
                onChange={(e) => setBulkTagToRemove(e.target.value)}
                className="px-3 py-1 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400 w-32"
              >
                <option value="">Remove tag...</option>
                {allTags.map((tag) => (
                  <option key={tag} value={tag}>
                    {tag}
                  </option>
                ))}
              </select>
              <button
                onClick={handleBulkRemoveTag}
                disabled={bulkLoading || !bulkTagToRemove.trim()}
                className="px-3 py-1 text-sm bg-zinc-900 text-white rounded hover:bg-zinc-800 disabled:bg-zinc-400 transition-colors"
              >
                Remove
              </button>
            </div>

            {/* Delete */}
            <button
              onClick={handleBulkDelete}
              disabled={bulkLoading}
              className="px-3 py-1 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              Delete
            </button>

            {/* Cancel */}
            <button
              onClick={() => {
                setSelectedIds(new Set())
                setBulkTagToAdd('')
                setBulkTagToRemove('')
              }}
              disabled={bulkLoading}
              className="px-3 py-1 text-sm text-zinc-600 border border-zinc-200 rounded hover:bg-zinc-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
