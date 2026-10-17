'use client'

import { Panel } from '@/components/app/ui/Panel'
import { Skeleton } from '@/components/app/ui/Skeleton'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function SkeletonDemo() {
  return (
    <DemoStack>
      <DemoBlock title="A loading card" note="The container carries aria-busy and a label; each block is aria-hidden.">
        <div aria-busy="true" aria-label="Loading" className="w-full max-w-md space-y-3">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="aspect-video w-full" shape="block" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </DemoBlock>
      <DemoBlock title="On a muted surface" note="onMuted">
        <Panel tone="muted" className="w-full max-w-md space-y-2">
          <Skeleton onMuted className="h-4 w-2/3" />
          <Skeleton onMuted className="h-4 w-1/2" />
        </Panel>
      </DemoBlock>
    </DemoStack>
  )
}
