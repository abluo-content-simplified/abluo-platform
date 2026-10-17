import type { ComponentProps } from 'react'
import { inputClass, type ControlSize } from './field-styles'

/**
 * A date, date-and-time or time field for dashboard forms (event dates,
 * opening dates…). Same look as TextInput; native control, so phones show
 * their own picker. Values are the native strings (YYYY-MM-DD,
 * YYYY-MM-DDTHH:mm, HH:mm).
 *
 * Use the right one: publish / unpublish dates are PublicationDateField (site
 * time zone, clock changes); a date RANGE filter on a list is DateRangePicker.
 */
export function DateInput({
  type = 'date',
  controlSize,
  flush,
  className,
  ...rest
}: { type?: 'date' | 'datetime-local' | 'time'; controlSize?: ControlSize; flush?: boolean } & Omit<ComponentProps<'input'>, 'type'>) {
  return <input type={type} className={inputClass({ controlSize, flush, className })} {...rest} />
}
