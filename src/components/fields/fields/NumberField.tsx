'use client'

import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { NumberFieldConfig } from '../types'

interface Props {
  config: NumberFieldConfig
  value: number | null
  onChange: (value: number | null) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

export function NumberField({ config, value, onChange, onBlur, error: externalError, disabled }: Props) {
  const { error: internalError, handleBlur } = useFieldValidation(config, value)
  const error = externalError ?? internalError

  return (
    <FieldWrapper
      id={config.id}
      label={config.label}
      helpText={config.helpText}
      required={config.required}
      error={error}
      width={config.width}
    >
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
        <input
          id={config.id}
          type="number"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
          onBlur={() => { handleBlur(); onBlur?.() }}
          placeholder={config.placeholder}
          disabled={disabled ?? config.disabled}
          readOnly={config.readOnly}
          min={config.min}
          max={config.max}
          step={config.step}
          aria-invalid={!!error}
          style={{
            display: 'block',
            width: '100%',
            height: 'var(--form-input-height)',
            padding: config.unit
              ? `var(--form-padding-y) calc(var(--form-padding-x) * 3) var(--form-padding-y) var(--form-padding-x)`
              : 'var(--form-padding-y) var(--form-padding-x)',
            background: 'var(--form-input-bg)',
            border: `1px solid ${error ? 'var(--form-input-error-border)' : 'var(--form-input-border)'}`,
            borderRadius: 'var(--form-border-radius)',
            color: 'var(--form-input-text)',
            fontSize: 'inherit',
            outline: 'none',
            transition: 'border-color var(--motion-duration-fast) var(--motion-easing-standard)',
            boxSizing: 'border-box',
          }}
          onFocus={(e) => { e.target.style.borderColor = 'var(--form-input-focus-border)' }}
          onBlurCapture={(e) => { if (!error) e.target.style.borderColor = 'var(--form-input-border)' }}
        />
        {config.unit && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: 'var(--form-padding-x)',
              color: 'var(--form-input-placeholder)',
              fontSize: 'var(--form-label-size)',
              pointerEvents: 'none',
            }}
          >
            {config.unit}
          </span>
        )}
      </div>
    </FieldWrapper>
  )
}
