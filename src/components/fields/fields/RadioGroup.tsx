'use client'

import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { RadioGroupFieldConfig } from '../types'

interface Props {
  config: RadioGroupFieldConfig
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

export function RadioGroup({ config, value, onChange, onBlur, error: externalError, disabled }: Props) {
  const { error: internalError, handleBlur } = useFieldValidation(config, value)
  const error = externalError ?? internalError
  const isDisabled = disabled ?? config.disabled
  const isHorizontal = config.layout === 'horizontal'

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
        role="radiogroup"
        aria-labelledby={`${config.id}-label`}
        onBlur={() => { handleBlur(); onBlur?.() }}
        style={{
          display: 'flex',
          flexDirection: isHorizontal ? 'row' : 'column',
          flexWrap: isHorizontal ? 'wrap' : 'nowrap',
          gap: isHorizontal ? '12px 20px' : '10px',
        }}
      >
        {config.options.map((opt) => {
          const isChecked = value === opt.value
          const isOptDisabled = isDisabled || opt.disabled

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
              {/* Custom radio circle */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  border: `2px solid ${isChecked ? 'var(--color-primary)' : 'var(--form-radio-border)'}`,
                  background: 'var(--form-radio-bg)',
                  flexShrink: 0,
                  transition: 'border-color var(--motion-duration-fast) var(--motion-easing-standard)',
                }}
              >
                {isChecked && (
                  <span
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: 'var(--color-primary)',
                    }}
                  />
                )}
              </span>
              <input
                type="radio"
                name={config.id}
                value={opt.value}
                checked={isChecked}
                onChange={() => !isOptDisabled && onChange(opt.value)}
                disabled={isOptDisabled}
                style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
              />
              {opt.label}
            </label>
          )
        })}
      </div>
    </FieldWrapper>
  )
}
