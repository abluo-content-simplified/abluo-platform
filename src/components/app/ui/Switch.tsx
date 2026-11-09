'use client'

/**
 * An on/off switch (a setting that applies at once). The visible track is a
 * compact 44×24 px; the button itself keeps a 44 px tall touch target. Off is
 * a clearly visible neutral track — the `input` token, ≥ 3:1 against the page
 * and the card in light AND dark (WCAG 1.4.11; muted-foreground at 45 % was
 * 1.6:1 in light), and the knob ≥ 3:1 against it; on is the action colour. The knob slides with
 * the standard motion and does not animate under reduced motion.
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
      className="group relative inline-flex h-11 w-12 shrink-0 items-center justify-center rounded-full focus-visible:outline-none disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={`relative inline-flex h-6 w-11 items-center rounded-full p-0.5 transition-colors duration-200 group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background motion-reduce:transition-none ${
          checked ? 'bg-action' : 'bg-input'
        }`}
      >
        <span className={`size-5 rounded-full bg-background shadow-sm transition-transform duration-200 motion-reduce:transition-none ${checked ? 'translate-x-5' : ''}`} />
      </span>
    </button>
  )
}
