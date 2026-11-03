'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { validateMove } from '@/lib/modules/catalogue/taxonomy/tree'
import type { CategoryKey, CategoryTree, MoveIssueCode, MovePlan, MoveRequest } from '@/lib/modules/catalogue/taxonomy/types'
import { IconButton } from './Button'
import { CardMenu, type CardMenuItem } from './CardMenu'
import { DragGrip, DropLine } from './DragGrip'
import { usePointerDrag } from './use-pointer-drag'
import { dropRequest, fullPath, parentOf, positionOf, stepRequest, type TreeMoveAction, type TreeMoveBlocked } from './tree-model'

export { fullPath } from './tree-model'

export type TreeEditorProps = {
  /** Accessible name of the whole list, e.g. "Categories". */
  label: string
  /** C1 tree (buildTree). Sibling order is the display order. */
  tree: CategoryTree
  /** A node's label in the viewer's language (C1 pathOf segment). */
  labelOf: (key: CategoryKey) => string
  /** Called with a move that passed `validate`. The caller saves it (CatalogueTaxonomyService) and passes the new tree back. */
  onMove: (request: MoveRequest) => void
  /** Checks a move before it is offered to onMove. Default: C1 `validateMove(tree, request)` (cycle-safe). */
  validate?: (request: MoveRequest) => MovePlan
  /** false hides the grips and move actions (while searching, or without permission). Default true. */
  reorderable?: boolean
  /** Why reordering is off — shown above the list (disabled actions say why). */
  reorderDisabledReason?: string
  /**
   * Reordering among siblings only: moving into or out of another parent is off, and this is
   * why (shown above the list, announced on → / ← and on a drop into another parent). A flat
   * list (tags, channels) or a permission that may reorder but not restructure.
   */
  parentChangeDisabledReason?: string
  /** Keys whose children are hidden. Omitted = the editor keeps its own state (everything open). */
  collapsed?: ReadonlySet<CategoryKey>
  onCollapsedChange?: (next: Set<CategoryKey>) => void
  /** The key being renamed; its label is replaced by `renderRename(key)` (e.g. a TextInput with Save / Cancel). */
  renamingKey?: CategoryKey | null
  renderRename?: (key: CategoryKey) => ReactNode
  /** A second line under the label (item count, archived pill, channel rules). */
  renderMeta?: (key: CategoryKey) => ReactNode
  /** Show the full path under each label ("Food › Pizza"). */
  showPaths?: boolean
  /** Extra items in the row's ⋯ menu (Rename, Archive, Delete…), after the move items. */
  menuItems?: (key: CategoryKey) => CardMenuItem[]
  /** Controls at the end of the row, before the ⋯ menu. */
  renderActions?: (key: CategoryKey) => ReactNode
  className?: string
}

type Pending = { key: CategoryKey; focus: boolean }

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`transition-transform duration-200 motion-reduce:transition-none ${open ? 'rotate-90' : ''}`}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

/**
 * A nested, ordered list (the category tree). Reorder and re-parent by
 * dragging the ⋮⋮ grip (mouse or finger; a drop lands beside the row it is
 * over, in that row's parent), with the keyboard on the grip (↑ / ↓ reorder,
 * → moves into the category above, ← moves out of its parent), or from the
 * row's ⋯ menu (phones, no hover needed). Every move is checked with C1
 * `validateMove` first: a node can never go into its own sub-category; a
 * refused move is announced and nothing is called. After a move the grip
 * keeps focus and the new place is announced. Rows: collapse / expand,
 * an inline rename slot, a meta line, extra menu items and actions.
 * Pure UI: tree in, onMove out.
 */
