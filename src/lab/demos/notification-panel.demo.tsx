'use client'

import { useRef, useState } from 'react'
import { APP_ICONS } from '@/components/app/shell/AppIcon'
import { Button } from '@/components/app/ui/Button'
import { NotificationPanel, type NotificationPanelItem } from '@/components/app/ui/NotificationPanel'
import { DemoBlock, DemoStack } from '../demo-kit'

const ITEMS: NotificationPanelItem[] = [
  { id: '1', href: '#', icon: APP_ICONS.messages, text: 'New message from Tom · Abluo: Your Digital Card', meta: 'Studio Hoffmann · 10 Nov, 14:32', unread: true },
  { id: '2', href: '#', icon: APP_ICONS.support, text: 'Abluo Support replied to your request ABL-000124', meta: 'Studio Hoffmann · 9 Nov, 09:10', unread: false },
  { id: '3', href: '#', icon: APP_ICONS.bell, text: 'Abluo asks you to confirm an announcement', meta: '8 Nov, 18:05', unread: false },
]
const LABELS = { title: 'Notifications', empty: 'Nothing new.', markAll: 'Mark All as Read', error: 'Notifications couldn’t be loaded.', retry: 'Try again', unread: 'Unread' }

export default function NotificationPanelDemo() {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('ready')
  const [items, setItems] = useState(ITEMS)
  return (
    <DemoStack>
      <DemoBlock title="Popover on computers, bottom sheet on phones" note="Props: open, anchor (the bell), onClose, items ({ id, href, icon, text, meta, unread }), state (loading | ready | error), labels, onMarkAll?, onRetry?, onItem?. Everything arrives worded.">
        <div className="flex flex-wrap items-start gap-2">
          <Button ref={ref} onClick={() => setOpen((o) => !o)}>
            Open panel
          </Button>
          <Button variant="quiet" onClick={() => setState('loading')}>Loading</Button>
          <Button variant="quiet" onClick={() => setState('error')}>Error</Button>
          <Button variant="quiet" onClick={() => { setState('ready'); setItems(ITEMS) }}>Ready</Button>
          <Button variant="quiet" onClick={() => { setState('ready'); setItems([]) }}>Empty</Button>
        </div>
        <NotificationPanel
          open={open}
          anchor={ref.current}
          onClose={() => setOpen(false)}
          items={items}
          state={state}
          labels={LABELS}
          onMarkAll={() => setItems((list) => list.map((i) => ({ ...i, unread: false })))}
          onRetry={() => setState('ready')}
        />
      </DemoBlock>
    </DemoStack>
  )
}
