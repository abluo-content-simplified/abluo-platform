'use client'

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { nextSegmentIndex } from './segmented-keys'
import { TAB_LIST_CLASS, tabClass, tabIds } from './tab-styles'

export type TabItem = {
  id: string
  label: ReactNode
  count?: number
  disabled?: boolean
}

/**
 * Tabs that switch what is shown below them (Categories | Tags, …), WAI-ARIA
 * tablist: Tab enters on the selected tab, arrow keys move AND select (wrapping),
 * Home/End jump. The row scrolls sideways on a phone, never wraps. For a choice
 * that is a setting rather than a view, use SegmentedControl.
 *
 * Pass `idBase` and give the content below `role="tabpanel"` with
 * `{...tabPanelProps(idBase, value)}` so tab and panel point at each other.
 *
 *   <Tabs label="Show" idBase={id} value={kind} onChange={setKind}
 *     items={[{ id: 'category', label: 'Categories', count: 4 }, { id: 'tag', label: 'Tags' }]} />
 */
export function Tabs({
  label,
  items,
  value,
  onChange,
  idBase,
  className = '',
}: {
  label: string
  items: TabItem[]
  value: string
  onChange: (id: string) => void
  idBase?: string
  className?: string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const selected = items.findIndex((i) => i.id === value)
  const stop = selected >= 0 && !items[selected].disabled ? selected : items.findIndex((i) => !i.disabled)

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = refs.current.findIndex((b) => b === document.activeElement)
    if (current < 0) return
    const next = nextSegmentIndex(
      e.key,
      current,
      items.map((i) => !!i.disabled),
    )
    if (next === null) return
    e.preventDefault()
    refs.current[next]?.focus()
    refs.current[next]?.scrollIntoView?.({
      block: 'nearest',
      inline: 'nearest',
    })
    onChange(items[next].id)
  }

  return (
    <div role="tablist" aria-label={label} aria-orientation="horizontal" onKeyDown={onKeyDown} className={[TAB_LIST_CLASS, className].filter(Boolean).join(' ')}>
      {items.map((item, i) => {
        const on = item.id === value
        const ids = idBase ? tabIds(idBase, item.id) : null
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={ids?.tab}
            aria-selected={on}
            aria-controls={ids?.panel}
            tabIndex={i === stop ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            className={tabClass(on)}
          >
            {item.label}
            {item.count !== undefined ? <span className="text-sm font-normal text-muted-foreground">{item.count}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

/** Props for the content a tab shows: `<div {...tabPanelProps(idBase, value)}>`. */
export function tabPanelProps(idBase: string, id: string) {
  const ids = tabIds(idBase, id)
  return {
    role: 'tabpanel' as const,
    id: ids.panel,
    'aria-labelledby': ids.tab,
  }
}
