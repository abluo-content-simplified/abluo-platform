'use client'

import { useState } from 'react'
import { FieldWrapper } from '../FieldWrapper'
import { useFieldValidation } from '../useFieldValidation'
import type { RatingFieldConfig } from '../types'

interface Props {
  config: RatingFieldConfig
  value: number | null
  onChange: (value: number | null) => void
  onBlur?: () => void
  error?: string
  disabled?: boolean
}

// ─── Star SVG ────────────────────────────────────────────────────────────────

function StarIcon({ filled, hovered }: { filled: boolean; hovered: boolean }) {
  const color = filled || hovered ? 'var(--color-primary)' : 'var(--form-input-border)'
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill={filled ? 'var(--color-primary)' : hovered ? 'color-mix(in oklch, var(--color-primary) 40%, transparent)' : 'none'}
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transition: 'fill var(--motion-duration-fast), stroke var(--motion-duration-fast)' }}
    >
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  )
}

// ─── Heart SVG ────────────────────────────────────────────────────────────────

function HeartIcon({ filled, hovered }: { filled: boolean; hovered: boolean }) {
  const color = filled || hovered ? 'var(--color-primary)' : 'var(--form-input-border)'
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill={filled ? 'var(--color-primary)' : hovered ? 'color-mix(in oklch, var(--color-primary) 40%, transparent)' : 'none'}
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transition: 'fill var(--motion-duration-fast), stroke var(--motion-duration-fast)' }}
    >
      <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
    </svg>
  )
}

// ─── Circle SVG ──────────────────────────────────────────────────────────────

function CircleIcon({ filled, hovered }: { filled: boolean; hovered: boolean }) {
  const color = filled || hovered ? 'var(--color-primary)' : 'var(--form-input-border)'
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill={filled ? 'var(--color-primary)' : hovered ? 'color-mix(in oklch, var(--color-primary) 40%, transparent)' : 'none'}
      stroke={color}
      strokeWidth="1.5"
      style={{ transition: 'fill var(--motion-duration-fast), stroke var(--motion-duration-fast)' }}
    >
      <circle cx="12" cy="12" r="9" />
    </svg>
  )
}

function RatingIcon({ icon, filled, hovered }: { icon: string; filled: boolean; hovered: boolean }) {
  if (icon === 'heart') return <HeartIcon filled={filled} hovered={hovered} />
  if (icon === 'circle') return <CircleIcon filled={filled} hovered={hovered} />
  return <StarIcon filled={filled} hovered={hovered} />
}

// ─── Component ────────────────────────────────────────────────────────────────

export function RatingField({ config, value, onChange, onBlur, error: externalError, disabled }: Props) {
  const { error: internalError, handleBlur } = useFieldValidation(config, value)
  const error = externalError ?? internalError
  const isDisabled = disabled ?? config.disabled

  const max = config.maxRating ?? 5
  const icon = config.icon ?? 'star'
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const handleSelect = (rating: number) => {
    if (isDisabled) return
    if (config.allowClear && value === rating) {
      onChange(null)
    } else {
      onChange(rating)
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
        role="radiogroup"
        aria-label={config.label}
        onBlur={() => { handleBlur(); onBlur?.() }}
        style={{
          display: 'flex',
          gap: '4px',
          alignItems: 'center',
        }}
      >
        {Array.from({ length: max }, (_, i) => {
          const rating = i + 1
          const isFilled = value !== null && rating <= (value ?? 0)
          const isHovered = hoverIndex !== null && rating <= hoverIndex

          return (
            <button
              key={rating}
              type="button"
              role="radio"
              aria-checked={value === rating}
              aria-label={`${rating} out of ${max}`}
              disabled={isDisabled}
              onClick={() => handleSelect(rating)}
              onMouseEnter={() => !isDisabled && setHoverIndex(rating)}
              onMouseLeave={() => setHoverIndex(null)}
              style={{
                background: 'none',
                border: 'none',
                padding: '2px',
                cursor: isDisabled ? 'not-allowed' : 'pointer',
                opacity: isDisabled ? 0.5 : 1,
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <RatingIcon icon={icon} filled={isFilled} hovered={isHovered} />
            </button>
          )
        })}

        {value !== null && (
          <span
            style={{
              marginLeft: '8px',
              color: 'var(--form-help-color)',
              fontSize: 'var(--form-help-size)',
            }}
          >
            {value}/{max}
          </span>
        )}
      </div>
    </FieldWrapper>
  )
}