export function TreeEditor({
  label,
  tree,
  labelOf,
  onMove,
  validate,
  reorderable = true,
  reorderDisabledReason,
  parentChangeDisabledReason,
  collapsed: collapsedProp,
  onCollapsedChange,
  renamingKey = null,
  renderRename,
  renderMeta,
  showPaths = false,
  menuItems,
  renderActions,
  className = '',
}: TreeEditorProps) {
  const t = useTranslations('app.ui.tree')
  const idBase = useId()
  const [ownCollapsed, setOwnCollapsed] = useState<Set<CategoryKey>>(() => new Set())
  const collapsed = collapsedProp ?? ownCollapsed
  const setCollapsed = (next: Set<CategoryKey>) => (onCollapsedChange ? onCollapsedChange(next) : setOwnCollapsed(next))
  const [message, setMessage] = useState('')
  const pending = useRef<Pending | null>(null)
  const grips = useRef(new Map<CategoryKey, HTMLElement>())
  const check = validate ?? ((r: MoveRequest) => validateMove(tree, r))

  const placeText = (key: CategoryKey, tr: CategoryTree) => {
    const { position, total } = positionOf(tr, key)
    const p = parentOf(tr, key)
    return p === null ? t('placeTop', { position, total }) : t('placeIn', { position, total, parent: labelOf(p) })
  }

  // After the caller passes the moved tree back: announce the new place and give focus back to the grip.
  useEffect(() => {
    const p = pending.current
    if (!p || !tree.nodes.has(p.key)) return
    pending.current = null
    setMessage(t('moved', { name: labelOf(p.key), place: placeText(p.key, tree) }))
    if (p.focus) grips.current.get(p.key)?.querySelector('button')?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree])

  const refusal = (code: MoveIssueCode, req: MoveRequest) => {
    const name = labelOf(req.key)
    const parent = req.newParentKey ? labelOf(req.newParentKey) : ''
    switch (code) {
      case 'category_cycle':
        return t('refusedCycle', { name, parent })
      case 'category_depth_exceeded':
        return t('refusedDepth', { name })
      case 'category_archived_parent':
        return t('refusedArchived', { name, parent })
      default:
        return t('refusedUnknown')
    }
  }
  const blockedText = (b: TreeMoveBlocked, key: CategoryKey) => t(`blocked.${b}`, { name: labelOf(key) })

  function attempt(req: MoveRequest, focus: boolean) {
    if (parentChangeDisabledReason && req.newParentKey !== parentOf(tree, req.key)) {
      setMessage(parentChangeDisabledReason)
      return false
    }
    const plan = check(req)
    if (!plan.ok) {
      setMessage(refusal(plan.code, req))
      return false
    }
    if (req.newParentKey && collapsed.has(req.newParentKey)) {
      const next = new Set(collapsed)
      next.delete(req.newParentKey)
      setCollapsed(next)
    }
    pending.current = { key: req.key, focus }
    onMove(req)
    return true
  }
  function step(key: CategoryKey, action: TreeMoveAction, focus: boolean) {
    const r = stepRequest(tree, key, action)
    if (!r.ok) return setMessage(blockedText(r.blocked, key))
    attempt(r.request, focus)
  }

  const drag = usePointerDrag((key, over) => {
    const req = dropRequest(tree, key, over)
    if (req) attempt(req, true)
  })

  const KEY_ACTION: Record<string, TreeMoveAction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowRight: 'indent', ArrowLeft: 'outdent' }

  function renderLevel(keys: readonly CategoryKey[], depth: number, listId?: string): ReactNode {
    return (
      <ul id={listId} aria-label={depth === 0 ? label : undefined} className={depth === 0 ? 'flex flex-col gap-2' : 'mt-2 flex flex-col gap-2 border-l border-border pl-3 sm:pl-5'}>
        {keys.map((key) => {
          const name = labelOf(key)
          const kids = tree.childrenOf.get(key) ?? []
          const open = !collapsed.has(key)
          const { position, total } = positionOf(tree, key)
          const childrenId = `${idBase}-${key}-children`
          const grip = drag.gripProps(key)
          const gripWithKeys = {
            ...grip,
            onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
              grip.onKeyDown(e)
              const action = KEY_ACTION[e.key]
              if (!action || e.altKey || e.ctrlKey || e.metaKey) return
              e.preventDefault()
              step(key, action, true)
            },
          }
          const moves: CardMenuItem[] = reorderable
            ? (parentChangeDisabledReason ? (['up', 'down'] as const) : (['up', 'down', 'indent', 'outdent'] as const)).flatMap((action) => {
                const r = stepRequest(tree, key, action)
                if (!r.ok) return []
                const target = r.request.newParentKey
                const itemLabel =
                  action === 'up' ? t('moveUp') : action === 'down' ? t('moveDown') : action === 'indent' ? t('moveInto', { parent: labelOf(target!) }) : target === null ? t('moveToTop') : t('moveInto', { parent: labelOf(target) })
                return [{ key: `move-${action}`, label: itemLabel, onSelect: () => step(key, action, false) }]
              })
            : []
          const extra = menuItems?.(key) ?? []
          const items = [...moves, ...extra.map((it, i) => (i === 0 && moves.length ? { ...it, separated: true } : it))]
          return (
            <li key={key}>
              <div
                {...drag.rowProps(key)}
                className={`relative flex items-start gap-1 rounded-xl border border-border bg-card p-1 ${drag.dragging === key ? 'opacity-50' : ''}`}
              >
                <DropLine edge={drag.edge(key)} />
                {reorderable ? (
                  <span
                    ref={(el) => {
                      if (el) grips.current.set(key, el)
                      else grips.current.delete(key)
                    }}
                    className="shrink-0"
                  >
                    <DragGrip label={t('grip', { name, position, total, level: depth + 1 })} drag={gripWithKeys} />
                  </span>
                ) : null}
                {kids.length ? (
                  <IconButton
                    aria-label={open ? t('collapse', { name }) : t('expand', { name })}
                    aria-expanded={open}
                    aria-controls={childrenId}
                    onClick={() => {
                      const next = new Set(collapsed)
                      if (open) next.add(key)
                      else next.delete(key)
                      setCollapsed(next)
                    }}
                    className="shrink-0"
                  >
                    <ChevronIcon open={open} />
                  </IconButton>
                ) : (
                  <span aria-hidden="true" className="size-11 shrink-0" />
                )}
                <div className="min-w-0 flex-1 py-2.5">
                  {renamingKey === key && renderRename ? (
                    renderRename(key)
                  ) : (
                    <p className="text-[0.9375rem] leading-6 font-medium break-words text-foreground">{name}</p>
                  )}
                  {showPaths && parentOf(tree, key) !== null ? <p className="text-sm break-words text-muted-foreground">{fullPath(tree, key, labelOf)}</p> : null}
                  {renderMeta ? renderMeta(key) : null}
                </div>
                {renderActions ? <div className="flex shrink-0 items-start gap-1">{renderActions(key)}</div> : null}
                <CardMenu label={t('moreFor', { name })} items={items} />
              </div>
              {kids.length ? (
                <div id={childrenId} hidden={!open}>
                  {open ? renderLevel(kids, depth + 1) : null}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div className={className}>
      {!reorderable && reorderDisabledReason ? <p className="mb-2 text-sm text-muted-foreground">{reorderDisabledReason}</p> : null}
      {reorderable && parentChangeDisabledReason ? <p className="mb-2 text-sm text-muted-foreground">{parentChangeDisabledReason}</p> : null}
      {reorderable ? <p className="sr-only">{parentChangeDisabledReason ? t('instructionsFlat') : t('instructions')}</p> : null}
      {renderLevel(tree.roots, 0)}
      <span role="status" aria-live="polite" className="sr-only">
        {message}
      </span>
    </div>
  )
}
