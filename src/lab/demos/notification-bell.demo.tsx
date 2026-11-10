'use client'

import { useState } from 'react'
import { NotificationBell } from '@/components/app/ui/NotificationBell'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function NotificationBellDemo() {
  const [opened, setOpened] = useState(0)
  return (
    <DemoStack>
      <DemoBlock title="Three looks" note="Props: variant (field | rail | icon), label, count, countLabel, onOpen(anchor), expanded?, controls?. field sits beside the sidebar search, rail in the collapsed sidebar, icon in the phone top bar. No number at 0.">
        <div className="flex flex-wrap items-start gap-4">
          <NotificationBell variant="field" label="Notifications" count={3} countLabel="3 unread" onOpen={() => setOpened((n) => n + 1)} />
          <NotificationBell variant="rail" label="Notifications" count={3} countLabel="3 unread" onOpen={() => setOpened((n) => n + 1)} />
          <NotificationBell variant="icon" label="Notifications" count={0} countLabel="0 unread" onOpen={() => setOpened((n) => n + 1)} />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Opened {opened} times.</p>
      </DemoBlock>
    </DemoStack>
  )
}
