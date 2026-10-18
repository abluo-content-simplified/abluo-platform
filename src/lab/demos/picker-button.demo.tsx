'use client'

import { useState } from 'react'
import { PickerOption, PickerTrigger } from '@/components/app/ui/PickerButton'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { DemoBlock, DemoStack } from '../demo-kit'

const SITES = [
  { id: 'tmz', name: 'TMZ', url: 'tmz.it' },
  { id: 'livener', name: 'Livener', url: 'livener.com' },
]

export default function PickerButtonDemo() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('tmz')
  const site = SITES.find((s) => s.id === current)!
  return (
    <DemoStack>
      <DemoBlock title="Project switcher" note="PickerTrigger (secondary line) opens a sheet of PickerOption rows (current ticked).">
        <div className="w-full max-w-xs">
          <PickerTrigger secondary={site.url} onClick={() => setOpen(true)}>
            {site.name}
          </PickerTrigger>
        </div>
        <BottomSheet open={open} title="Switch project" onClose={() => setOpen(false)}>
          {SITES.map((s) => (
            <PickerOption
              key={s.id}
              current={s.id === current}
              secondary={s.url}
              onClick={() => {
                setCurrent(s.id)
                setOpen(false)
              }}
            >
              {s.name}
            </PickerOption>
          ))}
        </BottomSheet>
      </DemoBlock>
    </DemoStack>
  )
}
