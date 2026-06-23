'use client'

/**
 * FormField — Form Field Library dispatcher
 *
 * The single public component for rendering any field.
 * Receives a FieldConfig, routes to the correct leaf component.
 *
 * Usage:
 *   <FormField config={fieldConfig} value={values[field.id]} onChange={...} />
 *
 * Callers never import individual field components directly.
 */

import type { FieldConfig } from './types'
import { TextField }        from './fields/TextField'
import { TextareaField }    from './fields/TextareaField'
import { NumberField }      from './fields/NumberField'
import { EmailField }       from './fields/EmailField'
import { PhoneField }       from './fields/PhoneField'
import { UrlField }         from './fields/UrlField'
import { SelectField }      from './fields/SelectField'
import { MultiSelectField } from './fields/MultiSelectField'
import { RadioGroup }       from './fields/RadioGroup'
import { CheckboxField }    from './fields/CheckboxField'
import { CheckboxGroup }    from './fields/CheckboxGroup'
import { CountrySelect }    from './fields/CountrySelect'
import { DateField }        from './fields/DateField'
import { FileUploadField }  from './fields/FileUploadField'
import { HiddenField }      from './fields/HiddenField'
import { RatingField }      from './fields/RatingField'

interface FormFieldProps {
  config: FieldConfig
  value: unknown
  onChange: (value: unknown) => void
  onBlur?: () => void
  /** Override error — takes precedence over internal per-field validation */
  error?: string
  disabled?: boolean
  /** Called when files are selected — STORAGE INTEGRATION POINT for file fields */
  onFilesSelected?: (files: File[]) => void
}

export function FormField({
  config,
  value,
  onChange,
  onBlur,
  error,
  disabled,
  onFilesSelected,
}: FormFieldProps) {
  const shared = { config, value, onChange, onBlur, error, disabled } as const

  switch (config.type) {
    case 'text':
      return <TextField {...shared as any} config={config} value={(value as string) ?? ''} onChange={onChange as (v: string) => void} />

    case 'textarea':
      return <TextareaField {...shared as any} config={config} value={(value as string) ?? ''} onChange={onChange as (v: string) => void} />

    case 'number':
      return <NumberField {...shared as any} config={config} value={(value as number | null) ?? null} onChange={onChange as (v: number | null) => void} />

    case 'email':
      return <EmailField {...shared as any} config={config} value={(value as string) ?? ''} onChange={onChange as (v: string) => void} />

    case 'phone':
      return <PhoneField {...shared as any} config={config} value={(value as string) ?? ''} onChange={onChange as (v: string) => void} />

    case 'url':
      return <UrlField {...shared as any} config={config} value={(value as string) ?? ''} onChange={onChange as (v: string) => void} />

    case 'select':
      return <SelectField {...shared as any} config={config} value={(value as string) ?? ''} onChange={onChange as (v: string) => void} />

    case 'multi-select':
      return <MultiSelectField {...shared as any} config={config} value={(value as string[]) ?? []} onChange={onChange as (v: string[]) => void} />

    case 'radio-group':
      return <RadioGroup {...shared as any} config={config} value={(value as string) ?? ''} onChange={onChange as (v: string) => void} />

    case 'checkbox':
      return <CheckboxField {...shared as any} config={config} value={Boolean(value)} onChange={onChange as (v: boolean) => void} />

    case 'checkbox-group':
      return <CheckboxGroup {...shared as any} config={config} value={(value as string[]) ?? []} onChange={onChange as (v: string[]) => void} />

    case 'country-select':
      return <CountrySelect {...shared as any} config={config} value={(value as string) ?? ''} onChange={onChange as (v: string) => void} />

    case 'date':
      return <DateField {...shared as any} config={config} value={(value as string) ?? ''} onChange={onChange as (v: string) => void} />

    case 'file':
      return (
        <FileUploadField
          config={config}
          value={(value as File[]) ?? []}
          onChange={onChange as (v: File[]) => void}
          onFilesSelected={onFilesSelected}
          onBlur={onBlur}
          error={error}
          disabled={disabled}
        />
      )

    case 'hidden':
      return <HiddenField config={config} />

    case 'rating':
      return <RatingField {...shared as any} config={config} value={(value as number | null) ?? null} onChange={onChange as (v: number | null) => void} />

    default:
      // Exhaustiveness guard — TypeScript will error here if a new field type is added
      // to FieldType but not handled in this switch.
      const _: never = config
      console.warn('[FormField] Unhandled field type:', (config as FieldConfig).type)
      return null
  }
}
