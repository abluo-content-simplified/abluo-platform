'use client'

import { Button } from '@/components/app/ui/Button'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function PageHeaderDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Title only">
        <div className="w-full">
          <PageHeader title="Galleries" />
        </div>
      </DemoBlock>
      <DemoBlock title="With actions" note="Every page: <PageShell> then <PageHeader>. No page sets its own width.">
        <div className="w-full">
          <PageHeader title="Posts" actions={<Button variant="primary">New post</Button>} />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
