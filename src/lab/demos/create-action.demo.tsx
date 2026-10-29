'use client'

import { CreateAction } from '@/components/app/ui/CreateAction'
import { Button } from '@/components/app/ui/Button'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function CreateActionDemo() {
  return (
    <DemoStack>
      <DemoBlock title="Header create button" note="Visible from iPad width (md) up; on phones it disappears because the tab bar's + is the create button. Narrow the window to see it go.">
        <CreateAction>
          <Button variant="primary">New post</Button>
        </CreateAction>
      </DemoBlock>
    </DemoStack>
  )
}
