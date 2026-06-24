/**
 * HiddenField — Form Field Library
 *
 * Renders nothing visible. Injects a static value into the form payload.
 * Used for tracking source, form ID, or any server-side metadata.
 */
import type { HiddenFieldConfig } from '../types'

interface Props {
  config: HiddenFieldConfig
  onChange?: (value: string) => void
}

export function HiddenField({ config }: Props) {
  return (
    <input
      type="hidden"
      id={config.id}
      name={config.id}
      value={config.value}
      readOnly
    />
  )
}
