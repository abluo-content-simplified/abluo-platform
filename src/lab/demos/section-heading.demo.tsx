'use client'

import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function SectionHeadingDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Plain">
        <div className="w-full max-w-md">
          <SectionHeading title="Latest posts" />
        </div>
      </DemoBlock>
      <DemoBlock title="With See all" note="seeAllHref — the label defaults to the shared “See all”.">
        <div className="w-full max-w-md">
          <SectionHeading title="Contact requests" seeAllHref="/lab" />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
