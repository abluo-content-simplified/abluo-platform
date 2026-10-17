import type { ComponentProps } from 'react'
import { inputClass, textAreaClass, type ControlSize } from './field-styles'

/**
 * Single-line and multi-line text controls for dashboard forms. Pair with
 * <FieldLabel>. Any native attribute passes through (id, value, maxLength,
 * data-*, aria-*, ref …). `controlSize` is lg (48px) unless it is an inline
 * row (md, 44px); `flush` removes the gap that sits under a label.
 */
type Extra = { controlSize?: ControlSize; flush?: boolean }

export function TextInput({ controlSize, flush, className, ...rest }: Extra & ComponentProps<'input'>) {
  return <input className={inputClass({ controlSize, flush, className })} {...rest} />
}

export function TextArea({ flush, className, ...rest }: Pick<Extra, 'flush'> & ComponentProps<'textarea'>) {
  return <textarea className={textAreaClass({ flush, sized: rest.rows !== undefined, className })} {...rest} />
}
