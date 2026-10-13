import { describe, it, expect } from 'vitest'
import {
  readingOrder,
  childrenOf,
  subtreeOf,
  isDescendant,
  canReparent,
  moveSection,
  removeSection,
  treeIssues,
  maxDepth,
  type SectionNode,
} from '../sections'

type S = SectionNode & { name?: string }
const s = (key: string, parentKey?: string | null): S => ({ _key: key, parentKey })
const keys = (list: readonly SectionNode[]) => list.map((x) => x._key)

// Pizza → Classiche, Bianche · Dalla Griglia — the shape the module exists for.
const menu: S[] = [
  s('antipasti'),
  s('pizza'),
  s('classiche', 'pizza'),
  s('bianche', 'pizza'),
  s('griglia'),
]

describe('readingOrder', () => {
  it('walks parents before children, preserving sibling order', () => {
    expect(keys(readingOrder(menu).order)).toEqual([
      'antipasti',
      'pizza',
      'classiche',
      'bianche',
      'griglia',
    ])
  })

  it('reports depth per section', () => {
    const { depth } = readingOrder(menu)
    expect(depth.get('pizza')).toBe(0)
    expect(depth.get('classiche')).toBe(1)
  })

  it('imposes no depth limit — D6 caps the editor, not the model', () => {
    const deep = [s('a'), s('b', 'a'), s('c', 'b'), s('d', 'c'), s('e', 'd')]
    expect(keys(readingOrder(deep).order)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(maxDepth(deep)).toBe(4)
  })

  it('is empty-safe', () => {
    expect(readingOrder([]).order).toEqual([])
    expect(maxDepth([])).toBe(0)
  })
})

describe('readingOrder — fail-visible recovery (A7)', () => {
  it('promotes an orphan to a recovery root rather than hiding it', () => {
    const broken = [s('antipasti'), s('classiche', 'deleted-pizza'), s('griglia')]
    const { order, recovered, issues } = readingOrder(broken)
    expect(keys(order)).toEqual(['antipasti', 'classiche', 'griglia'])
    expect(recovered).toEqual(['classiche'])
    expect(issues).toEqual([
      { kind: 'missingParent', key: 'classiche', parentKey: 'deleted-pizza' },
    ])
  })

  it('keeps an orphan’s own descendants beneath it', () => {
    const broken = [s('orphan', 'gone'), s('child', 'orphan'), s('grandchild', 'child')]
    const { order, depth } = readingOrder(broken)
    expect(keys(order)).toEqual(['orphan', 'child', 'grandchild'])
    expect(depth.get('child')).toBe(1)
    expect(depth.get('grandchild')).toBe(2)
  })

  it('never rewrites the stored parentKey — recovery is read-time only', () => {
    const broken = [s('orphan', 'gone')]
    readingOrder(broken)
    expect(broken[0].parentKey).toBe('gone')
  })

  it('preserves relative order when several orphans are recovered', () => {
    const broken = [s('b', 'gone'), s('a'), s('c', 'gone')]
    expect(keys(readingOrder(broken).order)).toEqual(['b', 'a', 'c'])
  })

  it('reports duplicate keys and keeps the first occurrence', () => {
    const dup = [s('a'), s('a'), s('b')]
    const { order, issues } = readingOrder(dup)
    expect(keys(order)).toEqual(['a', 'b'])
    expect(issues).toContainEqual({ kind: 'duplicateKey', key: 'a' })
  })

  it('treats self-parenting as a cycle and still renders the section', () => {
    const selfish = [s('a'), s('loop', 'loop')]
    const { order, issues, recovered } = readingOrder(selfish)
    expect(keys(order)).toEqual(['a', 'loop'])
    expect(issues).toContainEqual({ kind: 'cycle', keys: ['loop'] })
    expect(recovered).toContain('loop')
  })

  it('renders a multi-node cycle flat, in source order, without looping', () => {
    const cyclic = [s('root'), s('x', 'z'), s('y', 'x'), s('z', 'y')]
    const { order, issues } = readingOrder(cyclic)
    expect(keys(order)).toEqual(['root', 'x', 'y', 'z'])
    expect(issues).toContainEqual({ kind: 'cycle', keys: ['x', 'y', 'z'] })
  })

  it('surfaces issues through treeIssues without needing the order', () => {
    expect(treeIssues([s('orphan', 'gone')])).toEqual([
      { kind: 'missingParent', key: 'orphan', parentKey: 'gone' },
    ])
    expect(treeIssues(menu)).toEqual([])
  })
})

describe('childrenOf / subtreeOf / isDescendant', () => {
  it('returns direct children only, in source order', () => {
    expect(keys(childrenOf(menu, 'pizza'))).toEqual(['classiche', 'bianche'])
    expect(childrenOf(menu, 'antipasti')).toEqual([])
  })

  it('returns a section with everything beneath it', () => {
    expect(keys(subtreeOf(menu, 'pizza'))).toEqual(['pizza', 'classiche', 'bianche'])
    expect(subtreeOf(menu, 'nope')).toEqual([])
  })

  it('is cycle-safe', () => {
    const cyclic = [s('x', 'z'), s('y', 'x'), s('z', 'y')]
    expect(keys(subtreeOf(cyclic, 'x'))).toEqual(['x', 'y', 'z'])
  })

  it('answers ancestry including the node itself', () => {
    expect(isDescendant(menu, 'pizza', 'classiche')).toBe(true)
    expect(isDescendant(menu, 'pizza', 'pizza')).toBe(true)
    expect(isDescendant(menu, 'pizza', 'antipasti')).toBe(false)
  })
})

describe('canReparent', () => {
  it('allows a legitimate move and promotion to the top level', () => {
    expect(canReparent(menu, 'classiche', 'griglia')).toEqual({ ok: true })
    expect(canReparent(menu, 'classiche', null)).toEqual({ ok: true })
  })

  it('refuses moving a parent beneath its own descendant', () => {
    expect(canReparent(menu, 'pizza', 'classiche')).toEqual({ ok: false, reason: 'wouldCycle' })
  })

  it('refuses self-parenting', () => {
    expect(canReparent(menu, 'pizza', 'pizza')).toEqual({ ok: false, reason: 'wouldCycle' })
  })

  it('refuses unknown sections and unknown parents', () => {
    expect(canReparent(menu, 'nope', null)).toEqual({ ok: false, reason: 'unknownSection' })
    expect(canReparent(menu, 'pizza', 'nope')).toEqual({ ok: false, reason: 'unknownParent' })
  })
})

describe('moveSection', () => {
  it('moves a whole subtree as one block, never separating descendants', () => {
    const { sections, moved } = moveSection(menu, 'pizza', { beforeKey: 'antipasti' })
    expect(moved).toBe(true)
    expect(keys(sections)).toEqual(['pizza', 'classiche', 'bianche', 'antipasti', 'griglia'])
  })

  it('preserves the order of everything it did not move', () => {
    const { sections } = moveSection(menu, 'griglia', { beforeKey: 'pizza' })
    expect(keys(sections)).toEqual(['antipasti', 'griglia', 'pizza', 'classiche', 'bianche'])
  })

  it('reparents and relocates in one step', () => {
    const { sections } = moveSection(menu, 'bianche', { parentKey: 'griglia', beforeKey: null })
    expect(keys(sections)).toEqual(['antipasti', 'pizza', 'classiche', 'griglia', 'bianche'])
    expect(sections.find((x) => x._key === 'bianche')?.parentKey).toBe('griglia')
  })

  it('promotes to the top level when parentKey is null', () => {
    const { sections } = moveSection(menu, 'classiche', { parentKey: null })
    expect(sections.find((x) => x._key === 'classiche')?.parentKey).toBeUndefined()
  })

  it('appends when beforeKey is null', () => {
    const { sections } = moveSection(menu, 'antipasti', { beforeKey: null })
    expect(keys(sections)).toEqual(['pizza', 'classiche', 'bianche', 'griglia', 'antipasti'])
  })

  it('refuses a cycle and returns the input unchanged', () => {
    const { sections, moved, reason } = moveSection(menu, 'pizza', { parentKey: 'classiche' })
    expect(moved).toBe(false)
    expect(reason).toBe('wouldCycle')
    expect(keys(sections)).toEqual(keys(menu))
  })

  it('refuses an unknown section', () => {
    expect(moveSection(menu, 'nope', {}).reason).toBe('unknownSection')
  })
})

describe('removeSection', () => {
  it('removes the section and every descendant, returning both halves', () => {
    const { sections, removed } = removeSection(menu, 'pizza')
    expect(keys(sections)).toEqual(['antipasti', 'griglia'])
    expect(keys(removed)).toEqual(['pizza', 'classiche', 'bianche'])
  })

  it('returns the removed rows so an undo can put them back', () => {
    const { sections, removed } = removeSection(menu, 'pizza')
    const restored = [...sections.slice(0, 1), ...removed, ...sections.slice(1)]
    expect(keys(restored)).toEqual(keys(menu))
  })

  it('removes a leaf without touching its siblings', () => {
    const { sections, removed } = removeSection(menu, 'bianche')
    expect(keys(removed)).toEqual(['bianche'])
    expect(keys(sections)).toEqual(['antipasti', 'pizza', 'classiche', 'griglia'])
  })

  it('is a no-op for an unknown key', () => {
    const { sections, removed } = removeSection(menu, 'nope')
    expect(removed).toEqual([])
    expect(keys(sections)).toEqual(keys(menu))
  })

  it('leaves no orphan behind — the defect this module exists to prevent', () => {
    const { sections } = removeSection(menu, 'pizza')
    expect(treeIssues(sections)).toEqual([])
  })
})
