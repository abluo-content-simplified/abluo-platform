'use client'

import { useCallback, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/app/ui/Button'
import { Tabs, tabPanelProps } from '@/components/app/ui/Tabs'
import { buildTree } from '@/lib/modules/catalogue/taxonomy/tree'
import { MAX_CATEGORIES, MAX_TAGS } from '@/lib/modules/catalogue/taxonomy/limits'
import type { CatalogueTaxonomyView } from '@/lib/modules/catalogue/taxonomy/service'
import { listCatalogueTaxonomyAction } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/taxonomy-actions'
import { CategoriesPanel } from './CategoriesPanel'
import { NameSheet, type NameSheetTarget } from './NameSheet'
import { TagsPanel } from './TagsPanel'
import { labelText, type ChannelDraft } from './setup-model'
import { SetupHeader, useFailText, useSetupToast } from './setup-ui'
import type { TaxonomyScreen } from './taxonomy-context'

const CONFLICTS = new Set(['category_conflict', 'tag_conflict', 'conflict'])

/**
 * Catalogue → Setup → Categories & Tags (spec §10.3, C1, C8 §8.3): one page, two tabs.
 * People with `catalogue.taxonomy.write` create, rename, translate, reorder siblings, delete an
 * unused leaf and manage tags; structure and rule controls need `catalogue.setup.manage` and are
 * shown disabled with the reason otherwise. Every change goes through CatalogueTaxonomyService
 * (taxonomy-actions) and the list is reloaded after it, so revisions and fingerprints stay current.
 */
export function CategoriesSetup({ projectSlug, initial, channels, backHref }: { projectSlug: string; initial: CatalogueTaxonomyView; channels: readonly ChannelDraft[]; backHref: string | null }) {
  const t = useTranslations('catalogue.setup.categories')
  const tt = useTranslations('catalogue.setup.tags')
  const [view, setView] = useState(initial)
  const [tab, setTab] = useState<'categories' | 'tags'>('categories')
  const [adding, setAdding] = useState<NameSheetTarget | null>(null)
  const toast = useSetupToast()
  const tree = useMemo(() => buildTree(view.categories), [view.categories])
  const categoryName = useCallback((k: string) => labelText(tree.nodes.get(k)?.label, view.defaultLocale, view.defaultLocale) || t('unnamed'), [tree, view.defaultLocale, t])
  const tagName = useCallback((k: string) => labelText(view.tags.find((x) => x.key === k)?.label, view.defaultLocale, view.defaultLocale) || t('unnamed'), [view.tags, view.defaultLocale, t])
  const failText = useFailText((k) => (k.startsWith('tag:') ? tagName(k.slice(4)) : tree.nodes.has(k) ? categoryName(k) : null))

  const reload = useCallback(async () => {
    const r = await listCatalogueTaxonomyAction({ projectSlug })
    if (r.ok) setView(r.taxonomy)
  }, [projectSlug])

  const screen: TaxonomyScreen = {
    projectSlug,
    view,
    tree,
    pathContext: { locale: view.defaultLocale, defaultLocale: view.defaultLocale, locales: view.locales },
    categoryName,
    tagName,
    baseHashes: () => ({ ...Object.fromEntries(view.categories.map((c) => [c.key, c.hash])), ...Object.fromEntries(view.tags.map((x) => [`tag:${x.key}`, x.hash])) }),
    channels: channels.filter((c) => c.active),
    failText,
    show: toast.show,
    settle: async (result, ok) => {
      if (!result.ok) {
        if (CONFLICTS.has(result.error)) await reload()
        toast.show(failText(result), 'error')
        return null
      }
      await reload()
      const { ok: _ok, ...value } = result
      void _ok
      const message = typeof ok === 'function' ? ok(value as never) : ok
      if (message) toast.show(message)
      return value as never
    },
  }

  const canWrite = view.can.write
  const full = tab === 'categories' ? view.categories.length >= MAX_CATEGORIES : view.tags.length >= MAX_TAGS
  const addReason = !canWrite ? t('needsWrite') : full ? (tab === 'categories' ? t('limitReached', { max: MAX_CATEGORIES }) : tt('limitReached', { max: MAX_TAGS })) : null
  const idBase = 'setup-taxonomy'

  return (
    <div className="space-y-5">
      <SetupHeader
        title={t('title')}
        backHref={backHref}
        intro={view.can.manage ? t('introManage') : t('introWrite')}
        actions={
          <Button variant="primary" disabled={!!addReason} onClick={() => setAdding(tab === 'categories' ? { kind: 'category', mode: 'add', parentKey: null } : { kind: 'tag', mode: 'add' })}>
            {tab === 'categories' ? t('add') : tt('add')}
          </Button>
        }
      />
      {addReason ? <p className="-mt-3 text-sm text-muted-foreground">{addReason}</p> : null}
      <Tabs
        label={t('tabs')}
        idBase={idBase}
        value={tab}
        onChange={(id) => setTab(id as 'categories' | 'tags')}
        items={[
          { id: 'categories', label: t('tab'), count: view.categories.length },
          { id: 'tags', label: tt('tab'), count: view.tags.length },
        ]}
      />
      <div {...tabPanelProps(idBase, tab)}>
        {tab === 'categories' ? (
          <CategoriesPanel screen={screen} onAdd={(parentKey) => setAdding({ kind: 'category', mode: 'add', parentKey })} onRename={(key) => setAdding({ kind: 'category', mode: 'rename', key })} />
        ) : (
          <TagsPanel screen={screen} onAdd={() => setAdding({ kind: 'tag', mode: 'add' })} onRename={(key) => setAdding({ kind: 'tag', mode: 'rename', key })} />
        )}
      </div>
      <NameSheet screen={screen} target={adding} onClose={() => setAdding(null)} />
      {toast.node}
    </div>
  )
}

