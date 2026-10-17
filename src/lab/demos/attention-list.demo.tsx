'use client'

import { AttentionList, type AttentionRow } from '@/components/app/ui/AttentionList'
import { DemoBlock, DemoStack } from '../demo-kit'

const ROWS: AttentionRow[] = [
  { id: 'a', severity: 'warn', title: '3 contact requests waiting', detail: 'The oldest came in 2 days ago.', actionLabel: 'Open requests', href: '/dashboard' },
  { id: 'b', severity: 'warn', title: '1 post has no image', detail: 'Add one before you publish it.', actionLabel: 'Open the post', href: '/dashboard' },
  { id: 'c', severity: 'info', title: 'A new language is ready', detail: 'German pages are still empty.', actionLabel: 'Review languages', href: '/dashboard' },
  { id: 'd', severity: 'info', title: 'Analytics is not connected', detail: 'Connect it to see visitors.', actionLabel: 'Connect', href: '/dashboard' },
  { id: 'e', severity: 'info', title: 'Opening hours are out of date', detail: 'Last changed 9 months ago.', actionLabel: 'Update hours', href: '/dashboard' },
]

export default function AttentionListDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Rows with Show more" note="Props shown: items (severity warn / info), max (3). Rows past max sit behind the Show more button.">
        <div className="w-full max-w-xl">
          <AttentionList items={ROWS} max={3} />
        </div>
      </DemoBlock>
      <DemoBlock title="Empty" note="Props shown: items=[], emptyTitle, emptyBody.">
        <div className="w-full max-w-xl">
          <AttentionList items={[]} emptyTitle="All caught up" emptyBody="Nothing needs you right now." />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
