'use client'

import { useState } from 'react'
import { Chip } from '@/components/app/ui/Chip'
import { DemoBlock, DemoStack } from '../demo-kit'

export default function ChipDemo() {
  const [tags, setTags] = useState(['breakfast', 'terrace'])
  const [filters, setFilters] = useState<string[]>(['summer'])
  const suggestions = ['vegan', 'kids'].filter((s) => !tags.includes(s))
  return (
    <DemoStack>
      <DemoBlock title="Removable tags" note="selected removable + aria-label naming what is removed">
        {tags.map((tag) => (
          <Chip key={tag} selected removable aria-label={`Remove ${tag}`} onClick={() => setTags((t) => t.filter((x) => x !== tag))}>
            {tag}
          </Chip>
        ))}
      </DemoBlock>
      <DemoBlock title="Suggestions" note="A plain chip is an action.">
        {suggestions.map((s) => (
          <Chip key={s} onClick={() => setTags((t) => [...t, s])}>
            + {s}
          </Chip>
        ))}
        {suggestions.length === 0 ? <span className="text-sm text-muted-foreground">All added.</span> : null}
      </DemoBlock>
      <DemoBlock title="On / off" note="selected={boolean} → aria-pressed. A whole group of choices is ToggleChips.">
        {['summer', 'winter'].map((f) => (
          <Chip key={f} selected={filters.includes(f)} onClick={() => setFilters((v) => (v.includes(f) ? v.filter((x) => x !== f) : [...v, f]))}>
            {f}
          </Chip>
        ))}
      </DemoBlock>
    </DemoStack>
  )
}
