'use client'

import { useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { Field } from '@/components/app/ui/Field'
import { ImpactPreview } from '@/components/app/ui/ImpactPreview'
import { Notice } from '@/components/app/ui/Notice'
import { TextInput } from '@/components/app/ui/TextInput'
import { TreeEditor } from '@/components/app/ui/TreeEditor'
import { Pill } from '@/components/app/ui/list/cells'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import type { MoveImpact } from '@/lib/modules/catalogue/taxonomy/service'
import type { MoveRequest } from '@/lib/modules/catalogue/taxonomy/types'
import { asChannelKey } from '@/lib/modules/catalogue/commerce/commerce-types'
import { moveCatalogueCategoryAction, previewCatalogueCategoryMoveAction, reorderCatalogueCategoriesAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/taxonomy-actions'
import { CategoryDeleteSheet } from './CategoryDeleteSheet'
import { CategorySheet } from './CategorySheet'
import { hasImpact, isReorder, labelText, missingLocales, previewImpact, reorderedSiblings, searchTree } from './setup-model'
import { useLanguageList } from './setup-ui'
import type { TaxonomyScreen } from './taxonomy-context'
import { ProfileFilter } from './ProfileFilter'
import { useProfileUseFor } from '../use-for-ui'
import { buildTree } from '@/lib/modules/catalogue/taxonomy/tree'
import { isCategoryCompatible, sameUseFor } from '@/lib/modules/catalogue/taxonomy/profile-applicability'
import type { ItemProfile } from '@/lib/modules/catalogue/profiles'

/**
 * The category tree: search by name or full path, drag / arrow keys / ⋯ menu to move (TreeEditor),
 * a meta line per row (items, archived, own channel rules, languages still missing). Reordering
 * siblings needs `taxonomy.write`; moving into another parent needs `setup.manage` and shows its
 * availability impact first when it changes any item (C1.7, C5-6).
 */
export function CategoriesPanel({ screen, onAdd, onRename }: { screen: TaxonomyScreen; onAdd: (parentKey: string | null) => void; onRename: (key: string) => void }) {
  const t = useTranslations('catalogue.setup.categories')
  const { view, tree } = screen
  const languages = useLanguageList()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [move, setMove] = useState<{ req: MoveRequest; impact: MoveImpact } | null>(null)
  const [busy, setBusy] = useState(false)
  const [profile, setProfile] = useState<ItemProfile | null>(null)
  const tu = useTranslations('catalogue.useFor')
  const useFor = useProfileUseFor()

  // D-22: search, then (optionally) only the branches used for one item type.
  const shown = useMemo(() => {
    const found = query.trim() ? searchTree(tree, query, screen.pathContext) : tree
    return profile ? buildTree([...found.nodes.values()].filter((n) => isCategoryCompatible(tree, n.key, profile))) : found
  }, [tree, query, screen.pathContext, profile])
  const byKey = useMemo(() => new Map(view.categories.map((c) => [c.key, c])), [view.categories])
  const channelName = (key: string) => {
    const c = screen.channels.find((x) => x.key === key) ?? view.channels.find((x) => x.key === key)
    return c ? labelText(c.label, view.defaultLocale, view.defaultLocale) || t('unnamed') : t('unnamed')
  }
  const searching = query.trim() !== '' || profile !== null

  async function onMove(req: MoveRequest) {
    if (isReorder(tree, req)) {
      const r = await reorderCatalogueCategoriesAction({ projectSlug: screen.projectSlug, parentKey: req.newParentKey, keys: reorderedSiblings(tree, req), rev: view.rev, baseHashes: screen.baseHashes() })
      await screen.settle(r)
      return
    }
    const p = await previewCatalogueCategoryMoveAction({ projectSlug: screen.projectSlug, key: req.key, newParentKey: req.newParentKey, index: req.index })
    if (!p.ok) return void screen.show(screen.failText(p), 'error')
    if (hasImpact(p.impact.availability) || profileChanges(p.impact)) {
      setMove({ req, impact: p.impact })
      return
    }
    await commitMove(req)
  }

  async function commitMove(req: MoveRequest) {
    setBusy(true)
    const r = await moveCatalogueCategoryAction({ projectSlug: screen.projectSlug, key: req.key, newParentKey: req.newParentKey, index: req.index, rev: view.rev, baseHashes: screen.baseHashes() })
    setBusy(false)
    // A refusal closes the confirmation and is said once (a conflict reloads the tree first).
    setMove(null)
    await screen.settle(r)
  }

  const menuItems = (key: string): CardMenuItem[] => {
    const node = tree.nodes.get(key)
    return [
      { key: 'edit', label: t('edit'), onSelect: () => setEditing(key) },
      ...(view.can.write ? [{ key: 'rename', label: t('rename'), onSelect: () => onRename(key) }] : []),
      ...(view.can.write && !node?.archivedAt ? [{ key: 'addChild', label: t('addChild'), onSelect: () => onAdd(key) }] : []),
      ...(view.can.write || view.can.manage ? [{ key: 'delete', label: t('delete'), destructive: true, separated: true, onSelect: () => setDeleting(key) }] : []),
    ]
  }

  const renderMeta = (key: string) => {
    const c = byKey.get(key)
    if (!c) return null
    const root = (tree.parentOf.get(key) ?? null) === null
    const missing = missingLocales(c.label, view.locales)
    const rules = Object.keys(c.channelRules ?? {}).filter((ch) => screen.channels.some((x) => x.key === ch) || view.channels.some((x) => x.key === ch))
    return (
      <div className="mt-1 flex flex-wrap items-start gap-1.5 text-sm text-muted-foreground">
        <span className="py-0.5">{t('items', { count: c.items })}</span>
        {/* D-22: profile chips beside each top-level category (children inherit them). */}
        {root
          ? useFor.chips(c.useFor).map((label) => (
              <Pill key={`use-${label}`} tone={c.useFor?.length ? 'success' : 'outline'}>
                {label}
              </Pill>
            ))
          : null}
        {c.archivedAt ? <Pill tone="outline">{t('archived')}</Pill> : null}
        {rules.map((ch) => (
          <Pill key={ch} tone="highlight">
            {t('ownRule', { channel: channelName(asChannelKey(ch)) })}
          </Pill>
        ))}
        {missing.length && view.locales.length > 1 ? <span className="py-0.5">{t('missingLanguages', { languages: languages(missing) })}</span> : null}
      </div>
    )
  }

  const moving = move ? screen.categoryName(move.req.key) : ''
  const target = move ? (move.req.newParentKey ? screen.categoryName(move.req.newParentKey) : null) : null

  return (
    <div className="space-y-4 pt-4">
      {view.issues.length ? <Notice tone="info">{t('treeIssues')}</Notice> : null}
      {view.categories.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} action={view.can.write ? <Button variant="secondary" onClick={() => onAdd(null)}>{t('add')}</Button> : null} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
            <Field label={t('search')} hint={t('searchHint')}>
              {(p) => <TextInput {...p} type="search" value={query} onChange={(e) => setQuery(e.target.value)} />}
            </Field>
            <ProfileFilter value={profile} onChange={setProfile} />
          </div>
          {searching && shown.nodes.size === 0 ? (
            <EmptyState compact titleAs="p" title={query.trim() ? t('noMatch', { query }) : tu('noneForFilter', { profile: profile ? useFor.labelOf(profile) : '' })} />
          ) : (
            <TreeEditor
              label={t('tab')}
              tree={shown}
              labelOf={screen.categoryName}
              onMove={(req) => void onMove(req)}
              reorderable={view.can.write && !searching}
              reorderDisabledReason={searching ? t('clearSearchToMove') : view.can.write ? undefined : t('needsWrite')}
              parentChangeDisabledReason={view.can.manage ? undefined : t('moveNeedsSetup')}
              showPaths={searching}
              renderMeta={renderMeta}
              menuItems={menuItems}
            />
          )}
        </>
      )}
      {move ? (
        <ImpactPreview
          open
          title={target ? t('moveTitle', { name: moving, parent: target }) : t('moveTopTitle', { name: moving })}
          impact={previewImpact(move.impact.availability)}
          confirmLabel={t('moveConfirm')}
          busy={busy}
          onConfirm={() => void commitMove(move.req)}
          onCancel={() => setMove(null)}
        >
          <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('moveBody', { items: move.impact.items })}</p>
          {profileChanges(move.impact) ? (
            <p className="text-[0.9375rem] leading-6 text-foreground">
              {tu('moveChange', { before: useFor.text(move.impact.profiles.before), after: useFor.text(move.impact.profiles.after) })} {tu('moveIncompatible', { count: move.impact.newlyIncompatible })}
            </p>
          ) : null}
        </ImpactPreview>
      ) : null}
      <CategorySheet screen={screen} categoryKey={editing} onClose={() => setEditing(null)} onRename={onRename} onDelete={(k) => setDeleting(k)} />
      <CategoryDeleteSheet screen={screen} categoryKey={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}

/** D-22: a move that changes which item types the branch is used for (or makes items not fit) is confirmed first. */
function profileChanges(impact: MoveImpact): boolean {
  return !!impact.profiles && (!sameUseFor(impact.profiles.before, impact.profiles.after) || impact.newlyIncompatible > 0)
}
