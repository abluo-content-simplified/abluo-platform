'use client'

import { useState } from 'react'
import { AutoGrid, type AutoGridDensity } from '@/components/app/ui/list/AutoGrid'
import { MediaFrame } from '@/components/app/ui/list/cells'
import { FilterSegmented } from '@/components/app/ui/FilterBar'
import { DemoBlock, DemoStack } from '../demo-kit'

const TILES = Array.from({ length: 12 }, (_, i) => `Photo ${i + 1}`)

export default function AutoGridDemo() {
  const [density, setDensity] = useState<AutoGridDensity>('medium')
  return (
    <DemoStack>
      <DemoBlock title="Density" note="density small / medium / large and label. Tiles are li children with an empty MediaFrame.">
        <FilterSegmented
          label="Density"
          value={density}
          onChange={(v) => setDensity(v as AutoGridDensity)}
          options={[
            { value: 'small', label: 'Small' },
            { value: 'medium', label: 'Medium' },
            { value: 'large', label: 'Large' },
          ]}
        />
        <div className="w-full">
          <AutoGrid density={density} label="Photos">
            {TILES.map((t) => (
              <li key={t}>
                <MediaFrame src={null} className="aspect-square w-full rounded-lg" />
                <span className="sr-only">{t}</span>
              </li>
            ))}
          </AutoGrid>
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
