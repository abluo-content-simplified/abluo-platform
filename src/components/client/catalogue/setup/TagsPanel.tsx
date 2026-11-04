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
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { previewCatalogueTagUseForAction, setCatalogueTagUseForAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/taxonomy-actions'
import { isTagCompatible } from '@/lib/modules/catalogue/taxonomy/profile-applicability'
import type { ItemProfile } from '@/lib/modules/catalogue/profiles'
import { ProfileFilter } from './ProfileFilter'
import { UseForSection } from './UseForSection'
import { useProfileUseFor } from '../use-for-ui'

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
  const [profile, setProfile] = useState<ItemProfile | null>(null)
  const [useForKey, setUseForKey] = useState<string | null>(null)
  const tu = useTranslations('catalogue.useFor')
  const useFor = useProfileUseFor()
  const keys = view.tags.map((x) => x.key)
  const searching = query.trim() !== '' || profile !== null
  const shownKeys = useMemo(() => {
    const q = searchText(query)
    // D-22: search, then (optionally) only the tags used for one item type.
    return keys.filter((k) => {
      const tag = view.tags.find((x) => x.key === k)
      if (q && !searchText(Object.values(tag?.label ?? {}).join(' ')).includes(q)) return false
      return !profile || isTagCompatible(tag, profile)
    })
  }, [keys, query, profile, view.tags])
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
          { key: 'useFor', label: tu('menu'), onSelect: () => setUseForKey(key) },
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
          <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
            <Field label={t('search')}>{(p) => <TextInput {...p} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />}</Field>
            <ProfileFilter value={profile} onChange={setProfile} />
          </div>
          {shownKeys.length === 0 ? (
            <EmptyState compact titleAs="p" title={query.trim() ? t('noMatch', { query }) : tu('noneForFilter', { profile: profile ? useFor.labelOf(profile) : '' })} />
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
                    {/* D-22: profile chips beside each tag. */}
                    {useFor.chips(tag.useFor).map((label) => (
                      <Pill key={`use-${label}`} tone={tag.useFor?.length ? 'success' : 'outline'}>
                        {label}
                      </Pill>
                    ))}
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
      <BottomSheet open={!!useForKey && byKey.has(useForKey)} title={useForKey ? screen.tagName(useForKey) : ''} onClose={() => setUseForKey(null)}>
        {useForKey && byKey.has(useForKey) ? (
          <UseForSection
            key={useForKey}
            name={screen.tagName(useForKey)}
            stored={byKey.get(useForKey)!.useFor ?? []}
            disabledReason={view.can.write ? undefined : tu('needsWrite')}
            preview={async (next) => {
              const r = await previewCatalogueTagUseForAction({ projectSlug: screen.projectSlug, key: useForKey, useFor: next })
              if (!r.ok) {
                screen.show(screen.failText(r), 'error')
                return null
              }
              return r.preview.newlyIncompatible
            }}
            save={async (next) => {
              const r = await setCatalogueTagUseForAction({ projectSlug: screen.projectSlug, key: useForKey, useFor: next, rev: view.rev, baseHashes: screen.baseHashes() })
              const ok = (await screen.settle(r, tu('saved', { name: screen.tagName(useForKey), profiles: useFor.text(next) }))) !== null
              if (ok) setUseForKey(null)
              return ok
            }}
          />
        ) : null}
      </BottomSheet>
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
