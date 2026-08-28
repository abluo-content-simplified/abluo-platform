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
  const display = config.display ?? 'list'

  // Cards presentation — a selectable card grid (single-select).
  if (display === 'cards') {
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
          style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }}
        >
          {config.options.map((opt) => {
            const active = value === opt.value
            const optDisabled = isDisabled || opt.disabled
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={optDisabled}
                onClick={() => !optDisabled && onChange(opt.value)}
                style={{
                  textAlign: 'left',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  fontSize: 'inherit',
                  lineHeight: 1.3,
                  cursor: optDisabled ? 'not-allowed' : 'pointer',
                  opacity: optDisabled ? 0.5 : 1,
                  border: `1px solid ${active ? 'var(--color-primary)' : 'var(--form-input-border, var(--color-border))'}`,
                  background: active ? 'color-mix(in oklch, var(--color-primary) 8%, transparent)' : 'var(--form-input-bg)',
                  color: active ? 'var(--color-primary)' : 'var(--form-input-text)',
                  transition: 'border-color var(--motion-duration-fast), background var(--motion-duration-fast)',
                }}
              >
                {opt.description ? (
                  <>
                    <span style={{ display: 'block' }}>{opt.label}</span>
                    <span style={{ display: 'block', marginTop: '4px', fontSize: '0.85em', opacity: 0.7 }}>
                      {opt.description}
                    </span>
                  </>
                ) : (
                  opt.label
                )}
              </button>
            )
          })}
        </div>
      </FieldWrapper>
    )
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
                alignItems: opt.description ? 'flex-start' : 'center',
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
              {opt.description ? (
                <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span>{opt.label}</span>
                  <span style={{ fontSize: '0.85em', opacity: 0.7 }}>{opt.description}</span>
                </span>
              ) : (
                opt.label
              )}
            </label>
          )
        })}
      </div>
    </FieldWrapper>
  )
}
