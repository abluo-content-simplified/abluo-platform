'use client'

import { useState } from 'react'
import { UseForField, labelsForUseFor } from '@/components/app/ui/UseForField'
import { Pill } from '@/components/app/ui/list/cells'
import { DemoBlock, DemoStack } from '../demo-kit'

const OPTIONS = [
  { value: 'food', label: 'Food or drink' },
  { value: 'book', label: 'Book' },
  { value: 'product', label: 'Other product' },
  { value: 'service', label: 'Service' },
]

export default function UseForFieldDemo() {
  const [shop, setShop] = useState<string[]>(['book', 'product'])
  const [tag, setTag] = useState<string[]>([])
  return (
    <DemoStack>
      <DemoBlock title="Top-level category" note="Shop → Book + Other product. The chips show the stored value.">
        <div className="w-full max-w-xl space-y-3">
          <UseForField legend="Use for" hint="Every category under it is used for the same item types." allLabel="All item types" options={OPTIONS} value={shop} onChange={setShop} />
          <div className="flex flex-wrap gap-1.5">
            {labelsForUseFor(shop, OPTIONS, 'All item types').map((l) => (
              <Pill key={l} tone="outline">
                {l}
              </Pill>
            ))}
          </div>
        </div>
      </DemoBlock>
      <DemoBlock title="Generic tag" note="Empty value = All item types.">
        <div className="w-full max-w-xl">
          <UseForField legend="Use for" allLabel="All item types" options={OPTIONS} value={tag} onChange={setTag} />
        </div>
      </DemoBlock>
      <DemoBlock title="Without the permission" note="disabledReason replaces the hint and disables the boxes.">
        <div className="w-full max-w-xl">
          <UseForField legend="Use for" allLabel="All item types" options={OPTIONS} value={['food']} onChange={() => undefined} disabledReason="Changing “Use for” needs Catalogue Setup." />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
