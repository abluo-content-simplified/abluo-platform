'use client'

import { useState } from 'react'
import { X, Upload } from 'lucide-react'

interface UploadDialogProps {
  tenants: Array<{ _id: string; displayName: string; tenantSlug: string }>
  projects: Array<{ _id: string; projectName: string; projectSlug: string }>
  allTags: string[]
  selectedTenant: string
  selectedProject: string
  onTenantChange: (tenantId: string) => void
  onProjectChange: (projectId: string) => void
  onClose: () => void
  onUploadComplete: () => void
}

export function UploadDialog({
  tenants,
  projects,
  allTags,
  selectedTenant,
  selectedProject,
  onTenantChange,
  onProjectChange,
  onClose,
  onUploadComplete,
}: UploadDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [altText, setAltText] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragActive, setDragActive] = useState(false)

  const fileSizeMB = file ? file.size / 1024 / 1024 : 0
  const isLargeFile = fileSizeMB > 10

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    const files = e.dataTransfer.files
    if (files && files[0]) {
      setFile(files[0])
      setError(null)
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0])
      setError(null)
    }
  }

  const addTag = (tag: string) => {
    const normalized = tag.toLowerCase().trim()
    if (normalized && !tags.includes(normalized)) {
      setTags([...tags, normalized])
      setTagInput('')
    }
  }

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag))
  }

  const handleUpload = async () => {
    if (!file || !altText || !selectedTenant) {
      setError('File, alt text, and tenant are required')
      return
    }

    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('tenant', selectedTenant)
      if (selectedProject) formData.append('project', selectedProject)
      if (name) formData.append('name', name)
      formData.append('altText', altText)
      if (description) formData.append('description', description)
      formData.append('tags', JSON.stringify(tags))

      const response = await fetch('/api/media/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!data.success) {
        setError(data.error || 'Upload failed')
      } else {
        onUploadComplete()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200">
          <h2 className="text-lg font-semibold text-zinc-900">Upload Media</h2>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* File upload */}
          <div>
            <label className="text-sm font-medium text-zinc-700 block mb-2">Image</label>
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                dragActive
                  ? 'border-zinc-400 bg-zinc-50'
                  : 'border-zinc-300 hover:border-zinc-400'
              }`}
            >
              {file ? (
                <div>
                  <p className="text-sm font-medium text-zinc-900">{file.name}</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    {(file.size / 1024 / 1024).toFixed(1)}MB
                  </p>
                  <button
                    onClick={() => setFile(null)}
                    className="text-xs text-blue-600 hover:text-blue-700 mt-2"
                  >
                    Change file
                  </button>
                </div>
              ) : (
                <div>
                  <Upload className="h-8 w-8 text-zinc-400 mx-auto mb-2" />
                  <p className="text-sm text-zinc-700">
                    Drag and drop or{' '}
                    <label className="text-blue-600 hover:text-blue-700 cursor-pointer">
                      browse
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileInput}
                        className="hidden"
                      />
                    </label>
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">Max 4000px / 10MB recommended</p>
                </div>
              )}
            </div>
            {isLargeFile && (
              <p className="text-xs text-amber-600 mt-2">⚠ File is larger than 10MB</p>
            )}
          </div>

          {/* Tenant */}
          <div>
            <label className="text-sm font-medium text-zinc-700 block mb-2">Tenant *</label>
            <select
              value={selectedTenant}
              onChange={(e) => {
                onTenantChange(e.target.value)
                onProjectChange('')
              }}
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400"
            >
              <option value="">Select a tenant</option>
              {tenants.map((t) => (
                <option key={t._id} value={t._id}>
                  {t.displayName}
                </option>
              ))}
            </select>
          </div>

          {/* Project */}
          <div>
            <label className="text-sm font-medium text-zinc-700 block mb-2">Project</label>
            <select
              value={selectedProject}
              onChange={(e) => onProjectChange(e.target.value)}
              disabled={!selectedTenant}
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400 disabled:bg-zinc-50 disabled:text-zinc-400"
            >
              <option value="">Select a project (optional)</option>
              {projects.map((p) => (
                <option key={p._id} value={p._id}>
                  {p.projectName}
                </option>
              ))}
            </select>
          </div>

          {/* Name */}
          <div>
            <label className="text-sm font-medium text-zinc-700 block mb-2">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hero Image, Team Photo (optional)"
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400"
            />
          </div>

          {/* Alt text */}
          <div>
            <label className="text-sm font-medium text-zinc-700 block mb-2">Alt Text *</label>
            <input
              type="text"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              placeholder="Describe the image for accessibility"
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400"
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-zinc-700 block mb-2">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional details about this image"
              rows={2}
              className="w-full px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400 resize-none"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-sm font-medium text-zinc-700 block mb-2">Tags</label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTag(tagInput)
                  }
                }}
                placeholder="Add a tag..."
                list="tag-suggestions"
                className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400"
              />
              <datalist id="tag-suggestions">
                {allTags.map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
              <button
                onClick={() => addTag(tagInput)}
                className="px-3 py-2 text-sm bg-zinc-900 text-white rounded hover:bg-zinc-800 transition-colors"
              >
                Add
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-100 text-zinc-700 rounded text-xs"
                  >
                    {tag}
                    <button
                      onClick={() => removeTag(tag)}
                      className="text-zinc-400 hover:text-zinc-600"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onClose}
              disabled={uploading}
              className="flex-1 px-4 py-2 text-sm border border-zinc-200 text-zinc-700 rounded hover:bg-zinc-50 transition-colors disabled:text-zinc-400 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleUpload}
              disabled={uploading || !file || !altText || !selectedTenant}
              className="flex-1 px-4 py-2 text-sm bg-zinc-900 text-white rounded hover:bg-zinc-800 transition-colors disabled:bg-zinc-400 disabled:cursor-not-allowed"
            >
              {uploading ? 'Uploading...' : 'Upload'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
