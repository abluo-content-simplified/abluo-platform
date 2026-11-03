'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { Field } from '@/components/app/ui/Field'
import { Notice } from '@/components/app/ui/Notice'
import { RadioList } from '@/components/app/ui/RadioList'
import { Select } from '@/components/app/ui/Select'
import { Skeleton } from '@/components/app/ui/Skeleton'
import { fullPath } from '@/components/app/ui/TreeEditor'
import { descendantsOf, treeOrder } from '@/lib/modules/catalogue/taxonomy/tree'
import type { DeletionPreview } from '@/lib/modules/catalogue/taxonomy/service'
import type { DeletionBlocker } from '@/lib/modules/catalogue/taxonomy/types'
import { deleteCatalogueCategoryAction, previewCatalogueCategoryDeletionAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/taxonomy-actions'
import { deletionNeeds, deletionOptions, labelText, type ChildrenChoice, type ItemsChoice } from './setup-model'
import type { TaxonomyScreen } from './taxonomy-context'

type Plan = NonNullable<DeletionPreview['plan']>

/**
 * Deleting a category (D-3): first the counted preview of what uses it (`deletionBlockers`).
 * Unused → one confirmation. In use → the person (with `setup.manage`) chooses where its items
 * and sub-categories go; the server previews that plan, then one confirmation runs it.
 * Something that can only be fixed by hand is named, and Delete stays disabled with the reason.
 */
export function CategoryDeleteSheet({ screen, categoryKey, onClose }: { screen: TaxonomyScreen; categoryKey: string | null; onClose: () => void }) {
  const t = useTranslations('catalogue.setup.delete')
  const { view, tree } = screen
  const [preview, setPreview] = useState<DeletionPreview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [items, setItems] = useState<ItemsChoice | null>(null)
  const [children, setChildren] = useState<ChildrenChoice | null>({ kind: 'parent' })
  const [itemsTo, setItemsTo] = useState('')
  const [childrenTo, setChildrenTo] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Another category: start over (choices and the preview belong to the one being deleted).
  const [shownKey, setShownKey] = useState(categoryKey)
  if (shownKey !== categoryKey) {
    setShownKey(categoryKey)
    setPreview(null)
    setLoadError(null)
    setItems(null)
    setChildren({ kind: 'parent' })
    setItemsTo('')
    setChildrenTo('')
    setPlan(null)
    setError(null)
  }

  useEffect(() => {
    if (!categoryKey) return
    let live = true
    void previewCatalogueCategoryDeletionAction({ projectSlug: screen.projectSlug, key: categoryKey }).then((r) => {
      if (!live) return
      if (r.ok) setPreview(r.preview)
      else setLoadError(screen.failText(r))
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryKey])

  if (!categoryKey) return <BottomSheet open={false} title="" onClose={onClose}>{null}</BottomSheet>
  const key = categoryKey
  const name = screen.categoryName(key)
  const blockers = preview?.blockers ?? []
  const needs = deletionNeeds(blockers)
  const needsSetup = preview?.route.capability === 'setup.manage'
  const blockedByPermission = needsSetup && !view.can.manage
  const excluded = new Set(descendantsOf(tree, key, { includeSelf: true }))
  const targets = treeOrder(tree).filter((k) => !excluded.has(k) && !tree.nodes.get(k)?.archivedAt)
  const itemsChoice: ItemsChoice | null = items?.kind === 'move' ? (itemsTo ? { kind: 'move', to: itemsTo } : null) : items
  const childrenChoice: ChildrenChoice | null = children?.kind === 'into' ? (childrenTo ? { kind: 'into', to: childrenTo } : null) : children
  const missingChoice = (needs.items > 0 && !itemsChoice) || (needs.children > 0 && !childrenChoice)
  const reason = !preview
    ? null
    : blockedByPermission
      ? t('needsSetup')
      : needs.manual.length > 0 || preview.route.resolvable === false
        ? t('fixFirst')
        : missingChoice
          ? t('chooseFirst')
          : null
  const options = deletionOptions(needs, itemsChoice, childrenChoice)

  const sentence = (b: DeletionBlocker) => {
    const sample = b.sample
      .slice(0, 3)
      .map((s) => ('name' in s ? s.name : labelText(s.label, view.defaultLocale, view.defaultLocale)))
      .filter(Boolean)
      .join(', ')
    const text = t(`blockers.${b.code}`, { count: b.count })
    return sample ? t('withSample', { text, sample }) : text
  }

  async function review() {
    setBusy(true)
    setError(null)
    const r = await previewCatalogueCategoryDeletionAction({ projectSlug: screen.projectSlug, key, ...options })
    setBusy(false)
    if (!r.ok) return setError(screen.failText(r))
    if (r.preview.plan && !r.preview.plan.ok) return setError(t('fixFirst'))
    setPlan(r.preview.plan ?? { ok: true, steps: [] })
  }

  async function run() {
    setBusy(true)
    const r = await deleteCatalogueCategoryAction({ projectSlug: screen.projectSlug, key, rev: view.rev, ...options })
    setBusy(false)
    if (!r.ok) {
      setError(screen.failText(r))
      setPlan(null)
      await screen.settle(r)
      return
    }
    setPlan(null)
    await screen.settle(r, (v) => t('done', { name, items: v.result.reassigned, children: v.result.childrenMoved }))
    onClose()
  }

  const steps = plan && plan.ok ? plan.steps.map((s) => t(`steps.${s.kind}`, { count: s.count })) : []

  return (
    <BottomSheet open title={t('title', { name })} onClose={onClose} size="lg">
      <div className="space-y-4">
        {loadError ? <Notice tone="error">{loadError}</Notice> : null}
        {!preview && !loadError ? <Skeleton className="h-24 w-full" /> : null}
        {preview && blockers.length === 0 ? <p className="text-[0.9375rem] leading-6">{t('unused', { name })}</p> : null}
        {preview && blockers.length > 0 ? (
          <>
            <p className="text-[0.9375rem] leading-6">{t('inUse', { name })}</p>
            <ul className="list-disc space-y-1 pl-5 text-[0.9375rem] leading-6">
              {blockers.map((b) => (
                <li key={`${b.code}-${b.sourceId ?? ''}`}>{sentence(b)}</li>
              ))}
            </ul>
            {blockedByPermission ? <Notice tone="info">{screen.failText({ ok: false, error: 'forbidden', capability: 'catalogue.setup.manage' })}</Notice> : null}
            {!blockedByPermission && needs.manual.length > 0 ? <Notice tone="error">{t('manual')}</Notice> : null}
            {!blockedByPermission && needs.items > 0 ? (
              <div className="space-y-2">
                <RadioList
                  legend={t('itemsLegend', { count: needs.items })}
                  name="delete-items"
                  value={items?.kind ?? null}
                  onChange={(v) => setItems(v === 'move' ? { kind: 'move', to: itemsTo } : { kind: 'remove' })}
                  options={[
                    { value: 'move', label: t('itemsMove'), disabled: targets.length === 0 },
                    { value: 'remove', label: t('itemsRemove'), description: t('itemsRemoveHint') },
                  ]}
                />
                {items?.kind === 'move' ? <TargetSelect label={t('itemsTarget')} value={itemsTo} onChange={setItemsTo} targets={targets} screen={screen} /> : null}
              </div>
            ) : null}
            {!blockedByPermission && needs.children > 0 ? (
              <div className="space-y-2">
                <RadioList
                  legend={t('childrenLegend', { count: needs.children })}
                  name="delete-children"
                  value={children?.kind ?? null}
                  onChange={(v) => setChildren(v === 'into' ? { kind: 'into', to: childrenTo } : v === 'top' ? { kind: 'top' } : { kind: 'parent' })}
                  options={[
                    { value: 'parent', label: t('childrenParent') },
                    { value: 'top', label: t('childrenTop') },
                    { value: 'into', label: t('childrenInto'), disabled: targets.length === 0 },
                  ]}
                />
                {children?.kind === 'into' ? <TargetSelect label={t('childrenTarget')} value={childrenTo} onChange={setChildrenTo} targets={targets} screen={screen} /> : null}
              </div>
            ) : null}
          </>
        ) : null}
        {error ? <Notice tone="error">{error}</Notice> : null}
        {preview ? (
          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button variant="destructive" disabled={busy || !!reason} onClick={() => void review()}>
              {t('delete')}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t('cancel')}
            </Button>
          </div>
        ) : null}
        {reason ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
      </div>
      <ConfirmDialog
        open={plan !== null}
        title={t('confirmTitle', { name })}
        body={steps.length ? t('confirmSteps', { steps: steps.join(' ') }) : t('confirmBody', { name })}
        confirmLabel={t('confirm')}
        busy={busy}
        error={error}
        onConfirm={() => void run()}
        onCancel={() => setPlan(null)}
      />
    </BottomSheet>
  )
}

function TargetSelect({ label, value, onChange, targets, screen }: { label: string; value: string; onChange: (v: string) => void; targets: string[]; screen: TaxonomyScreen }) {
  const t = useTranslations('catalogue.setup.delete')
  return (
    <Field label={label}>
      {(p) => (
        <Select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('chooseCategory')}</option>
          {targets.map((k) => (
            <option key={k} value={k}>
              {fullPath(screen.tree, k, screen.categoryName)}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )
}
