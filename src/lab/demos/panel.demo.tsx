'use client'

import { FactRow } from '@/components/app/ui/FactRow'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function PanelDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Default (card, md padding)">
        <Panel className="w-full">
          <p className="text-[0.9375rem]">A group of related content.</p>
        </Panel>
      </DemoBlock>
      <DemoBlock title="Section with heading, lg padding" note="as=&quot;section&quot; padding=&quot;lg&quot;">
        <Panel as="section" aria-labelledby="lab-panel-h" padding="lg" className="w-full space-y-3">
          <SectionHeading id="lab-panel-h" title="Site" />
          <dl>
            <FactRow label="Domain">www.example.com</FactRow>
            <FactRow label="Languages">English, Italiano</FactRow>
          </dl>
        </Panel>
      </DemoBlock>
      <DemoBlock title="Muted" note="tone=&quot;muted&quot; — a quieter box.">
        <Panel tone="muted" className="w-full">
          <p className="text-[0.9375rem]">Nothing scheduled this week.</p>
        </Panel>
      </DemoBlock>
    </DemoStack>
  )
}
