'use client'

import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { MultiSelectFieldConfig } from '../types'

interface Props {
  config: MultiSelectFieldConfig
  value: string[]
  onChange: (value: string[]) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

export function MultiSelectField({ config, value = [], onChange, onBlur, error: externalError, disabled }: Props) {
  const { error: internalError, handleBlur } = useFieldValidation(config, value)
  const error = externalError ?? internalError
  const isDisabled = disabled ?? config.disabled

  const toggle = (optValue: string) => {
    const current = value ?? []
    if (current.includes(optValue)) {
      onChange(current.filter((v) => v !== optValue))
    } else {
      if (config.maxSelections && current.length >= config.maxSelections) return
      onChange([...current, optValue])
    }
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
      <div
        role="group"
        aria-labelledby={`${config.id}-label`}
        onBlur={() => { handleBlur(); onBlur?.() }}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '8px',
          padding: 'var(--form-padding-y) var(--form-padding-x)',
          background: 'var(--form-input-bg)',
          border: `1px solid ${error ? 'var(--form-input-error-border)' : 'var(--form-input-border)'}`,
          borderRadius: 'var(--form-border-radius)',
        }}
      >
        {config.options.map((opt) => {
          const checked = value.includes(opt.value)
          const isOptDisabled = isDisabled || opt.disabled ||
            (!checked && config.maxSelections ? value.length >= config.maxSelections : false)

          return (
            <label
              key={opt.value}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: isOptDisabled ? 'not-allowed' : 'pointer',
                opacity: isOptDisabled ? 0.5 : 1,
                color: 'var(--form-input-text)',
                fontSize: 'inherit',
              }}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => !isOptDisabled && toggle(opt.value)}
                disabled={isOptDisabled}
                style={{ accentColor: 'var(--color-primary)', width: '16px', height: '16px', flexShrink: 0 }}
              />
              {opt.label}
            </label>
          )
        })}
      </div>
      {config.maxSelections && (
        <p style={{ margin: 0, color: 'var(--form-help-color)', fontSize: 'var(--form-help-size)' }}>
          {value.length}/{config.maxSelections} selected
        </p>
      )}
    </FieldWrapper>
  )
}
