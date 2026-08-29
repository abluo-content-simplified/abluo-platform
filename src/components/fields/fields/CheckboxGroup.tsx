'use client'

import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { CheckboxGroupFieldConfig } from '../types'

interface Props {
  config: CheckboxGroupFieldConfig
  value: string[]
  onChange: (value: string[]) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

export function CheckboxGroup({ config, value = [], onChange, onBlur, error: externalError, disabled }: Props) {
  const { error: internalError, handleBlur } = useFieldValidation(config, value)
  const error = externalError ?? internalError
  const isDisabled = disabled ?? config.disabled
  const isHorizontal = config.layout === 'horizontal'

  const toggle = (optValue: string) => {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue))
    } else {
      if (config.maxSelections && value.length >= config.maxSelections) return
      onChange([...value, optValue])
    }
  }

  const display = config.display ?? 'list'

  // Chips / cards presentation — selectable pills or a multi-select card grid.
  if (display === 'chips' || display === 'cards') {
    const isCards = display === 'cards'
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
          onBlur={() => { handleBlur(); onBlur?.() }}
          style={
            isCards
              ? { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px' }
              : { display: 'flex', flexWrap: 'wrap', gap: '10px' }
          }
        >
          {config.options.map((opt) => {
            const active = value.includes(opt.value)
            const optDisabled = isDisabled || opt.disabled ||
              (!active && config.maxSelections ? value.length >= config.maxSelections : false)
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                disabled={optDisabled}
                onClick={() => !optDisabled && toggle(opt.value)}
                style={{
                  textAlign: 'left',
                  fontSize: 'inherit',
                  lineHeight: 1.3,
                  cursor: optDisabled ? 'not-allowed' : 'pointer',
                  opacity: optDisabled ? 0.5 : 1,
                  border: `1px solid ${active ? 'var(--color-primary)' : 'var(--form-input-border, var(--color-border))'}`,
                  background: active ? 'color-mix(in oklch, var(--color-primary) 10%, transparent)' : (isCards ? 'var(--form-input-bg)' : 'transparent'),
                  color: active ? 'var(--color-primary)' : 'var(--form-input-text)',
                  transition: 'border-color var(--motion-duration-fast), background var(--motion-duration-fast)',
                  ...(isCards
                    ? { padding: '12px 14px', borderRadius: 'var(--form-border-radius)' }
                    : { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '8px 14px', borderRadius: 'var(--radius-btn)' }),
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
        role="group"
        onBlur={() => { handleBlur(); onBlur?.() }}
        style={{
          display: 'flex',
          flexDirection: isHorizontal ? 'row' : 'column',
          flexWrap: isHorizontal ? 'wrap' : 'nowrap',
          gap: isHorizontal ? '12px 20px' : '10px',
        }}
      >
        {config.options.map((opt) => {
          const isChecked = value.includes(opt.value)
          const isOptDisabled = isDisabled || opt.disabled ||
            (!isChecked && config.maxSelections ? value.length >= config.maxSelections : false)

          return (
            <label
              key={opt.value}
              style={{
                display: 'inline-flex',
                alignItems: opt.description ? 'flex-start' : 'center',
                gap: '8px',
                cursor: isOptDisabled ? 'not-allowed' : 'pointer',
                opacity: isOptDisabled ? 0.5 : 1,
                color: 'var(--form-input-text)',
                fontSize: 'inherit',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '18px',
                  height: '18px',
                  flexShrink: 0,
                  borderRadius: '4px',
                  border: `2px solid ${isChecked ? 'var(--color-primary)' : 'var(--form-check-border)'}`,
                  background: isChecked ? 'var(--color-primary)' : 'var(--form-check-bg)',
                  transition: 'background var(--motion-duration-fast), border-color var(--motion-duration-fast)',
                }}
              >
                {isChecked && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => !isOptDisabled && toggle(opt.value)}
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
