'use client'

/**
 * An on/off switch (the publish step's "Unpublish on" toggle as a shared
 * control): 44px tall, action colour when on, the knob slides with the
 * standard motion and does not animate under reduced motion.
 */
export function Switch({ checked, onChange, labelledBy, label, disabled = false }: { checked: boolean; onChange: (next: boolean) => void; labelledBy?: string; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-11 w-[72px] shrink-0 items-center rounded-full p-1 transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50 motion-reduce:transition-none ${
        checked ? 'bg-action' : 'bg-muted'
      }`}
    >
      <span aria-hidden="true" className={`size-9 rounded-full bg-background shadow-sm transition-transform duration-200 motion-reduce:transition-none ${checked ? 'translate-x-[28px]' : ''}`} />
    </button>
  )
}
