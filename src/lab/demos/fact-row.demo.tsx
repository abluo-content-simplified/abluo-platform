'use client'

import { FactRow } from '@/components/app/ui/FactRow'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function FactRowDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Facts list" note="Props shown: label, children. Render inside a dl; stacked on phones, two left-aligned columns from md; long values wrap.">
        <dl className="w-full max-w-md rounded-xl border border-border bg-card px-4">
          <FactRow label="Name">Claudia Hoffmann</FactRow>
          <FactRow label="Email">claudia.hoffmann@example.com</FactRow>
          <FactRow label="Role">Owner</FactRow>
          <FactRow label="Message">I would like to book a first session next week, preferably in the afternoon.</FactRow>
        </dl>
      </DemoBlock>
    </DemoStack>
  )
}
