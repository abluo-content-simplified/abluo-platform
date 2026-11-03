'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { Field } from '@/components/app/ui/Field'
import { Select } from '@/components/app/ui/Select'
import { fullPath } from '@/components/app/ui/TreeEditor'
import { previewPath, treeOrder } from '@/lib/modules/catalogue/taxonomy/tree'
import { createCatalogueCategoryAction, createCatalogueTagAction, updateCatalogueCategoryAction, updateCatalogueTagAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/taxonomy-actions'
import { cleanLabels, labelPatch, labelsOf, type Labels } from './setup-model'
import { LabelFields } from './setup-ui'
import type { TaxonomyScreen } from './taxonomy-context'

export type NameSheetTarget =
  | { kind: 'category'; mode: 'add'; parentKey: string | null }
  | { kind: 'category'; mode: 'rename'; key: string }
  | { kind: 'tag'; mode: 'add' }
  | { kind: 'tag'; mode: 'rename'; key: string }

const TOP = '__top__'

/**
 * Add or rename (and translate) a category or a tag. A new category needs its place: Top level
 * or a parent, with the complete path previewed ("Food › Pizza › Bianche", C1.11). The name in
 * the main language is required; other languages are optional and can be added later.
 */
export function NameSheet({ screen, target, onClose }: { screen: TaxonomyScreen; target: NameSheetTarget | null; onClose: () => void }) {
  const t = useTranslations('catalogue.setup.names')
  const { view, tree } = screen
  const [labels, setLabels] = useState<Labels>({})
  const [parent, setParent] = useState<string>(TOP)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stored = target?.mode === 'rename' ? (target.kind === 'category' ? tree.nodes.get(target.key)?.label : view.tags.find((x) => x.key === target.key)?.label) : undefined
  // Opening the sheet for another target starts from that target's stored names.
  const [opened, setOpened] = useState<NameSheetTarget | null>(null)
  if (target !== opened) {
    setOpened(target)
    if (target) {
      setLabels(labelsOf(stored ?? {}, view.locales))
      setParent(target.kind === 'category' && target.mode === 'add' && target.parentKey ? target.parentKey : TOP)
      setError(null)
    }
  }

  if (!target) return <BottomSheet open={false} title="" onClose={onClose}>{null}</BottomSheet>

  const isCategory = target.kind === 'category'
  const title =
    target.mode === 'add' ? (isCategory ? t('addCategory') : t('addTag')) : t('renameTitle', { name: isCategory ? screen.categoryName(target.key) : screen.tagName(target.key) })
  const main = (labels[view.defaultLocale] ?? '').trim()
  const parentKey = parent === TOP ? null : parent
  const path = isCategory && target.mode === 'add' && main ? previewPath(tree, parentKey, main, screen.pathContext).text : null
  const before = labelsOf(stored ?? {}, view.locales)
  const unchanged = target.mode === 'rename' && Object.keys(labelPatch(before, labels)).length === 0
  const disabledReason = !main ? t('nameRequired') : unchanged ? t('nothingChanged') : null

  async function save() {
    if (!target || disabledReason) return
    setBusy(true)
    setError(null)
    const name = main
    let done: unknown = null
    if (target.kind === 'category' && target.mode === 'add') {
      const r = await createCatalogueCategoryAction({ projectSlug: screen.projectSlug, labels: cleanLabels(labels), parentKey, locale: view.defaultLocale })
      if (!r.ok) setError(screen.failText(r))
      else done = await screen.settle(r, (v) => (v.created ? t('categoryAdded', { path: v.path.text }) : t('categoryExists', { path: v.path.text })))
    } else if (target.kind === 'category' && target.mode === 'rename') {
      const r = await updateCatalogueCategoryAction({ projectSlug: screen.projectSlug, key: target.key, labels: labelPatch(before, labels), rev: view.rev, baseHashes: screen.baseHashes() })
      done = await screen.settle(r, t('saved', { name }))
    } else if (target.kind === 'tag' && target.mode === 'add') {
      const r = await createCatalogueTagAction({ projectSlug: screen.projectSlug, labels: cleanLabels(labels) })
      if (!r.ok) setError(screen.failText(r))
      else done = await screen.settle(r, (v) => (v.created ? t('tagAdded', { name }) : t('tagExists', { name })))
    } else if (target.kind === 'tag' && target.mode === 'rename') {
      const r = await updateCatalogueTagAction({ projectSlug: screen.projectSlug, key: target.key, labels: labelPatch(before, labels), rev: view.rev, baseHashes: screen.baseHashes() })
      done = await screen.settle(r, t('saved', { name }))
    }
    setBusy(false)
    if (done) onClose()
  }

  const parents = treeOrder(tree).filter((k) => !tree.nodes.get(k)?.archivedAt)

  return (
    <BottomSheet open title={title} onClose={onClose} size="lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        <LabelFields locales={view.locales} defaultLocale={view.defaultLocale} value={labels} onChange={setLabels} label={t('name')} error={error} />
        {isCategory && target.mode === 'add' ? (
          <Field label={t('place')} hint={path ? t('pathPreview', { path }) : t('placeHint')}>
            {(p) => (
              <Select {...p} value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value={TOP}>{t('topLevel')}</option>
                {parents.map((k) => (
                  <option key={k} value={k}>
                    {fullPath(tree, k, screen.categoryName)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="submit" variant="primary" disabled={busy || !!disabledReason}>
            {target.mode === 'add' ? t('add') : t('save')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
        </div>
        {disabledReason && !busy ? <p className="text-sm text-muted-foreground">{disabledReason}</p> : null}
      </form>
    </BottomSheet>
  )
}
