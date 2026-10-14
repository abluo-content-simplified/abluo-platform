'use client'

/**
 * Multi-select chips (pill, ✓ + action colours when chosen) — the blog
 * wizard's category chips as a shared control, for any "pick some of these"
 * choice (catalogue categories, dietary tags, weekdays). Each chip is a
 * 44px checkbox button; top-aligned wrapping. Labels come from the caller.
 */
export function ToggleChips({
  label,
  options,
  value,
  onChange,
  size = 'default',
}: {
  /** Accessible name of the group. */
  label: string
  options: readonly { value: string; label: string }[]
  value: readonly string[]
  onChange: (next: string[]) => void
  /** `compact`: narrower padding (e.g. seven weekdays on a phone). */
  size?: 'default' | 'compact'
}) {
  const selected = new Set(value)
  const toggle = (v: string) => onChange(selected.has(v) ? value.filter((x) => x !== v) : options.map((o) => o.value).filter((x) => x === v || selected.has(x)))
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-start gap-2">
      {options.map((o) => {
        const on = selected.has(o.value)
        return (
          <button
            key={o.value}
            type="button"
            role="checkbox"
            aria-checked={on}
            onClick={() => toggle(o.value)}
            className={`inline-flex h-11 items-center gap-1.5 rounded-full border text-[0.9375rem] font-medium transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none motion-reduce:transition-none ${
              size === 'compact' ? 'px-3' : 'px-4'
            } ${on ? 'border-action bg-action text-action-foreground' : 'border-border bg-card text-foreground hover:bg-hover'}`}
          >
            {on ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            ) : null}
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
