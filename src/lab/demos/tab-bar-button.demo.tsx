'use client'

import { TabBarButton } from '@/components/app/ui/TabBarButton'
import { DemoBlock, DemoStack } from '../demo-kit'

const DOTS = 'M5 12h.01M12 12h.01M19 12h.01'
const PLUS = 'M12 5v14M5 12h14'

export default function TabBarButtonDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Phone tab bar" note='icon (an SVG path), active, appearance="add" for the raised +.'>
        <div className="grid w-full max-w-sm grid-cols-3 items-end border-t border-border pt-2">
          <TabBarButton icon={DOTS}>More</TabBarButton>
          <TabBarButton icon={PLUS} appearance="add" aria-label="Add content" />
          <TabBarButton icon={DOTS} active>
            Active
          </TabBarButton>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
