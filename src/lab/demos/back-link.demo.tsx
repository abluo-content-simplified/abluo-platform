'use client'

import { BackLink } from '@/components/app/ui/BackLink'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function BackLinkDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Above an editor" note="href, label. Sits above the PageHeader.">
        <div className="w-full">
          <BackLink href="/lab" label="Events" />
          <PageHeader title="Summer concert" />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
