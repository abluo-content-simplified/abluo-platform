import type { ComponentProps } from 'react'
import { inputClass, type ControlSize } from './field-styles'

/**
 * A dropdown for dashboard forms (one choice out of many). Same look as
 * TextInput; pair with <FieldLabel> or use inside <Field>. Native <select>,
 * so phones show their own picker. For a few options shown at once use
 * SegmentedControl or ChoiceCard; list filters use FilterSelect. The Create
 * flow uses no dropdowns at all (ADR-025 — cards, chips, toggles).
 */
export function Select({ controlSize, flush, className, ...rest }: { controlSize?: ControlSize; flush?: boolean } & ComponentProps<'select'>) {
  return <select className={inputClass({ controlSize, flush, className: `truncate pr-3 ${className ?? ''}` })} {...rest} />
}
