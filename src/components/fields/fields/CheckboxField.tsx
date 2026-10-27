'use client'

import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { CheckboxFieldConfig } from '../types'

interface Props {
  config: CheckboxFieldConfig
  value: boolean
  onChange: (value: boolean) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

export function CheckboxField({ config, value, onChange, onBlur, error: externalError, disabled }: Props) {
  const { error: internalError, handleBlur } = useFieldValidation(config, value)
  const error = externalError ?? internalError
  const isDisabled = disabled ?? config.disabled
  const isChecked = Boolean(value)

  if (config.display === 'switch') {
    // On/off toggle: text left, switch right, one row. A native checkbox with
    // role="switch" underneath, so the value, keyboard (Space), focus, label
    // click and validation are exactly the checkbox's. Colours are the website
    // Design System tokens (same as the cookie banner's switch), so it follows
    // the light and dark theme.
    return (
      <FieldWrapper id={config.id} label={config.label} helpText={config.helpText} required={config.required} error={error} width={config.width} hideLabel>
        <label
          htmlFor={config.id}
          data-field-switch=""
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '16px',
            cursor: isDisabled ? 'not-allowed' : 'pointer',
            opacity: isDisabled ? 0.5 : 1,
            color: 'var(--form-input-text)',
            lineHeight: 1.5,
          }}
        >
          <span>{config.checkboxLabel ?? config.label}</span>
          <input
            id={config.id}
            type="checkbox"
            role="switch"
            checked={isChecked}
            onChange={(e) => { if (!isDisabled) onChange(e.target.checked) }}
            onBlur={() => { handleBlur(); onBlur?.() }}
            disabled={isDisabled}
            aria-invalid={!!error}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className="relative inline-block h-6 w-10 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-offset-2 motion-reduce:transition-none"
            style={{
              background: isChecked ? 'var(--color-primary)' : 'var(--form-check-border, var(--color-border))',
              ['--tw-ring-color' as string]: 'var(--color-primary)',
              ['--tw-ring-offset-color' as string]: 'var(--color-background)',
            }}
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-full shadow-sm transition-all motion-reduce:transition-none"
              style={{ left: isChecked ? '18px' : '2px', background: 'var(--color-background, #fff)' }}
            />
          </span>
        </label>
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
      /* Consent-style checkbox carries its text beside the box; suppress the
         duplicate top label when it would just repeat the checkbox label. */
      hideLabel={!config.label || config.label === config.checkboxLabel}
    >
      <label
        style={{
          display: 'inline-flex',
          alignItems: 'flex-start',
          gap: '10px',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          opacity: isDisabled ? 0.5 : 1,
          color: 'var(--form-input-text)',
          fontSize: 'inherit',
          lineHeight: 1.5,
        }}
      >
        {/* Custom checkbox box */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '18px',
            height: '18px',
            flexShrink: 0,
            marginTop: '2px',
            borderRadius: '4px',
            border: `2px solid ${isChecked ? 'var(--color-primary)' : error ? 'var(--form-check-error-border)' : 'var(--form-check-border)'}`,
            background: isChecked ? 'var(--color-primary)' : 'var(--form-check-bg)',
            transition: 'background var(--motion-duration-fast) var(--motion-easing-standard), border-color var(--motion-duration-fast) var(--motion-easing-standard)',
          }}
        >
          {isChecked && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <input
          id={config.id}
          type="checkbox"
          checked={isChecked}
          onChange={(e) => { if (!isDisabled) onChange(e.target.checked) }}
          onBlur={() => { handleBlur(); onBlur?.() }}
          disabled={isDisabled}
          aria-invalid={!!error}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
        />
        {config.checkboxLabel ?? config.label}
      </label>
    </FieldWrapper>
  )
}
