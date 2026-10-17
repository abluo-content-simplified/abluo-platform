'use client'

import { useState } from 'react'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function SegmentedControlDemo() {
  const [tab, setTab] = useState<'items' | 'collections' | 'offers'>('items')
  const [filter, setFilter] = useState<'all' | 'published' | 'drafts'>('all')
  const [device, setDevice] = useState<'desktop' | 'phone'>('desktop')
  const [lang, setLang] = useState<'en' | 'it' | 'de'>('it')
  return (
    <DemoStack>
      <DemoBlock title="Solid — page tabs" note="Tab focuses the selected option; arrows move and select; Home/End jump.">
        <SegmentedControl
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'items', label: 'Items' },
            { value: 'collections', label: 'Collections' },
            { value: 'offers', label: 'Offers' },
          ]}
        />
      </DemoBlock>
      <DemoBlock title="Soft — filters">
        <SegmentedControl
          label="Status"
          appearance="soft"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All' },
            { value: 'published', label: 'Published' },
            { value: 'drafts', label: 'Drafts', disabled: true },
          ]}
        />
      </DemoBlock>
      <DemoBlock title="Pill — the Create flow's view switch" note="appearance=&quot;pill&quot;">
        <SegmentedControl label="Device" appearance="pill" value={device} onChange={setDevice} options={[{ value: 'desktop', label: 'Computer' }, { value: 'phone', label: 'Phone' }]} />
      </DemoBlock>
      <DemoBlock title="Chips — one choice among wrapping chips" note="appearance=&quot;chips&quot; (the Create flow's language picker)">
        <SegmentedControl label="Write in" appearance="chips" value={lang} onChange={setLang} options={[{ value: 'en', label: 'English' }, { value: 'it', label: 'Italiano' }, { value: 'de', label: 'Deutsch' }]} />
      </DemoBlock>
    </DemoStack>
  )
}
