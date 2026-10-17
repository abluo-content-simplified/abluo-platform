'use client'

import { useId, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ChoiceCard, ChoiceCardGrid } from '@/components/app/ui/ChoiceCard'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FilterSelect } from '@/components/app/ui/FilterBar'
import { MediaFrame, Pill } from '@/components/app/ui/list/cells'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { SavePill } from '@/components/client/create/SavePill'
import { SaveNotice } from '@/components/client/create/SaveNotice'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { lifecycleMenu, type LifecycleAction } from '@/components/app/lifecycle/lifecycle-menu'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { catalogueLifecycleAction } from '@/app/[locale]/(client)/[tenant]/catalogue/actions'
import type { CatalogueAbilities, CatalogueSite, CatalogueSnapshot } from '@/lib/api/catalogue-drafts'
import type { Referrer } from '@/lib/lifecycle/service'
import { treeIssues } from '@/lib/modules/catalogue/sections'
import {
  COLLECTION_TYPES,
  SECTION_DEPTH_WARNING,
  addSection,
  addSubsection,
  deleteSection,
  dropRelative,
  itemGaps,
  moveIndex,
  moveSectionBy,
  searchable,
  sectionDepths,
  sectionFormsFromDoc,
  sectionsPatch,
  siblingsOf,
  slugTextsOf,
  textsOf,
  undoDelete,
  type CollectionType,
  type RemovedSections,
  type SectionForm,
  type Texts,
  type Visibility,
} from '@/lib/modules/catalogue/dashboard-form'
import { CAT_ICONS, CAT_MOTION, GapBadges, InUseNotice, SegmentTabs, UnpublishDateSheet, textIn, useCatalogueError } from './catalogue-ui'
import { FieldBlock, NameFields, PageField, VisibilityField } from './item-fields'
import { useCatalogueDraft } from './use-catalogue-draft'
import type { ItemChoice } from './choices'
import { usePublishTogether } from './publish-dependencies'
import { StrayAddressNotice, focusNameField, useStrayAddress } from './stray-address'
import { languageName } from '@/components/client/create/StepHeading'
import { Button, IconButton } from '@/components/app/ui/Button'
import { TextInput } from '@/components/app/ui/TextInput'

type Tab = 'sections' | 'details' | 'page'
const newKey = () => Math.random().toString(36).slice(2, 14)

