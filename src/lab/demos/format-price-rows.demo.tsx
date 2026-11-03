'use client'

import { useState } from 'react'
import { FormatPriceRows } from '@/components/app/ui/FormatPriceRows'
import { TextInput } from '@/components/app/ui/TextInput'
import { IMPLICIT_FORMAT_KEY } from '@/lib/modules/catalogue/commerce/format-key'
import { asChannelKey, asFormatKey } from '@/lib/modules/catalogue/commerce/commerce-types'
import type { Format } from '@/lib/modules/catalogue/commerce/formats'
import { DemoBlock, DemoStack } from '../demo-kit'

const CHANNELS = [
  { key: asChannelKey('dine-in'), label: 'Dine-in' },
  { key: asChannelKey('delivery'), label: 'Delivery' },
]
const base = { identifiers: {}, quantity: null, templateKey: null, availability: new Map() }
const SIMPLE: Format[] = [{ ...base, key: IMPLICIT_FORMAT_KEY, label: null, implicit: true, prices: [{ key: 'p1', scope: null, amount: 12, note: null, windows: [] }] }]
const SIZES: Format[] = [
  { ...base, key: asFormatKey('small'), label: { en: 'Small' }, implicit: false, prices: [{ key: 's1', scope: null, amount: 8.5, note: null, windows: [] }] },
  {
    ...base,
    key: asFormatKey('large'),
    label: { en: 'Large' },
    implicit: false,
    quantity: { value: 50, unit: 'cl' },
    prices: [
      { key: 'l1', scope: null, amount: 12, note: null, windows: [] },
      { key: 'l2', scope: asChannelKey('delivery'), amount: 13.5, note: null, windows: [{ days: [], from: '18:00', to: '23:00' }] },
    ],
  },
]

const labelText = (f: Format) => (f.label && typeof f.label === 'object' ? (f.label.en ?? '') : (f.label ?? ''))

export default function FormatPriceRowsDemo() {
  const [simple, setSimple] = useState<Format[]>(SIMPLE)
  const [sizes, setSizes] = useState<Format[]>(SIZES)
  const nameInput = ({ format, id, invalid, onChange }: { format: Format; id: string; invalid: boolean; onChange: (l: Record<string, string>) => void }) => (
    <TextInput id={id} aria-invalid={invalid || undefined} value={labelText(format)} onChange={(e) => onChange({ en: e.target.value })} />
  )
  return (
    <DemoStack>
      <DemoBlock title="One implicit format" note="One plain Price field; Add another size or format reveals named rows. A real screen passes its localized (multi-language) name field.">
        <div className="w-full max-w-xl">
          <FormatPriceRows formats={simple} onChange={setSimple} currency="EUR" channels={CHANNELS} renderLabelInput={nameInput} formatLabelText={labelText} />
        </div>
      </DemoBlock>
      <DemoBlock title="Sizes with a channel price window" note="Large has a Delivery price 18:00–23:00; codes and quantity sit behind a disclosure; rows reorder by drag or ↑ / ↓ on the grip.">
        <div className="w-full max-w-xl">
          <FormatPriceRows
            formats={sizes}
            onChange={setSizes}
            currency="GBP"
            channels={CHANNELS}
            renderLabelInput={nameInput}
            formatLabelText={labelText}
            issues={sizes.filter((f) => !labelText(f)).map((f) => ({ code: 'format.labelRequired', level: 'error' as const, formatKey: f.key }))}
          />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
