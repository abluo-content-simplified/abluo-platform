'use client'

import { useId, useMemo, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { MAX_ADDITIONAL_CATEGORIES } from '@/lib/modules/catalogue/taxonomy/limits'
import { pathOf, previewPath, searchCategories, treeOrder } from '@/lib/modules/catalogue/taxonomy/tree'
import type { CategoryAssignment, CategoryKey, CategoryTree, PathContext } from '@/lib/modules/catalogue/taxonomy/types'
import { BottomSheet } from './BottomSheet'
import { Button } from './Button'
import { Checkbox } from './Checkbox'
import { Chip } from './Chip'
import { FieldError, FieldLabel } from './FieldLabel'
import { Panel } from './Panel'
import { Select } from './Select'
import { TextInput } from './TextInput'
import { Pill } from './list/cells'

/** The result of creating a category inline (the caller runs CatalogueTaxonomyService). */
export type CategoryCreateResult = { ok: true; key: CategoryKey } | { ok: false; message: string }

export type CategoryPickerProps = {
  /** Field label, e.g. "Categories". */
  label: string
  /** Quiet text under the label. */
  hint?: string
  /** C1 tree (buildTree over the project's categories). */
  tree: CategoryTree
  /** Locale chain for labels and paths (C1 PathContext). */
  pathContext: PathContext
  /** The item's assignment: one primary + additional categories (C1). */
  value: CategoryAssignment
  onChange: (next: CategoryAssignment) => void
  /**
   * Inline "Add category": called with the chosen parent and the typed name;
   * the caller saves through CatalogueTaxonomyService and returns the new key
   * once the tree it passes back contains it. Omit to hide the action.
   */
  onCreate?: (input: { parentKey: CategoryKey | null; label: string }) => Promise<CategoryCreateResult>
  /** Shown instead of the add action when creating is not allowed (missing `taxonomy.write`). */
  createDisabledReason?: string
  /** sheet (default): a summary with a button that opens a bottom sheet (full width on phones). inline: the browser in place. */
  presentation?: 'sheet' | 'inline'
  /** An error to show under the field (e.g. "Choose a primary category to publish"). */
  error?: string
  /** Additional categories allowed (C1 limit). */
  maxAdditional?: number
}

/**
 * Choose an item's categories: search by name or full path ("pizza bia",
 * "Food › Pizza"), or browse the tree; tick several, one marked Primary
 * (the first ticked becomes primary; a clear "Primary" pill + pressed
 * toggle). Paths read "Food › Pizza › Bianche". Inline "Add category" asks
 * for a parent and previews the complete path before calling `onCreate`.
 * On phones the chooser is a bottom sheet. Search, paths and the preview are
 * C1 (`searchCategories`, `pathOf`, `previewPath`). Pure UI.
 */
export function CategoryPicker({
  label,
  hint,
  tree,
  pathContext,
  value,
  onChange,
  onCreate,
  createDisabledReason,
  presentation = 'sheet',
  error,
  maxAdditional = MAX_ADDITIONAL_CATEGORIES,
}: CategoryPickerProps) {
  const t = useTranslations('app.ui.categoryPicker')
  const id = useId()
  const [open, setOpen] = useState(false)
  const path = (k: CategoryKey) => pathOf(tree, k, pathContext)
  const selected = [value.primary, ...value.additional].filter((k): k is CategoryKey => k !== null)

  const summary = (
    <div className="min-w-0">
      {selected.length ? (
        <ul aria-label={t('selectedList')} className="flex flex-wrap items-start gap-2">
          {selected.map((k) => (
            <li key={k} className="flex max-w-full items-start gap-1.5 rounded-xl bg-muted px-3 py-2 text-sm text-foreground">
              <span className="min-w-0 break-words">{path(k).text || k}</span>
              {k === value.primary ? <Pill tone="highlight">{t('primary')}</Pill> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.9375rem] text-muted-foreground">{t('none')}</p>
      )}
    </div>
  )

  const browser = (
    <CategoryBrowser
      tree={tree}
      pathContext={pathContext}
      value={value}
      onChange={onChange}
      onCreate={onCreate}
      createDisabledReason={createDisabledReason}
      maxAdditional={maxAdditional}
    />
  )

  if (presentation === 'inline') {
    return (
      <div className="space-y-2">
        <FieldLabel as="p" id={`${id}-label`} hint={hint} hintId={hint ? `${id}-hint` : undefined}>
          {label}
        </FieldLabel>
        <div role="group" aria-labelledby={`${id}-label`}>
          {browser}
        </div>
        <FieldError>{error}</FieldError>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <FieldLabel as="p" id={`${id}-label`} hint={hint} hintId={hint ? `${id}-hint` : undefined}>
        {label}
      </FieldLabel>
      {summary}
      <Button variant="secondary" onClick={() => setOpen(true)} aria-describedby={`${id}-label`}>
        {selected.length ? t('change') : t('choose')}
      </Button>
      <FieldError>{error}</FieldError>
      <BottomSheet open={open} title={label} onClose={() => setOpen(false)} size="lg">
        {open ? browser : null}
        <Button variant="primary" size="lg" fullWidth className="mt-4" onClick={() => setOpen(false)}>
          {t('done')}
        </Button>
      </BottomSheet>
    </div>
  )
}

/** The search + tree + add form (inside the sheet, or inline). */
function CategoryBrowser({
  tree,
  pathContext,
  value,
  onChange,
  onCreate,
  createDisabledReason,
  maxAdditional,
}: Pick<CategoryPickerProps, 'tree' | 'pathContext' | 'value' | 'onChange' | 'onCreate' | 'createDisabledReason'> & { maxAdditional: number }) {
  const t = useTranslations('app.ui.categoryPicker')
  const id = useId()
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [status, setStatus] = useState('')
  const selected = new Set([value.primary, ...value.additional].filter((k): k is CategoryKey => k !== null))
  const path = (k: CategoryKey) => pathOf(tree, k, pathContext)

  const keys = useMemo(() => {
    const q = query.trim()
    if (q) return searchCategories(tree, q, pathContext)
    return treeOrder(tree).filter((k) => !tree.nodes.get(k)?.archivedAt || selected.has(k))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, query, pathContext, value])
  const searching = query.trim() !== ''
  const full = value.additional.length >= maxAdditional && value.primary !== null

  function toggle(k: CategoryKey, on: boolean) {
    if (on) {
      if (value.primary === null) onChange({ primary: k, additional: value.additional.filter((x) => x !== k) })
      else onChange({ primary: value.primary, additional: [...value.additional, k] })
      setStatus(t('added', { path: path(k).text }))
    } else if (k === value.primary) {
      const [next = null, ...rest] = value.additional
      onChange({ primary: next, additional: rest })
      setStatus(next ? t('removedPrimary', { path: path(k).text, next: path(next).text }) : t('removed', { path: path(k).text }))
    } else {
      onChange({ primary: value.primary, additional: value.additional.filter((x) => x !== k) })
      setStatus(t('removed', { path: path(k).text }))
    }
  }
  function makePrimary(k: CategoryKey) {
    if (k === value.primary) return
    const additional = value.additional.filter((x) => x !== k)
    if (value.primary !== null) additional.unshift(value.primary)
    onChange({ primary: k, additional })
    setStatus(t('nowPrimary', { path: path(k).text }))
  }

  return (
    <div className="space-y-3">
      <div>
        <FieldLabel htmlFor={`${id}-search`} hint={t('searchHint')} hintId={`${id}-search-hint`}>
          {t('search')}
        </FieldLabel>
        <TextInput id={`${id}-search`} type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-describedby={`${id}-search-hint`} autoComplete="off" />
      </div>
      <p className="text-sm text-muted-foreground">{t('primaryHint')}</p>
      {full ? <p className="text-sm text-muted-foreground">{t('limitReached', { limit: maxAdditional })}</p> : null}
      {keys.length ? (
        <ul aria-label={searching ? t('results') : t('all')} className="max-h-[50vh] overflow-y-auto">
          {keys.map((k) => {
            const p = path(k)
            const on = selected.has(k)
            const depth = searching ? 0 : (tree.depthOf.get(k) ?? 0)
            const archived = !!tree.nodes.get(k)?.archivedAt
            return (
              <li key={k} className="flex items-start gap-2 py-1" style={{ paddingLeft: `${Math.min(depth, 6) * 1.25}rem` }}>
                <Checkbox checked={on} disabled={!on && full} aria-label={t('select', { path: p.text })} onChange={(next) => toggle(k, next)} />
                <div className="min-w-0 flex-1 py-2.5">
                  <p className="text-[0.9375rem] leading-6 break-words text-foreground">{p.segments.at(-1) ?? k}</p>
                  {p.keys.length > 1 ? <p className="text-sm break-words text-muted-foreground">{p.text}</p> : null}
                  {archived ? <Pill>{t('archived')}</Pill> : null}
                </div>
                {on ? (
                  <Chip
                    selected={k === value.primary}
                    aria-label={k === value.primary ? t('isPrimary', { path: p.text }) : t('makePrimary', { path: p.text })}
                    onClick={() => makePrimary(k)}
                  >
                    {k === value.primary ? t('primary') : t('setPrimary')}
                  </Chip>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-[0.9375rem] text-muted-foreground">{searching ? t('noResults', { query: query.trim() }) : t('empty')}</p>
      )}

      {onCreate ? (
        adding ? (
          <AddCategoryForm
            tree={tree}
            pathContext={pathContext}
            initialLabel={query.trim().split(/\s*(?:›|>|\/)\s*/).filter(Boolean).at(-1) ?? ''}
            onCreate={onCreate}
            onCancel={() => setAdding(false)}
            onCreated={(key, text) => {
              setAdding(false)
              setQuery('')
              if (!selected.has(key)) {
                if (value.primary === null) onChange({ primary: key, additional: value.additional })
                else if (!full) onChange({ primary: value.primary, additional: [...value.additional, key] })
              }
              setStatus(t('created', { path: text }))
            }}
          />
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            {t('add')}
          </Button>
        )
      ) : createDisabledReason ? (
        <p className="text-sm text-muted-foreground">{createDisabledReason}</p>
      ) : null}
      <span role="status" aria-live="polite" className="sr-only">
        {status}
      </span>
    </div>
  )
}

function AddCategoryForm({
  tree,
  pathContext,
  initialLabel,
  onCreate,
  onCancel,
  onCreated,
}: {
  tree: CategoryTree
  pathContext: PathContext
  initialLabel: string
  onCreate: NonNullable<CategoryPickerProps['onCreate']>
  onCancel: () => void
  onCreated: (key: CategoryKey, pathText: string) => void
}): ReactNode {
  const t = useTranslations('app.ui.categoryPicker')
  const id = useId()
  const [name, setName] = useState(initialLabel)
  const [parent, setParent] = useState<CategoryKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const preview = previewPath(tree, parent, name, pathContext)
  const parents = treeOrder(tree).filter((k) => !tree.nodes.get(k)?.archivedAt)

  async function submit() {
    const label = name.trim()
    if (!label) return setError(t('nameRequired'))
    setBusy(true)
    setError(null)
    try {
      const r = await onCreate({ parentKey: parent, label })
      if (r.ok) onCreated(r.key, preview.text)
      else setError(r.message)
    } catch {
      setError(t('createError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel as="section" padding="md" tone="muted" aria-labelledby={`${id}-title`} className="space-y-3">
      <h3 id={`${id}-title`} className="text-[0.9375rem] font-semibold text-foreground">
        {t('addTitle')}
      </h3>
      <div>
        <FieldLabel htmlFor={`${id}-name`}>{t('name')}</FieldLabel>
        <TextInput id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={error === t('nameRequired') || undefined} />
      </div>
      <div>
        <FieldLabel htmlFor={`${id}-parent`}>{t('parent')}</FieldLabel>
        <Select id={`${id}-parent`} value={parent ?? ''} onChange={(e) => setParent(e.target.value || null)}>
          <option value="">{t('topLevel')}</option>
          {parents.map((k) => (
            <option key={k} value={k}>
              {pathOf(tree, k, pathContext).text}
            </option>
          ))}
        </Select>
      </div>
      <p aria-live="polite" className="text-[0.9375rem] leading-6 break-words text-foreground">
        {t('preview', { path: preview.text || '…' })}
      </p>
      <FieldError>{error}</FieldError>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button variant="primary" onClick={submit} disabled={busy} aria-busy={busy || undefined}>
          {busy ? t('creating') : t('create')}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </Panel>
  )
}
