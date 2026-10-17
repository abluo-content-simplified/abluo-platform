'use client'

import { useState } from 'react'
import { CardGrid, CardGridItem, ContentCard, SelectAll } from '@/components/app/ui/list/ContentCard'
import { CardMenu } from '@/components/app/ui/CardMenu'
import { Chips, Pill } from '@/components/app/ui/list/cells'
import { ThumbStrip } from '@/components/app/ui/list/ThumbStrip'
import { DemoBlock, DemoStack } from '../demo-kit'

const CARDS = [
  { id: 'c1', title: 'Spring menu announced', subtitle: 'Seasonal dishes arrive this week.', tags: ['News', 'Menu'], live: true },
  { id: 'c2', title: 'Our new tasting room with a deliberately long title that clamps to two lines', subtitle: 'A look inside the renovated space, with a long subtitle that also clamps.', tags: ['Events'], live: false },
  { id: 'c3', title: 'Opening hours for summer', subtitle: 'Longer evenings from June.', tags: ['News'], live: true },
  { id: 'c4', title: 'Meet the team', tags: ['About', 'Team'], live: false },
]

export default function ContentCardDemo() {
  const [selected, setSelected] = useState<Set<string>>(new Set(['c3']))
  const [opened, setOpened] = useState<string | null>(null)
  const state = selected.size === 0 ? 'none' : selected.size === CARDS.length ? 'all' : 'some'
  const toggle = (id: string, on: boolean) =>
    setSelected((p) => {
      const n = new Set(p)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })
  return (
    <DemoStack>
      <DemoBlock title="CardGrid of ContentCards" note="media, title, subtitle, selection, overlay (CardMenu chip), onOpen, children (Chips, Pill). Equal heights per row; SelectAll above.">
        <div className="w-full space-y-3">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>{selected.size} of {CARDS.length} selected</span>
            <SelectAll label="Select all" state={state} onChange={(on) => setSelected(on ? new Set(CARDS.map((c) => c.id)) : new Set())} />
          </div>
          <CardGrid label="Posts">
            {CARDS.map((c) => (
              <CardGridItem key={c.id}>
                <ContentCard
                  media={{ src: null }}
                  title={c.title}
                  subtitle={c.subtitle}
                  onOpen={() => setOpened(c.title)}
                  selection={{ checked: selected.has(c.id), onChange: (on) => toggle(c.id, on), label: `Select ${c.title}` }}
                  overlay={<CardMenu variant="chip" label={`More for ${c.title}`} items={[{ key: 'open', label: 'Open', onSelect: () => setOpened(c.title) }]} />}
                >
                  <Chips items={c.tags} />
                  <span className="flex"><Pill tone={c.live ? 'success' : 'muted'}>{c.live ? 'Published' : 'Draft'}</Pill></span>
                </ContentCard>
              </CardGridItem>
            ))}
          </CardGrid>
        </div>
        <p className="w-full text-sm text-muted-foreground">{opened ? `Opened: ${opened}` : 'Click a card body.'}</p>
      </DemoBlock>
      <DemoBlock title="Custom media and portrait shape" note="mediaContent (ThumbStrip) and mediaShape='portrait'.">
        <div className="w-56">
          <ContentCard media={{ src: null }} mediaContent={<ThumbStrip srcs={[]} className="absolute inset-0 size-full" />} title="Collection" subtitle="0 photos" />
        </div>
        <div className="w-40">
          <ContentCard media={{ src: null }} mediaShape="portrait" title="Portrait cover" />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
