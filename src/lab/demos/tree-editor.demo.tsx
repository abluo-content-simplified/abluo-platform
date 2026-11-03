'use client'

import { useMemo, useState } from 'react'
import { TextInput } from '@/components/app/ui/TextInput'
import { TreeEditor } from '@/components/app/ui/TreeEditor'
import { Pill } from '@/components/app/ui/list/cells'
import type { CategoryNode } from '@/lib/modules/catalogue/taxonomy/types'
import { DemoBlock, DemoStack } from '../demo-kit'
import { DEMO_NODES, applyDemoMove, demoLabel, demoTree } from './catalogue-demo-fixtures'

export default function TreeEditorDemo() {
  const [nodes, setNodes] = useState<CategoryNode[]>(DEMO_NODES)
  const [renaming, setRenaming] = useState<string | null>(null)
  const tree = useMemo(() => demoTree(nodes), [nodes])
  const labelOf = demoLabel(tree)
  const rename = (key: string, label: string) => setNodes((ns) => ns.map((n) => (n.key === key ? { ...n, label: { en: label } } : n)))
  return (
    <DemoStack>
      <DemoBlock
        title="Category tree"
        note="Drag a grip onto another row, or focus a grip: ↑ / ↓ reorder, → moves into the category above, ← moves out. Try moving Food into Bianche: it is refused (its own sub-category). Nothing is saved."
      >
        <TreeEditor
          className="w-full max-w-xl"
          label="Categories"
          tree={tree}
          labelOf={labelOf}
          onMove={(req) => setNodes((ns) => applyDemoMove(ns, req))}
          renamingKey={renaming}
          renderRename={(key) => (
            <TextInput
              controlSize="md"
              flush
              aria-label={`Rename ${labelOf(key)}`}
              defaultValue={labelOf(key)}
              autoFocus
              onBlur={(e) => {
                rename(key, e.target.value.trim() || labelOf(key))
                setRenaming(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenaming(null)
              }}
            />
          )}
          renderMeta={(key) => (tree.nodes.get(key)?.archivedAt ? <Pill>Archived</Pill> : null)}
          menuItems={(key) => [{ key: 'rename', label: 'Rename', onSelect: () => setRenaming(key) }]}
        />
      </DemoBlock>
      <DemoBlock title="Read-only order (while searching)" note="reorderable={false} hides the grips and move items, and says why.">
        <TreeEditor
          className="w-full max-w-xl"
          label="Categories (read only)"
          tree={tree}
          labelOf={labelOf}
          onMove={() => undefined}
          reorderable={false}
          reorderDisabledReason="Clear the search to reorder categories."
          showPaths
        />
      </DemoBlock>
    </DemoStack>
  )
}
