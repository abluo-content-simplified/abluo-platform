'use client'

import { useState } from 'react'
import { Avatar } from '@/components/app/ui/Avatar'
import { isShiftChange } from '@/components/app/ui/Checkbox'
import { ListRow } from '@/components/app/ui/list/ListRow'
import { Pill } from '@/components/app/ui/list/cells'
import { DemoBlock, DemoStack } from '../demo-kit'

const ROWS = [
  { id: 'a', name: 'Anna Rossi', line: 'Would like to book a first appointment.' },
  { id: 'b', name: 'Marco Bianchi', line: 'Question about opening hours.' },
]

export default function ListRowDemo() {
  const [sel, setSel] = useState<string[]>([])
  const [opened, setOpened] = useState<string | null>(null)
  const menu = (name: string) => ({ label: `More for ${name}`, items: [{ key: 'open', label: 'Open', onSelect: () => setOpened(name) }] })
  return (
    <DemoStack>
      <DemoBlock title="With checkbox (selectable list)" note="select + menu. The body opens the item; the checkbox only selects.">
        <ul className="flex w-full max-w-md flex-col gap-3">
          {ROWS.map((r) => (
            <ListRow
              key={r.id}
              onOpen={() => setOpened(r.name)}
              select={{ checked: sel.includes(r.id), label: `Select ${r.name}`, onChange: (on, e) => { void isShiftChange(e); setSel((s) => (on ? [...s, r.id] : s.filter((x) => x !== r.id))) } }}
              menu={menu(r.name)}
            >
              <span className="line-clamp-1 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">{r.name}</span>
              <Pill tone="highlight">New</Pill>
              <span className="line-clamp-2 text-sm leading-5 text-muted-foreground">{r.line}</span>
            </ListRow>
          ))}
        </ul>
      </DemoBlock>
      <DemoBlock title="With a leading avatar" note="leading — no checkbox.">
        <ul className="flex w-full max-w-md flex-col gap-3">
          <ListRow onOpen={() => setOpened('Giulia Verdi')} leading={<Avatar name="Giulia Verdi" email="giulia@example.com" size="md" />} menu={menu('Giulia Verdi')}>
            <span className="line-clamp-1 text-[0.9375rem] leading-[1.375rem] font-semibold text-foreground">Giulia Verdi</span>
            <span className="text-sm leading-5 text-muted-foreground">giulia@example.com</span>
          </ListRow>
        </ul>
      </DemoBlock>
      <p aria-live="polite" className="text-sm text-muted-foreground">{opened ? `Opened: ${opened}` : 'Tap a row.'}</p>
    </DemoStack>
  )
}
