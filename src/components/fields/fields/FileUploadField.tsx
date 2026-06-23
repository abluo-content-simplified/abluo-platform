'use client'

/**
 * FileUploadField — Form Field Library
 *
 * Renders a drag-and-drop upload zone with a file list.
 *
 * STORAGE INTEGRATION NOT IMPLEMENTED IN THIS PHASE.
 * The component handles file selection and provides `onFilesSelected` for
 * future integration with Supabase Storage, Sanity Assets, or any other provider.
 * Wire actual upload logic in a later phase by consuming `onFilesSelected`.
 *
 * LOCALIZATION: all user-facing text comes from the `messages` prop.
 * Use `getFileUploadMessages(locale)` from `@/lib/forms/validation-messages` to
 * build a localized messages object before rendering this component.
 * Defaults to English via `defaultFileUploadMessages` if the prop is omitted.
 */

import { useRef, useState, useCallback, DragEvent } from 'react'
import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { FileFieldConfig } from '../types'
import {
  defaultFileUploadMessages,
  type FileUploadMessages,
} from '@/lib/forms/validation-messages'

interface Props {
  config: FileFieldConfig
  value: File[]
  onChange: (files: File[]) => void
  /** Called when files are selected — STORAGE INTEGRATION POINT (future phase) */
  onFilesSelected?: (files: File[]) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
  /**
   * Localized UI strings for the upload zone.
   * Defaults to English via `defaultFileUploadMessages`.
   * Use `getFileUploadMessages(locale)` to get localized strings.
   */
  messages?: FileUploadMessages
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function FileUploadField({
  config,
  value = [],
  onChange,
  onFilesSelected,
  onBlur,
  error: externalError,
  disabled,
  messages = defaultFileUploadMessages,
}: Props) {
  const { error: internalError, handleBlur } = useFieldValidation(config, value)
  const error = externalError ?? internalError
  const isDisabled = disabled ?? config.disabled
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  const accept = config.acceptedTypes?.join(',')

  const handleFiles = useCallback((incoming: FileList | File[]) => {
    const incomingArr = Array.from(incoming)
    const next = config.multiple ? [...value, ...incomingArr] : incomingArr
    onChange(next)
    onFilesSelected?.(next) // STORAGE INTEGRATION POINT
    handleBlur()
    onBlur?.()
  }, [value, onChange, onFilesSelected, config.multiple, handleBlur, onBlur])

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragging(false)
    if (isDisabled) return
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files)
  }

  const removeFile = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  return (
    <FieldWrapper
      id={config.id}
      label={config.label}
      helpText={config.helpText}
      required={config.required}
      error={error}
      width={config.width}
    >
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        aria-label={messages.uploadAreaLabel}
        onClick={() => !isDisabled && inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
        onDragOver={(e) => { e.preventDefault(); if (!isDisabled) setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          padding: '24px var(--form-padding-x)',
          background: isDragging ? 'color-mix(in oklch, var(--color-primary) 8%, var(--form-input-bg))' : 'var(--form-input-bg)',
          border: `1.5px dashed ${error ? 'var(--form-input-error-border)' : isDragging ? 'var(--color-primary)' : 'var(--form-input-border)'}`,
          borderRadius: 'var(--form-border-radius)',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.5 : 1,
          transition: 'background var(--motion-duration-fast), border-color var(--motion-duration-fast)',
          outline: 'none',
        }}
      >
        {/* Upload icon */}
        <svg
          width="24" height="24" viewBox="0 0 24 24" fill="none"
          style={{ color: 'var(--form-input-placeholder)', flexShrink: 0 }}
        >
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <polyline points="17 8 12 3 7 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <line x1="12" y1="3" x2="12" y2="15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>

        <p style={{ margin: 0, color: 'var(--form-input-text)', fontSize: 'inherit', textAlign: 'center' }}>
          <span style={{ color: 'var(--color-primary)', fontWeight: 500 }}>{messages.clickToUploadLabel}</span>
          {' '}{messages.dragDropLabel}
        </p>

        {(config.acceptedTypes || config.maxSizeMb) && (
          <p style={{ margin: 0, color: 'var(--form-help-color)', fontSize: 'var(--form-help-size)', textAlign: 'center' }}>
            {config.acceptedTypes?.join(', ')}
            {config.acceptedTypes && config.maxSizeMb ? ' · ' : ''}
            {config.maxSizeMb ? messages.maxSizeLabel(config.maxSizeMb) : ''}
          </p>
        )}

        <input
          ref={inputRef}
          id={config.id}
          type="file"
          accept={accept}
          multiple={config.multiple}
          disabled={isDisabled}
          onChange={(e) => { if (e.target.files?.length) handleFiles(e.target.files) }}
          aria-invalid={!!error}
          style={{ display: 'none' }}
        />
      </div>

      {/* File list */}
      {value.length > 0 && (
        <ul
          style={{
            margin: '8px 0 0',
            padding: 0,
            listStyle: 'none',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {value.map((file, i) => (
            <li
              key={`${file.name}-${i}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                padding: '8px var(--form-padding-x)',
                background: 'var(--form-input-bg)',
                border: '1px solid var(--form-input-border)',
                borderRadius: 'var(--form-border-radius)',
                color: 'var(--form-input-text)',
                fontSize: 'var(--form-label-size)',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {file.name}
              </span>
              <span style={{ color: 'var(--form-help-color)', flexShrink: 0 }}>
                {formatBytes(file.size)}
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                aria-label={messages.removeFileLabel(file.name)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  color: 'var(--form-help-color)',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M10.5 3.5L3.5 10.5M3.5 3.5L10.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* TODO (future phase): wire onFilesSelected to Supabase Storage or Sanity Assets */}
    </FieldWrapper>
  )
}
