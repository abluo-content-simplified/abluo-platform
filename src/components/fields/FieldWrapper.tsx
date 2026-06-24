'use client'

/**
 * FieldWrapper — Form Field Library
 *
 * Renders all chrome that surrounds every field type:
 *   label → [help text] → [input slot] → [error message]
 *
 * Individual field components render only the input element itself.
 * No hardcoded colors — all styling via DS CSS variables.
 */

import type { ReactNode } from 'react'

export interface FieldWrapperProps {
  id: string
  label: string
  helpText?: string
  required?: boolean
  error?: string | null
  /** '100%' = full row, '50%' = half row in a two-column form grid */
  width?: '50%' | '100%'
  /** Pass true for fields that have no visible label (hidden, checkbox inline label) */
  hideLabel?: boolean
  children: ReactNode
}

export function FieldWrapper({
  id,
  label,
  helpText,
  required,
  error,
  width = '100%',
  hideLabel = false,
  children,
}: FieldWrapperProps) {
  return (
    <div
      data-field-width={width === '50%' ? '50' : '100'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--form-label-gap, 6px)',
        // Width handled by parent form grid; this component is width-agnostic.
        // The data-field-width attribute is consumed by the form grid layout.
      }}
    >
      {/* Label */}
      {!hideLabel && (
        <label
          htmlFor={id}
          style={{
            display: 'block',
            color: 'var(--form-label-color)',
            fontSize: 'var(--form-label-size)',
            fontWeight: 'var(--form-label-weight)',
            lineHeight: 1.4,
            userSelect: 'none',
          }}
        >
          {label}
          {required && (
            <span
              aria-hidden="true"
              style={{
                marginLeft: '0.25em',
                color: 'var(--form-required-color)',
              }}
            >
              *
            </span>
          )}
        </label>
      )}

      {/* Help text — shown between label and input */}
      {helpText && (
        <p
          style={{
            margin: 0,
            color: 'var(--form-help-color)',
            fontSize: 'var(--form-help-size)',
            lineHeight: 1.5,
          }}
        >
          {helpText}
        </p>
      )}

      {/* Input slot */}
      {children}

      {/* Error message */}
      {error && (
        <p
          role="alert"
          aria-live="polite"
          style={{
            margin: 0,
            color: 'var(--form-error-color)',
            fontSize: 'var(--form-error-size)',
            lineHeight: 1.4,
          }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
