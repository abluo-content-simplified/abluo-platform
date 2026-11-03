'use client'

import { useMemo, useState } from 'react'
import { TextInput } from '@/components/app/ui/TextInput'
import { TreeEditor } from '@/components/app/ui/TreeEditor'
import { Pill } from '@/components/app/ui/list/cells'
import type { CategoryNode } from '@/lib/modules/catalogue/taxonomy/types'
import { DemoBlock, DemoStack } from '../demo-kit'
import { DEMO_NODES, applyDemoMove, demoLabel, demoTree } from './catalogue-demo-fixtures'

function moveFlat(keys: string[], key: string, index: number): string[] {
  const rest = keys.filter((k) => k !== key)
  rest.splice(Math.max(0, Math.min(rest.length, index)), 0, key)
  return rest
}

export default function TreeEditorDemo() {
  const [nodes, setNodes] = useState<CategoryNode[]>(DEMO_NODES)
  const [renaming, setRenaming] = useState<string | null>(null)
  const tree = useMemo(() => demoTree(nodes), [nodes])
  const labelOf = demoLabel(tree)
  const [flatKeys, setFlatKeys] = useState(['New', 'House favourite', 'Spicy', 'Seasonal'])
  const flat = useMemo(() => demoTree(flatKeys.map((key, i) => ({ key, label: { en: key }, parentKey: null, order: (i + 1) * 1000, channelRules: {}, defaultOptionListIds: [], archivedAt: null }))), [flatKeys])
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
      <DemoBlock title="Order only (a flat list, or reorder without restructuring)" note="parentChangeDisabledReason: ↑ / ↓ still reorder; → / ← and drops into another row are refused with the reason.">
        <TreeEditor
          className="w-full max-w-xl"
          label="Tags"
          tree={flat}
          labelOf={(k) => k}
          onMove={(req) => setFlatKeys((ks) => moveFlat(ks, req.key, req.index ?? ks.length))}
          parentChangeDisabledReason="Tags have no levels: only their order can change."
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
