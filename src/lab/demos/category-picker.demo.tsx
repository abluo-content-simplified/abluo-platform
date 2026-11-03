'use client'

import { useMemo, useState } from 'react'
import { CategoryPicker } from '@/components/app/ui/CategoryPicker'
import type { CategoryAssignment, CategoryNode } from '@/lib/modules/catalogue/taxonomy/types'
import { DemoBlock, DemoStack } from '../demo-kit'
import { DEMO_NODES, DEMO_PATH_CONTEXT, demoTree } from './catalogue-demo-fixtures'

export default function CategoryPickerDemo() {
  const [nodes, setNodes] = useState<CategoryNode[]>(DEMO_NODES)
  const tree = useMemo(() => demoTree(nodes), [nodes])
  const [value, setValue] = useState<CategoryAssignment>({ primary: 'bianche', additional: ['desserts'] })
  const [inline, setInline] = useState<CategoryAssignment>({ primary: null, additional: [] })
  // In memory, like CatalogueTaxonomyService would (no backend in the Lab).
  const onCreate = async ({ parentKey, label }: { parentKey: string | null; label: string }) => {
    const key = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${nodes.length}`
    setNodes((ns) => [...ns, { key, label: { en: label }, parentKey, order: 99_000, channelRules: {}, defaultOptionListIds: [], archivedAt: null }])
    return { ok: true as const, key }
  }
  return (
    <DemoStack>
      <DemoBlock title="Sheet (item editor)" note="Search “pizza bia” or “Food › Pasta”, tick several, make one primary, add a category inline with a parent. A bottom sheet on phones.">
        <div className="w-full max-w-xl">
          <CategoryPicker label="Categories" tree={tree} pathContext={DEMO_PATH_CONTEXT} value={value} onChange={setValue} onCreate={onCreate} />
        </div>
      </DemoBlock>
      <DemoBlock title="Inline (wizard step), no permission to create" note="createDisabledReason replaces the add action; the primary-required error is passed in.">
        <div className="w-full max-w-xl">
          <CategoryPicker
            label="Categories"
            presentation="inline"
            tree={tree}
            pathContext={DEMO_PATH_CONTEXT}
            value={inline}
            onChange={setInline}
            createDisabledReason="Only people who can edit categories can add one."
            error={inline.primary ? undefined : 'Choose a primary category to publish (a draft saves without one).'}
          />
        </div>
      </DemoBlock>
    </DemoStack>
  )
}
