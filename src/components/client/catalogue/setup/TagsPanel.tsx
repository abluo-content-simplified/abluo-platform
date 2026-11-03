'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { TextInput } from '@/components/app/ui/TextInput'
import { TreeEditor } from '@/components/app/ui/TreeEditor'
import { Pill } from '@/components/app/ui/list/cells'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { searchText } from '@/lib/client/search-text'
import { archiveCatalogueTagAction, deleteCatalogueTagAction, reorderCatalogueTagsAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/taxonomy-actions'
import { flatTree, missingLocales, reorderedList } from './setup-model'
import { useLanguageList } from './setup-ui'
import type { TaxonomyScreen } from './taxonomy-context'

/**
 * Tags (spec §10.3): one flat, ordered list — optional, never publication blockers, never
 * allergens. Add, rename / translate, reorder (drag, arrow keys or the ⋯ menu), archive and
 * delete, all with `catalogue.taxonomy.write`. A tag still on items can't be deleted; the
 * confirmation offers archiving instead.
 */
export function TagsPanel({ screen, onAdd, onRename }: { screen: TaxonomyScreen; onAdd: () => void; onRename: (key: string) => void }) {
  const t = useTranslations('catalogue.setup.tags')
  const { view } = screen
  const languages = useLanguageList()
  const [query, setQuery] = useState('')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const keys = view.tags.map((x) => x.key)
  const searching = query.trim() !== ''
  const shownKeys = useMemo(() => {
    if (!searching) return keys
    const q = searchText(query)
    return keys.filter((k) => searchText(Object.values(view.tags.find((x) => x.key === k)?.label ?? {}).join(' ')).includes(q))
  }, [keys, query, searching, view.tags])
  const tree = useMemo(() => flatTree(shownKeys), [shownKeys])
  const byKey = new Map(view.tags.map((x) => [x.key, x]))
  const target = confirm ? byKey.get(confirm) : undefined

  async function archive(key: string, archived: boolean) {
    const r = await archiveCatalogueTagAction({ projectSlug: screen.projectSlug, key, archived })
    await screen.settle(r, archived ? t('archivedDone', { name: screen.tagName(key) }) : t('restoredDone', { name: screen.tagName(key) }))
  }

  async function confirmed() {
    if (!target) return
    setBusy(true)
    if (target.items > 0) await archive(target.key, true)
    else await screen.settle(await deleteCatalogueTagAction({ projectSlug: screen.projectSlug, key: target.key }), t('deletedDone', { name: screen.tagName(target.key) }))
    setBusy(false)
    setConfirm(null)
  }

  const menuItems = (key: string): CardMenuItem[] =>
    view.can.write
      ? [
          { key: 'rename', label: t('rename'), onSelect: () => onRename(key) },
          byKey.get(key)?.archivedAt ? { key: 'restore', label: t('restore'), onSelect: () => void archive(key, false) } : { key: 'archive', label: t('archive'), onSelect: () => void archive(key, true) },
          { key: 'delete', label: t('delete'), destructive: true, separated: true, onSelect: () => setConfirm(key) },
        ]
      : []

  return (
    <div className="space-y-4 pt-4">
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('intro')}</p>
      {keys.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={view.can.write ? <Button variant="secondary" onClick={onAdd}>{t('add')}</Button> : null} />
      ) : (
        <>
          <Field label={t('search')}>{(p) => <TextInput {...p} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />}</Field>
          {shownKeys.length === 0 ? (
            <EmptyState compact titleAs="p" title={t('noMatch', { query })} />
          ) : (
            <TreeEditor
              label={t('tab')}
              tree={tree}
              labelOf={screen.tagName}
              onMove={(req) => void reorderCatalogueTagsAction({ projectSlug: screen.projectSlug, keys: reorderedList(keys, req), rev: view.rev, baseHashes: screen.baseHashes() }).then((r) => screen.settle(r))}
              reorderable={view.can.write && !searching}
              reorderDisabledReason={searching ? t('clearSearchToMove') : view.can.write ? undefined : t('needsWrite')}
              parentChangeDisabledReason={t('flat')}
              renderMeta={(key) => {
                const tag = byKey.get(key)
                if (!tag) return null
                const missing = missingLocales(tag.label, view.locales)
                return (
                  <div className="mt-1 flex flex-wrap items-start gap-1.5 text-sm text-muted-foreground">
                    <span className="py-0.5">{t('items', { count: tag.items })}</span>
                    {tag.archivedAt ? <Pill tone="outline">{t('archived')}</Pill> : null}
                    {missing.length && view.locales.length > 1 ? <span className="py-0.5">{t('missingLanguages', { languages: languages(missing) })}</span> : null}
                  </div>
                )
              }}
              menuItems={menuItems}
            />
          )}
        </>
      )}
      <ConfirmDialog
        open={!!target}
        title={target ? (target.items > 0 ? t('inUseTitle', { name: screen.tagName(target.key) }) : t('deleteTitle', { name: screen.tagName(target.key) })) : ''}
        body={target ? (target.items > 0 ? t('inUseBody', { count: target.items }) : t('deleteBody')) : ''}
        confirmLabel={target && target.items > 0 ? t('archive') : t('delete')}
        busy={busy}
        onConfirm={() => void confirmed()}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
