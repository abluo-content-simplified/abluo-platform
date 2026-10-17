'use client'

import type { ChangeEvent, ReactNode } from 'react'
import { CardMenu, type CardMenuItem } from '../CardMenu'
import { Checkbox } from '../Checkbox'
import { Link } from '@/i18n/navigation'

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
  href,
  leading,
  select,
  menu,
  trailing,
  children,
}: {
  /** Opens the item (a button). Pass `href` instead when the item has its own page (a real link: new tab, copy link). */
  onOpen?: () => void
  href?: string
  /** An avatar or thumbnail before the text. */
  leading?: ReactNode
  select?: { checked: boolean; label: string; onChange: (checked: boolean, event: ChangeEvent<HTMLInputElement>) => void }
  menu?: { label: string; items: CardMenuItem[] }
  /** Small controls at the end instead of (or before) the menu, e.g. move up / down. */
  trailing?: ReactNode
  children: ReactNode
}) {
  const selected = select?.checked ?? false
  const bodyClass = `flex min-w-0 flex-1 items-start gap-3 pb-1 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${select ? 'pt-3' : 'pt-2'}`
  const body = (
    <>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1.5">{children}</span>
    </>
  )
  return (
    <li className={`flex items-start gap-1 rounded-xl border bg-card py-2 pr-1 ${select ? 'pl-1' : 'pl-3'} ${selected ? 'border-action ring-1 ring-action' : 'border-border'}`}>
      {select ? <Checkbox checked={select.checked} aria-label={select.label} onChange={select.onChange} /> : null}
      {href ? (
        <Link href={href} className={bodyClass}>
          {body}
        </Link>
      ) : (
        <button type="button" onClick={onOpen} className={bodyClass}>
          {body}
        </button>
      )}
      {trailing ? <span className="flex shrink-0 items-center pt-0.5">{trailing}</span> : null}
      {menu ? (
        <span className="shrink-0">
          <CardMenu label={menu.label} items={menu.items} />
        </span>
      ) : null}
    </li>
  )
}
