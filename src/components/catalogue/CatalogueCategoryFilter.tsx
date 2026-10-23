'use client'

// ── CatalogueCategoryFilter — "All · Literature · Science fiction" ───────────
//
// A filter bar above a catalogue listing. The listing itself stays server-
// rendered: each item carries `data-cats="literature fantasy"`, and choosing a
// category only hides the others with one scoped CSS rule. Shown by the
// caller only when the items use at least two categories
// (collectionFilterCategories). Values are machine keys (isFilterValue), so
// they are safe inside the rule.

import { useId, useState, type ReactNode } from 'react'

export function CatalogueCategoryFilter({
  categories,
  allLabel,
  label,
  children,
}: {
  categories: readonly { value: string; label: string }[]
  allLabel: string
  label: string
  children: ReactNode
}) {
  const [active, setActive] = useState<string | null>(null)
  const scope = useId().replace(/[^A-Za-z0-9_-]/g, '')
  const options: { value: string | null; label: string }[] = [{ value: null, label: allLabel }, ...categories]
  return (
    <div data-category-filter-scope={scope}>
      <div role="group" aria-label={label || undefined} className="mb-10 flex flex-wrap gap-2" data-category-filter="">
        {options.map((o) => {
          const on = active === o.value
          return (
            <button
              key={o.value ?? '*'}
              type="button"
              aria-pressed={on}
              onClick={() => setActive(o.value)}
              className="rounded-[var(--radius-full,9999px)] border px-4 py-1.5 text-sm transition-colors duration-200"
              style={
                on
                  ? { backgroundColor: 'var(--color-text-primary)', borderColor: 'var(--color-text-primary)', color: 'var(--color-background)' }
                  : { borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }
              }
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {active && /^[A-Za-z0-9_-]{1,80}$/.test(active) ? (
        <style>{`[data-category-filter-scope="${scope}"] [data-cats]:not([data-cats~="${active}"]){display:none}`}</style>
      ) : null}
      {children}
    </div>
  )
}
