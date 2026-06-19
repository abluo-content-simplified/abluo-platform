'use client'

import { useRef, useEffect } from 'react'
import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { TextareaFieldConfig } from '../types'

interface Props {
  config: TextareaFieldConfig
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

export function TextareaField({ config, value, onChange, onBlur, error: externalError, disabled }: Props) {
  const { error: internalError, handleBlur } = useFieldValidation(config, value)
  const error = externalError ?? internalError
  const ref = useRef<HTMLTextAreaElement>(null)

  // Auto-resize when enabled
  useEffect(() => {
    if (!config.autoResize || !ref.current) return
    ref.current.style.height = 'auto'
    ref.current.style.height = ref.current.scrollHeight + 'px'
  }, [value, config.autoResize])

  return (
    <FieldWrapper
      id={config.id}
      label={config.label}
      helpText={config.helpText}
      required={config.required}
      error={error}
      width={config.width}
    >
      <textarea
        ref={ref}
        id={config.id}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => { handleBlur(); onBlur?.() }}
        placeholder={config.placeholder}
        disabled={disabled ?? config.disabled}
        readOnly={config.readOnly}
        rows={config.rows ?? 4}
        maxLength={config.maxLength}
        aria-invalid={!!error}
        style={{
          display: 'block',
          width: '100%',
          padding: 'var(--form-padding-y) var(--form-padding-x)',
          background: 'var(--form-textarea-bg)',
          border: `1px solid ${error ? 'var(--form-textarea-error-border)' : 'var(--form-textarea-border)'}`,
          borderRadius: 'var(--form-border-radius)',
          color: 'var(--form-textarea-text)',
          fontSize: 'inherit',
          lineHeight: 1.6,
          outline: 'none',
          resize: config.autoResize ? 'none' : 'vertical',
          transition: 'border-color var(--motion-duration-fast) var(--motion-easing-standard)',
          boxSizing: 'border-box',
          opacity: (disabled ?? config.disabled) ? 'var(--form-textarea-disabled-opacity)' as unknown as number : undefined,
        }}
        onFocus={(e) => { e.target.style.borderColor = 'var(--form-textarea-focus-border)' }}
        onBlurCapture={(e) => { if (!error) e.target.style.borderColor = 'var(--form-textarea-border)' }}
      />
    </FieldWrapper>
  )
}
