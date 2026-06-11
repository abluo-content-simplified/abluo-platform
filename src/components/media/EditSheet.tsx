'use client'

import { useState, useEffect } from 'react'
import { X, Trash2 } from 'lucide-react'
import { LocalizedTextField } from '@/components/form/LocalizedTextField'
import { LocalizedTextareaField } from '@/components/form/LocalizedTextareaField'

interface MediaAsset {
  _id: string
  _createdAt: string
  name?: string
  altText: Record<string, string> | string
  description?: Record<string, string> | string
  tags: string[]
  uploadedBy?: string
  uploadedByName?: string
  tenant: { _id: string; displayName: string; tenantSlug: string }
  project?: { _id: string; projectName: string; projectSlug: string }
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

interface EditSheetProps {
  asset: MediaAsset
  allTags: string[]
  languages: string[]
  onClose: () => void
  onSave: () => void
  onDelete: () => void
}

export function EditSheet({
  asset,
  allTags,
  languages,
  onClose,
  onSave,
  onDelete,
}: EditSheetProps) {
  const [name, setName] = useState(asset.name || '')
  const [altText, setAltText] = useState<Record<string, string>>(
    typeof asset.altText === 'string' ? { en: asset.altText } : asset.altText || {}
  )
  const [description, setDescription] = useState<Record<string, string>>(
    typeof asset.description === 'string' ? { en: asset.description } : asset.description || {}
  )
  const [tags, setTags] = useState<string[]>(asset.tags || [])
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [hasChanges, setHasChanges] = useState(false)

  // Track changes
  useEffect(() => {
    const originalAltText = typeof asset.altText === 'string' ? { en: asset.altText } : asset.altText || {}
    const originalDescription = typeof asset.description === 'string' ? { en: asset.description } : asset.description || {}

    const changed =
      name !== (asset.name || '') ||
      JSON.stringify(altText) !== JSON.stringify(originalAltText) ||
      JSON.stringify(description) !== JSON.stringify(originalDescription) ||
      JSON.stringify(tags) !== JSON.stringify(asset.tags || [])
    setHasChanges(changed)
  }, [name, altText, description, tags, asset])

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

  const handleSave = async () => {
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/media/${asset._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          altText,
          description,
          tags,
        }),
      })

      const data = await response.json()

      if (!data.success) {
        console.error('API Error Response:', {
          status: response.status,
          error: data.error,
          details: data.details,
        })
        setError(`${data.error}${data.details ? ' — ' + JSON.stringify(data.details).substring(0, 100) : ''}`)
      } else {
        onSave()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setError(null)

    try {
      const response = await fetch(`/api/media/${asset._id}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!data.success) {
        setError(data.error || 'Delete failed')
      } else {
        onDelete()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setDeleting(false)
    }
  }

  const handleClose = () => {
    if (hasChanges) {
      if (window.confirm('You have unsaved changes. Discard them?')) {
        onClose()
      }
    } else {
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose()
        }
      }}
    >
      <div className="bg-white w-full max-w-lg h-screen max-h-screen flex flex-col shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 flex-shrink-0">
          <h2 className="text-lg font-semibold text-zinc-900">Edit Media</h2>
          <button
            onClick={handleClose}
            className="text-zinc-400 hover:text-zinc-600 transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Image preview */}
          <div>
            <img
              src={`${asset.image.asset.url}?w=400`}
              alt={typeof asset.altText === 'string' ? asset.altText : Object.values(asset.altText || {})[0] || ''}
              className="w-full rounded-lg object-cover max-h-64"
            />
            <p className="text-xs text-zinc-500 mt-2">{asset.image.asset.originalFilename}</p>
          </div>

          {/* Metadata */}
          <div className="space-y-3 text-sm bg-zinc-50 rounded-lg p-4">
            <div>
              <p className="font-medium text-zinc-700">Tenant</p>
              <p className="text-zinc-600">{asset.tenant.displayName}</p>
            </div>
            {asset.project && (
              <div>
                <p className="font-medium text-zinc-700">Project</p>
                <p className="text-zinc-600">{asset.project.projectName}</p>
              </div>
            )}
            {asset.image.asset.metadata?.dimensions && (
              <div>
                <p className="font-medium text-zinc-700">Dimensions</p>
                <p className="text-zinc-600">
                  {asset.image.asset.metadata.dimensions.width} × {asset.image.asset.metadata.dimensions.height}px
                </p>
              </div>
            )}
            {asset.image.asset.metadata?.size && (
              <div>
                <p className="font-medium text-zinc-700">Size</p>
                <p className="text-zinc-600">{(asset.image.asset.metadata.size / 1024 / 1024).toFixed(1)}MB</p>
              </div>
            )}
            <div>
              <p className="font-medium text-zinc-700">Uploaded</p>
              <p className="text-zinc-600">{new Date(asset._createdAt).toLocaleString()}</p>
            </div>
            {asset.uploadedByName && (
              <div>
                <p className="font-medium text-zinc-700">Uploaded By</p>
                <p className="text-zinc-600">{asset.uploadedByName}</p>
              </div>
            )}
          </div>

          {/* Editable fields */}
          <div className="border-t border-zinc-200 pt-6 space-y-5">
            {/* Name */}
            <div>
              <label className="text-sm font-medium text-zinc-700 block mb-2">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Hero Image, Team Photo"
                className="w-full px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400"
              />
            </div>

            {/* Alt Text - Localized */}
            <LocalizedTextField
              value={altText}
              onChange={setAltText}
              languages={languages}
              label="Alt Text"
              placeholder="Describe the image for accessibility"
              required
            />

            {/* Description - Localized */}
            <LocalizedTextareaField
              value={description}
              onChange={setDescription}
              languages={languages}
              label="Description"
              placeholder="Optional details about this image"
              rows={3}
            />

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
                  list="tag-suggestions-edit"
                  className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded bg-white focus:outline-none focus:border-zinc-400"
                />
                <datalist id="tag-suggestions-edit">
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
              {tags && tags.length > 0 && (
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
          </div>
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-200 p-6 flex-shrink-0 space-y-3">
          {deleteConfirm ? (
            <>
              <p className="text-sm text-zinc-700 font-medium">Delete this asset?</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setDeleteConfirm(false)}
                  disabled={deleting}
                  className="flex-1 px-4 py-2 text-sm border border-zinc-200 text-zinc-700 rounded hover:bg-zinc-50 transition-colors disabled:text-zinc-400 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex-1 px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:bg-red-400 disabled:cursor-not-allowed"
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex gap-3">
                <button
                  onClick={handleClose}
                  disabled={saving}
                  className="flex-1 px-4 py-2 text-sm border border-zinc-200 text-zinc-700 rounded hover:bg-zinc-50 transition-colors disabled:text-zinc-400 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                  className="flex-1 px-4 py-2 text-sm bg-zinc-900 text-white rounded hover:bg-zinc-800 transition-colors disabled:bg-zinc-400 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
              <button
                onClick={() => setDeleteConfirm(true)}
                className="w-full px-4 py-2 text-sm text-red-600 border border-red-200 rounded hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
              >
                <Trash2 className="h-4 w-4" />
                Delete Asset
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
