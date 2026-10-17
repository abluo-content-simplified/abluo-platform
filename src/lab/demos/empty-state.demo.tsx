'use client'

import { Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function EmptyStateDemo() {
  return (
    <DemoStack>
      <DemoBlock title="With an action">
        <EmptyState className="w-full" title="No posts yet" body="Your first post will be listed here." action={<Button variant="primary">Write a post</Button>} />
      </DemoBlock>
      <DemoBlock title="Compact" note="compact — inside a card or panel.">
        <EmptyState className="w-full" compact titleAs="h3" title="Nothing to review" body="New contact requests appear here." />
      </DemoBlock>
    </DemoStack>
  )
}
