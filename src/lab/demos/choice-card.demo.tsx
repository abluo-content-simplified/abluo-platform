'use client'

import { useState } from 'react'
import { ChoiceCard, ChoiceCardGrid } from '@/components/app/ui/ChoiceCard'
import { DemoBlock, DemoStack } from '../demo-kit'

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
)
const PEN = icon('M4 20h4L19 9l-4-4L4 16v4z')
const IMAGE = icon('M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4')
const CALENDAR = icon('M4 6h16v14H4zM4 10h16M8 3v4M16 3v4')

const KINDS = [
  { id: 'blog', label: 'Blog post', icon: PEN, description: 'Write an article' },
  { id: 'gallery', label: 'Gallery', icon: IMAGE, description: 'Show a set of photos' },
  { id: 'event', label: 'Event', icon: CALENDAR, description: 'Announce a date' },
]

export default function ChoiceCardDemo() {
  const [kind, setKind] = useState('blog')
  const [last, setLast] = useState('Nothing yet')
  return (
    <DemoStack>
      <DemoBlock title="A choice (radio)" note="Props shown: selected (makes it role=radio), description. Grid kind='radio'.">
        <div className="w-full max-w-2xl">
          <ChoiceCardGrid kind="radio" label="What would you like to create?">
            {KINDS.map((k) => (
              <ChoiceCard key={k.id} icon={k.icon} label={k.label} description={k.description} selected={kind === k.id} onSelect={() => setKind(k.id)} />
            ))}
          </ChoiceCardGrid>
        </div>
      </DemoBlock>
      <DemoBlock title="A menu of actions" note="selected omitted: plain buttons. Props shown: badge, disabled, busy.">
        <div className="w-full max-w-2xl">
          <ChoiceCardGrid label="Add content">
            <ChoiceCard icon={PEN} label="Blog post" onSelect={() => setLast('Blog post')} />
            <ChoiceCard icon={IMAGE} label="Gallery" badge="Coming soon" disabled />
            <ChoiceCard icon={CALENDAR} label="Event" busy onSelect={() => setLast('Event')} />
          </ChoiceCardGrid>
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Last pressed: {last}
          </p>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
