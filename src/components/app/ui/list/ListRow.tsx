'use client'

import type { ChangeEvent, ReactNode } from 'react'
import { CardMenu, type CardMenuItem } from '../CardMenu'
import { Checkbox } from '../Checkbox'

/**
 * One row of a phone list (People, Contact requests, …): an optional square
 * checkbox, the tappable body that opens the item, and the "⋯" menu. The
 * desktop view of the same list is a DataTable; this is its phone twin.
 *
 *   <ul className="flex flex-col gap-3">
 *     <ListRow onOpen={() => open(p)} openLabel={…} leading={<Avatar …/>} menu={{ label, items }}
 *       select={{ checked, label, onChange: (on, e) => toggle(p.id, on, isShiftChange(e)) }}>
 *       <span className="…font-semibold">{name}</span> …
 *     </ListRow>
 *   </ul>
 *
 * Content is top-aligned with the checkbox / leading element. The selected row
 * gets the action ring.
 */
export function ListRow({
  onOpen,
  leading,
  select,
  menu,
  children,
}: {
  onOpen: () => void
  /** An avatar or thumbnail before the text. */
  leading?: ReactNode
  select?: { checked: boolean; label: string; onChange: (checked: boolean, event: ChangeEvent<HTMLInputElement>) => void }
  menu?: { label: string; items: CardMenuItem[] }
  children: ReactNode
}) {
  const selected = select?.checked ?? false
  return (
    <li className={`flex items-start gap-1 rounded-xl border bg-card py-2 pr-1 ${select ? 'pl-1' : 'pl-3'} ${selected ? 'border-action ring-1 ring-action' : 'border-border'}`}>
      {select ? <Checkbox checked={select.checked} aria-label={select.label} onChange={select.onChange} /> : null}
      <button
        type="button"
        onClick={onOpen}
        className={`flex min-w-0 flex-1 items-start gap-3 pb-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${select ? 'pt-3' : 'pt-2'}`}
      >
        {leading}
        <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">{children}</span>
      </button>
      {menu ? (
        <span className="shrink-0">
          <CardMenu label={menu.label} items={menu.items} />
        </span>
      ) : null}
    </li>
  )
}