const BACK_ICON = (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

/**
 * The collection builder (spec §10.4): a direct editor, not a wizard —
 * arranging is iterative. Sections form a tree (ADR-033 D6): drag with the
 * pointer (works with a finger), or use the up/down buttons; "Add
 * subsection" inserts after that section's existing children; deleting a
 * section takes its subsections and leaves an inline Undo strip — no
 * confirmation. The editor never creates an orphan, warns beyond three
 * levels, and shows broken trees (A7) instead of hiding them.
 */
export function CollectionBuilder({
  projectSlug,
  site,
  snapshot,
  items,
  can,
  listHref,
}: {
  projectSlug: string
  site: CatalogueSite
  /** null = a new collection (nothing exists until it has a name). */
  snapshot: CatalogueSnapshot | null
  items: ItemChoice[]
  can: CatalogueAbilities['collection']
  listHref: string
}) {
  const t = useTranslations('catalogue.dashboard.collection')
  const tl = useTranslations('app.lifecycle')
  const ui = useLocale()
  const router = useRouter()
  const errorText = useCatalogueError()
  const d = site.defaultLocale
  const zone = editingZone(site.timeZone)
  const doc = snapshot?.doc ?? {}
  const [collectionType, setCollectionType] = useState<CollectionType>(doc.collectionType === 'menu' ? 'menu' : 'list')
  const draft = useCatalogueDraft({
    projectSlug,
    kind: 'collection',
    initialId: snapshot?.id ?? '',
    initialRev: snapshot?.rev ?? '',
    liveRev: snapshot?.live?.rev,
    hasDraft: snapshot?.hasDraft ?? false,
    defaultLocale: d,
    create: () => ({ collectionType }),
  })
  const archived = snapshot?.status.status === 'archived'
  const readOnly = archived || !can.write
  const update = readOnly ? () => undefined : draft.update
  const [name, setName] = useState<Texts>(() => textsOf(doc.name))
  const [description, setDescription] = useState<Texts>(() => textsOf(doc.description))
  const [sections, setSections] = useState<SectionForm[]>(() => sectionFormsFromDoc(doc.sections))
  const [hasPage, setHasPage] = useState(doc.hasPage === true)
  const [slug, setSlug] = useState<Texts>(() => slugTextsOf(doc.slug))
  const [visibility, setVisibility] = useState<Visibility>((['public', 'websiteOnly', 'unlisted'].includes(doc.visibility as string) ? doc.visibility : 'public') as Visibility)
  const [tab, setTab] = useState<Tab>(snapshot ? 'sections' : 'details')
  const [undo, setUndo] = useState<RemovedSections | null>(null)
  const [picker, setPicker] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [inUse, setInUse] = useState<Referrer[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [dateOpen, setDateOpen] = useState(false)
  const { toast, show } = useUndo()
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const depths = sectionDepths(sections)
  const issues = treeIssues(sections)
  const isLive = Boolean(snapshot?.live)
  const title = textIn(name, ui, d) || t('untitled')
  const tt = useTranslations('catalogue.dashboard.together')
  const afterPublish = (message: string, notLive: Referrer[]) => {
    show({ message: notLive.length ? `${message} ${tt('notLiveAfter', { names: notLive.map((r) => r.label).join(', ') })}` : message, tone: 'status' })
    router.refresh()
  }
  const together = usePublishTogether({
    projectSlug,
    kind: 'collection',
    draft,
    isLive,
    publishAt: null,
    zone,
    onPublished: (notLive) => afterPublish(tt('published'), notLive),
    onError: (e) => show({ message: errorText(e), tone: 'error' }),
  })

  const saveSections = (next: SectionForm[]) => {
    setSections(next)
    update({ sections: sectionsPatch(next) })
  }
  const setSlugIn = (l: string, v: string) => {
    setSlug((p) => ({ ...p, [l]: v }))
    update({ [`slug.${l}`]: v.trim() })
  }
  const stray = useStrayAddress(setSlugIn)
  const setText = (field: 'name' | 'description', l: string, v: string) => {
    if (field === 'name') setName((p) => ({ ...p, [l]: v }))
    else setDescription((p) => ({ ...p, [l]: v }))
    update({ [`${field}.${l}`]: v })
    if (field === 'name') stray.onNameChange(l, v, slug[l])
  }
  const drag = usePointerDrag((key, over) => {
    setUndo(null)
    saveSections(dropRelative(sections, key, over.key, over.after))
  })

  async function publish() {
    if (busy) return
    setBusy(true)
    try {
      together.clear()
      const r = await draft.publish(isLive ? 'keep' : 'now', {}, { keepEditing: true })
      if (!r.ok) {
        if (together.handleRefusal(r)) return
        // E-3: an address without a name in its language — say which, and go to that name.
        const strayLocale = r.error === 'slug_without_name' ? r.detail?.locales?.[0] : undefined
        if (strayLocale) {
          show({ message: t('slugWithoutName', { language: languageName(strayLocale, ui) }), tone: 'error' })
          setTab('details')
          focusNameField(strayLocale)
          return
        }
        const named = r.detail?.conflicts?.[0]
        show({ message: named ? t('slugTaken', { slug: named.slug, name: named.owner.label }) : errorText(r.error), tone: 'error' })
        return
      }
      afterPublish(t('published'), r.notLive)
    } finally {
      setBusy(false)
    }
  }
  async function act(action: LifecycleAction, expiresAt?: string | null) {
    if (busy || !snapshot) return false
    setBusy(true)
    setInUse(null)
    try {
      await draft.flush()
      const r = await catalogueLifecycleAction({ projectSlug, kind: 'collection', op: action, id: snapshot.id, expiresAt })
      if (!r.ok) {
        if (r.error === 'in_use' && r.detail?.referrers?.length) setInUse(r.detail.referrers)
        else show({ message: errorText(r.error), tone: 'error' })
        return false
      }
      if (action === 'delete' || action === 'deletePermanently') router.push(listHref)
      else window.location.reload()
      return true
    } finally {
      setBusy(false)
    }
  }
  const menu: CardMenuItem[] = [
    ...(!readOnly && draft.created ? [{ key: 'publishTogether', label: tt('publishCollection'), onSelect: () => void draft.flush().then(() => together.openSheet()) }] : []),
    ...(snapshot
      ? lifecycleMenu(snapshot.status.status, can).map((e) => ({
          key: e.action,
          label: tl(`actions.${e.action}`),
          destructive: e.destructive,
          separated: e.separated,
          onSelect: () => (e.action === 'delete' || e.action === 'deletePermanently' ? setConfirmDelete(true) : e.action === 'setUnpublishDate' ? setDateOpen(true) : void act(e.action)),
        }))
      : []),
  ]

  const removeSection = (key: string) => {
    const r = deleteSection(sections, key)
    saveSections(r.sections)
    setUndo(r.undo)
  }
  const sectionName = (s: SectionForm) => textIn(s.name, ui, d) || t('sections.unnamed')
  const undoStrip = undo ? (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-border px-4 py-2.5" role="status">
      <span className="text-[0.9375rem] text-foreground">
        {t('sections.removed', { name: sectionName(undo.removed[0]), count: undo.removed.length - 1 })}
      </span>
      <span className="flex gap-2">
        <Button variant="secondary"
          
          onClick={() => {
            saveSections(undoDelete(sections, undo))
            setUndo(null)
          }}>
          {t('sections.undo')}
        </Button>
        <IconButton aria-label={t('sections.dismiss')}  onClick={() => setUndo(null)}>
          {CAT_ICONS.x}
        </IconButton>
      </span>
    </div>
  ) : null
  const undoAt = undo ? Math.min(undo.index, sections.length) : -1

  // UX rule 1: a disabled primary action says why.
  const hintId = useId()
  const publishNeedsName = !name[d]?.trim()
  const primary =
    !readOnly && draft.created ? (
      <Button variant="primary" disabled={busy || publishNeedsName} aria-describedby={publishNeedsName ? hintId : undefined} onClick={() => void publish()}>
        {isLive ? t('publishChanges') : t('publish')}
      </Button>
    ) : null
  const hint = primary && publishNeedsName ? (
    <p id={hintId} className="text-sm text-muted-foreground">
      {t('publishNeedsName')}
    </p>
  ) : null

  return (
    <div className="space-y-5">
      <Link
        href={listHref}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {BACK_ICON}
        {t('back')}
      </Link>
      <div className="-mt-4">
        <PageHeader
        title={title}
        actions={
          <>
            <span className="hidden sm:inline-flex">
              <SavePill state={draft.state} onReload={() => void draft.reload()} />
            </span>
            <span className="hidden md:inline-flex">{primary}</span>
            {menu.length ? <CardMenu label={t('menu')} items={menu} /> : null}
          </>
        }
        />
      </div>
      {hint ? <div className="hidden md:block">{hint}</div> : null}
      {snapshot ? <LifecycleBadge status={snapshot.status.status} changes={draft.hasDraft && isLive} /> : null}
      <SaveNotice state={draft.state} rejected={draft.rejected} onRetry={draft.retry} onReload={() => void draft.reload()} />
      {archived ? <p className="rounded-2xl bg-muted px-4 py-3 text-[0.9375rem] text-foreground">{t('archivedNotice')}</p> : null}
      {inUse ? <InUseNotice projectSlug={projectSlug} referrers={inUse} onClose={() => setInUse(null)} /> : null}
      {together.ui}
      <StrayAddressNotice state={stray} />

      <SegmentTabs label={t('tabsLabel')} value={tab} onChange={setTab} options={(['sections', 'details', 'page'] as Tab[]).map((v) => ({ value: v, label: t(`tabs.${v}`) }))} />

      <fieldset disabled={readOnly} className="min-w-0 space-y-6">
        {tab === 'details' ? (
          <>
            <FieldBlock title={t('type.title')} helper={t('type.helper')}>
              <ChoiceCardGrid label={t('type.title')} kind="radio">
                {COLLECTION_TYPES.map((ct) => (
                  <ChoiceCard
                    key={ct}
                    icon={ct === 'menu' ? CAT_ICONS.menu : CAT_ICONS.listType}
                    label={t(`type.${ct}`)}
                    description={t(`type.${ct}Description`)}
                    selected={collectionType === ct}
                    onSelect={() => {
                      setCollectionType(ct)
                      update({ collectionType: ct })
                    }}
                  />
                ))}
              </ChoiceCardGrid>
            </FieldBlock>
            <FieldBlock title={t('name')}>
              <NameFields autoFocus={!snapshot} locale={d} name={name} description={description} onName={(l, v) => setText('name', l, v)} onDescription={(l, v) => setText('description', l, v)} />
              {!draft.created ? <p className="text-sm text-muted-foreground">{t('nameFirst')}</p> : null}
            </FieldBlock>
            {site.locales.length > 1 && draft.created ? (
              <FieldBlock title={t('languages')}>
                {site.locales
                  .filter((l) => l !== d)
                  .map((l) => (
                    <div key={l} className="rounded-2xl border border-border p-4">
                      <NameFields locale={l} name={name} description={description} onName={(x, v) => setText('name', x, v)} onDescription={(x, v) => setText('description', x, v)} />
                    </div>
                  ))}
              </FieldBlock>
            ) : null}
          </>
        ) : tab === 'page' ? (
          <>
            <FieldBlock title={t('page')}>
              <PageField
                projectSlug={projectSlug}
                docId={draft.id}
                hasPage={hasPage}
                slug={slug}
                name={name}
                segment={site.config.segment}
                locales={site.locales}
                defaultLocale={d}
                onHasPage={(v) => {
                  setHasPage(v)
                  update({ hasPage: v })
                }}
                onSlug={setSlugIn}
              />
            </FieldBlock>
            <FieldBlock>
              <VisibilityField
                value={visibility}
                onChange={(v) => {
                  setVisibility(v)
                  update({ visibility: v })
                }}
              />
            </FieldBlock>
          </>
        ) : !draft.created ? (
          <EmptyState title={t('sections.nameFirstTitle')} body={t('nameFirst')} action={<Button variant="secondary"  onClick={() => setTab('details')}>{t('tabs.details')}</Button>} />
        ) : sections.length === 0 && !undo ? (
          <EmptyState
            title={t('sections.emptyTitle')}
            body={t('sections.emptyBody')}
            action={
              <Button variant="primary"  onClick={() => saveSections(addSection(sections, newKey()))}>
                {CAT_ICONS.plus}
                {t('sections.addFirst')}
              </Button>
            }
          />
        ) : (
          <>
            {issues.length ? (
              <p role="alert" className="rounded-2xl border border-border px-4 py-3 text-[0.9375rem] text-foreground">
                {t('sections.broken')}
              </p>
            ) : null}
            <ol className="flex flex-col gap-3" aria-label={t('sections.label')}>
              {sections.map((s, i) => {
                const depth = depths.get(s._key) ?? 0
                const sibs = siblingsOf(sections, s._key)
                const pos = sibs.findIndex((x) => x._key === s._key)
                const isOver = drag.over?.key === s._key
                return (
                  <li key={s._key} className="flex flex-col gap-3">
                    {i === undoAt ? undoStrip : null}
                    <div
                      data-drag-key={s._key}
                      style={{ marginInlineStart: `${Math.min(depth, 4) * 1.25}rem` }}
                      className={`relative rounded-2xl border bg-card p-3 ${CAT_MOTION} ${drag.dragging === s._key ? 'opacity-50' : ''} ${isOver ? 'border-action' : 'border-border'}`}
                    >
                      {isOver ? <span aria-hidden="true" className={`absolute inset-x-3 h-0.5 rounded bg-action ${drag.over?.after ? '-bottom-2' : '-top-2'}`} /> : null}
                      <div className="flex items-start gap-1">
                        <IconButton className="cursor-grab active:cursor-grabbing" aria-label={t('sections.drag', { name: sectionName(s) })}  {...drag.gripProps(s._key)}>
                          {CAT_ICONS.grip}
                        </IconButton>
                        <div className="min-w-0 flex-1">
                          <label className="sr-only" htmlFor={`sec-${s._key}`}>
                            {t('sections.name')}
                          </label>
                          <TextInput flush
                            id={`sec-${s._key}`}
                            value={s.name[d] ?? ''}
                            placeholder={t('sections.namePlaceholder')}
                            onChange={(e) => saveSections(sections.map((x) => (x._key === s._key ? { ...x, name: { ...x.name, [d]: e.target.value } } : x)))} />
                          <div className="mt-2 flex flex-wrap items-start gap-1.5">
                            {s.items.length === 0 ? <Pill tone="outline">{t('sections.empty')}</Pill> : null}
                            {depth >= SECTION_DEPTH_WARNING ? <Pill tone="outline">{t('sections.deep')}</Pill> : null}
                          </div>
                        </div>
                        <IconButton aria-label={t('sections.up', { name: sectionName(s) })} disabled={pos <= 0} onClick={() => saveSections(moveSectionBy(sections, s._key, -1))}>
                          {CAT_ICONS.up}
                        </IconButton>
                        <IconButton aria-label={t('sections.down', { name: sectionName(s) })} disabled={pos >= sibs.length - 1} onClick={() => saveSections(moveSectionBy(sections, s._key, 1))}>
                          {CAT_ICONS.down}
                        </IconButton>
                        <IconButton aria-label={t('sections.delete', { name: sectionName(s) })} onClick={() => removeSection(s._key)}>
                          {CAT_ICONS.trash}
                        </IconButton>
                      </div>
                      {s.items.length ? (
                        <ul className="mt-3 flex flex-col gap-2">
                          {s.items.map((id, n) => {
                            const it = itemById.get(id)
                            return (
                              <li key={`${id}-${n}`} className="flex items-start gap-2 rounded-xl bg-muted p-2">
                                <MediaFrame src={it?.thumb ?? null} alt="" size={{ width: '3rem', height: '3rem' }} className="shrink-0 rounded-lg" />
                                <div className="flex min-w-0 flex-1 flex-col items-start gap-1 pt-0.5">
                                  <span className="line-clamp-2 text-[0.9375rem] font-medium text-foreground">{it?.name ?? t('sections.unavailableItem')}</span>
                                  {it?.isDraft ? <Pill tone="outline">{t('picker.draft')}</Pill> : null}
                                  {it ? <GapBadges gaps={itemGaps(it)} /> : null}
                                </div>
                                <IconButton aria-label={t('sections.itemUp')} disabled={n === 0} onClick={() => saveSections(sections.map((x) => (x._key === s._key ? { ...x, items: moveIndex(x.items, n, n - 1) } : x)))}>
                                  {CAT_ICONS.up}
                                </IconButton>
                                <IconButton aria-label={t('sections.itemDown')} disabled={n === s.items.length - 1} onClick={() => saveSections(sections.map((x) => (x._key === s._key ? { ...x, items: moveIndex(x.items, n, n + 1) } : x)))}>
                                  {CAT_ICONS.down}
                                </IconButton>
                                <IconButton aria-label={t('sections.removeItem')} onClick={() => saveSections(sections.map((x) => (x._key === s._key ? { ...x, items: x.items.filter((_, k) => k !== n) } : x)))}>
                                  {CAT_ICONS.x}
                                </IconButton>
                              </li>
                            )
                          })}
                        </ul>
                      ) : null}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => setPicker(s._key)}>
                          {CAT_ICONS.plus}
                          {t('sections.addItems')}
                        </Button>
                        <Button variant="secondary" onClick={() => saveSections(addSubsection(sections, s._key, newKey()))}>
                          {t('sections.addSubsection')}
                        </Button>
                      </div>
                    </div>
                  </li>
                )
              })}
              {undoAt === sections.length ? <li>{undoStrip}</li> : null}
            </ol>
            <Button variant="secondary" onClick={() => saveSections(addSection(sections, newKey()))}>
              {CAT_ICONS.plus}
              {t('sections.add')}
            </Button>
          </>
        )}
      </fieldset>

      {primary ? (
        <div className="flex flex-col items-start gap-2 md:hidden">
          {primary}
          {hint}
        </div>
      ) : null}

      <ItemPicker
        open={picker !== null}
        onClose={() => setPicker(null)}
        items={items.filter((i) => !(sections.find((s) => s._key === picker)?.items ?? []).includes(i.id))}
        categories={site.config.categories.map((c) => ({ value: c.value, label: textIn(c.label, ui, d) || c.value }))}
        onAdd={(ids) => {
          saveSections(sections.map((x) => (x._key === picker ? { ...x, items: [...x.items, ...ids] } : x)))
          setPicker(null)
        }}
      />
      <DeletePermanentlyDialog
        open={confirmDelete}
        titles={[title]}
        busy={busy}
        onConfirm={async () => {
          await act(snapshot?.status.status === 'draft' ? 'delete' : 'deletePermanently')
          setConfirmDelete(false)
        }}
        onCancel={() => setConfirmDelete(false)}
      />
      <UnpublishDateSheet
        open={dateOpen}
        busy={busy}
        zone={zone}
        onClose={() => setDateOpen(false)}
        onSave={async (iso) => {
          if (await act('setUnpublishDate', iso)) setDateOpen(false)
        }}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}

/** Pick items for a section: search, category filter, multi-select (square checkboxes). */
function ItemPicker({ open, onClose, items, categories, onAdd }: { open: boolean; onClose: () => void; items: ItemChoice[]; categories: { value: string; label: string }[]; onAdd: (ids: string[]) => void }) {
  const t = useTranslations('catalogue.dashboard.collection.picker')
  const id = useId()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const q = searchable(query.trim())
  const shown = items.filter((i) => (!q || searchable(i.name).includes(q)) && (!category || i.categories.includes(category)))
  const close = () => {
    setPicked([])
    setQuery('')
    onClose()
  }
  return (
    <BottomSheet open={open} title={t('title')} onClose={close}>
      <label htmlFor={`${id}-q`} className="sr-only">
        {t('search')}
      </label>
      <TextInput id={`${id}-q`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} />
      {categories.length ? (
        <div className="mt-3">
          <FilterSelect label={t('category')} value={category} onChange={setCategory} options={[{ value: '', label: t('anyCategory') }, ...categories]} />
        </div>
      ) : null}
      <ul className="mt-3 max-h-[50vh] overflow-y-auto">
        {shown.length === 0 ? <li className="py-4 text-[0.9375rem] text-muted-foreground">{items.length ? t('noMatch') : t('none')}</li> : null}
        {shown.map((i) => (
          <li key={i.id}>
            <label className="flex cursor-pointer items-start gap-2 py-1.5">
              <Checkbox aria-label={i.name} checked={picked.includes(i.id)} onChange={(on) => setPicked((p) => (on ? [...p, i.id] : p.filter((x) => x !== i.id)))} />
              <MediaFrame src={i.thumb} alt="" size={{ width: '2.75rem', height: '2.75rem' }} className="shrink-0 rounded-lg" />
              <span className="flex min-w-0 flex-col items-start gap-1 pt-0.5" aria-hidden="true">
                <span className="text-[0.9375rem] font-medium text-foreground">{i.name}</span>
                {i.isDraft ? <Pill tone="outline">{t('draft')}</Pill> : null}
                <GapBadges gaps={itemGaps(i)} />
              </span>
            </label>
          </li>
        ))}
      </ul>
      <Button variant="primary" className="mt-4" disabled={!picked.length} aria-describedby={picked.length ? undefined : `${id}-pick`} onClick={() => { onAdd(picked); setPicked([]) }}>
        {t('add', { count: picked.length })}
      </Button>
      {picked.length ? null : (
        <p id={`${id}-pick`} className="mt-2 text-sm text-muted-foreground">
          {t('pickHint')}
        </p>
      )}
    </BottomSheet>
  )
}
