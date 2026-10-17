'use client'

import { useId, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { FilterSegmented, FilterSelect } from '@/components/app/ui/FilterBar'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { SavePill } from '@/components/client/create/SavePill'
import { SaveNotice } from '@/components/client/create/SaveNotice'
import { languageName } from '@/components/client/create/StepHeading'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { lifecycleMenu, type LifecycleAction } from '@/components/app/lifecycle/lifecycle-menu'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { catalogueLifecycleAction } from '@/app/[locale]/(client)/[tenant]/catalogue/actions'
import type { CatalogueAbilities, CatalogueSite, CatalogueSnapshot } from '@/lib/api/catalogue-drafts'
import type { Referrer } from '@/lib/lifecycle/service'
import { formatPrice } from '@/lib/modules/catalogue/resolve'
import { NOT_REVIEWED, declarationIssues, isFreeTextAdd, moveIndex, optionFormsFromDoc, optionsPatch, parsePrice, textsOf, type OptionForm, type Texts } from '@/lib/modules/catalogue/dashboard-form'
import { Pill } from '@/components/app/ui/list/cells'
import { CAT_ICONS, InUseNotice, textIn, useCatalogueError } from './catalogue-ui'
import { AllergenDeclarationField, FieldBlock } from './item-fields'
import { useCatalogueDraft } from './use-catalogue-draft'
import type { ItemChoice } from './choices'
import { usePublishTogether } from './publish-dependencies'
import { Button, IconButton } from '@/components/app/ui/Button'
import { FieldLabel } from '@/components/app/ui/FieldLabel'
import { TextInput } from '@/components/app/ui/TextInput'

const newKey = () => Math.random().toString(36).slice(2, 14)

const BACK_ICON = (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

/**
 * Option lists (spec §10.2, ADR-033 D2): a plain editor — the list's name and
 * its options (label per language, add or remove, a price change that may be
 * zero or negative, and optionally a linked item that is itself offered),
 * reorderable. How many options a customer can choose (min/max) is set where an item
 * attaches the list, not here. Archiving or deleting is refused while any
 * non-archived item uses the list; the refusal links every one of them (C7).
 */
export function OptionListEditor({
  projectSlug,
  site,
  snapshot,
  items,
  can,
  listHref,
}: {
  projectSlug: string
  site: CatalogueSite
  snapshot: CatalogueSnapshot | null
  items: ItemChoice[]
  can: CatalogueAbilities['optionList']
  listHref: string
}) {
  const t = useTranslations('catalogue.dashboard.optionList')
  const tl = useTranslations('app.lifecycle')
  const ui = useLocale()
  const router = useRouter()
  const errorText = useCatalogueError()
  const id = useId()
  const d = site.defaultLocale
  const doc = snapshot?.doc ?? {}
  const draft = useCatalogueDraft({ projectSlug, kind: 'optionList', initialId: snapshot?.id ?? '', initialRev: snapshot?.rev ?? '', liveRev: snapshot?.live?.rev, hasDraft: snapshot?.hasDraft ?? false, defaultLocale: d })
  const archived = snapshot?.status.status === 'archived'
  const readOnly = archived || !can.write
  const update = readOnly ? () => undefined : draft.update
  const [name, setName] = useState<Texts>(() => textsOf(doc.name))
  const [options, setOptions] = useState<OptionForm[]>(() => optionFormsFromDoc(doc.options))
  const [busy, setBusy] = useState(false)
  const [inUse, setInUse] = useState<Referrer[] | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { toast, show } = useUndo()
  const isLive = Boolean(snapshot?.live)
  const title = textIn(name, ui, d) || t('untitled')
  const offered = items.filter((i) => i.offered)
  const tt = useTranslations('catalogue.dashboard.together')
  const together = usePublishTogether({
    projectSlug,
    kind: 'optionList',
    draft,
    isLive,
    publishAt: null,
    zone: editingZone(site.timeZone),
    onPublished: () => {
      show({ message: tt('published'), tone: 'status' })
      router.refresh()
    },
    onError: (e) => show({ message: errorText(e), tone: 'error' }),
  })

  const saveOptions = (next: OptionForm[]) => {
    setOptions(next)
    const patch = optionsPatch(next)
    if (patch) update({ options: patch })
  }
  const setOpt = (key: string, p: Partial<OptionForm>) => saveOptions(options.map((o) => (o.key === key ? { ...o, ...p } : o)))

  async function publish() {
    if (busy) return
    setBusy(true)
    try {
      together.clear()
      const r = await draft.publish(isLive ? 'keep' : 'now', {}, { keepEditing: true })
      if (!r.ok) {
        if (together.handleRefusal(r)) return
        return show({ message: errorText(r.error), tone: 'error' })
      }
      show({ message: t('published'), tone: 'status' })
      router.refresh()
    } finally {
      setBusy(false)
    }
  }
  async function act(action: LifecycleAction) {
    if (busy || !snapshot) return
    setBusy(true)
    setInUse(null)
    try {
      await draft.flush()
      const r = await catalogueLifecycleAction({ projectSlug, kind: 'optionList', op: action, id: snapshot.id })
      if (!r.ok) {
        if (r.error === 'in_use' && r.detail?.referrers?.length) setInUse(r.detail.referrers)
        else show({ message: errorText(r.error), tone: 'error' })
        return
      }
      if (action === 'delete' || action === 'deletePermanently') router.push(listHref)
      else window.location.reload()
    } finally {
      setBusy(false)
      setConfirmDelete(false)
    }
  }
  // Option lists have no audience of their own: no unpublish date.
  const menu: CardMenuItem[] = [
    ...(!readOnly && draft.created ? [{ key: 'publishTogether', label: tt('publishOptionList'), onSelect: () => void draft.flush().then(() => together.openSheet()) }] : []),
    ...(snapshot
      ? lifecycleMenu(snapshot.status.status, can)
          .filter((e) => e.action !== 'setUnpublishDate')
          .map((e) => ({
            key: e.action,
            label: tl(`actions.${e.action}`),
            destructive: e.destructive,
            separated: e.separated,
            onSelect: () => (e.action === 'delete' || e.action === 'deletePermanently' ? setConfirmDelete(true) : void act(e.action)),
          }))
      : []),
  ]
  // UX rule 1: a disabled primary action says why.
  const publishHint = !name[d]?.trim() ? t('publishNeedsName') : options.length === 0 ? t('publishNeedsOption') : null
  const primary =
    !readOnly && draft.created ? (
      <Button variant="primary" disabled={busy || publishHint !== null} aria-describedby={publishHint ? `${id}-hint` : undefined} onClick={() => void publish()}>
        {isLive ? t('publishChanges') : t('publish')}
      </Button>
    ) : null
  const hint = primary && publishHint ? (
    <p id={`${id}-hint`} className="text-sm text-muted-foreground">
      {publishHint}
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

      <fieldset disabled={readOnly} className="min-w-0 space-y-8">
        <FieldBlock title={t('name')} helper={t('nameHelp')}>
          {site.locales.map((l) => (
            <div key={l}>
              <FieldLabel htmlFor={`${id}-name-${l}`}>
                {site.locales.length > 1 ? languageName(l, ui) : t('name')}
              </FieldLabel>
              <TextInput
                id={`${id}-name-${l}`}
                autoFocus={!snapshot && l === d}
                maxLength={120}
                value={name[l] ?? ''}
                onChange={(e) => {
                  setName((p) => ({ ...p, [l]: e.target.value }))
                  update({ [`name.${l}`]: e.target.value })
                }} />
            </div>
          ))}
        </FieldBlock>

        <FieldBlock title={t('options')} helper={t('optionsHelp')}>
          {!draft.created ? (
            <p className="text-sm text-muted-foreground">{t('nameFirst')}</p>
          ) : options.length === 0 ? (
            <EmptyState compact title={t('emptyTitle')} body={t('emptyBody')} />
          ) : (
            <ol className="flex flex-col gap-3">
              {options.map((o, n) => {
                const delta = o.delta.trim() === '' ? 0 : parsePrice(o.delta, { signed: true })
                return (
                  <li key={o.key} className="rounded-2xl border border-border p-4">
                    {isFreeTextAdd(o) && declarationIssues(o.declaration).length ? (
                      <p className="mb-2">
                        <Pill tone="outline">{t('allergensNotReviewed')}</Pill>
                      </p>
                    ) : null}
                    <div className="flex items-start gap-1">
                      <div className="min-w-0 flex-1 space-y-3">
                        {site.locales.map((l) => (
                          <div key={l}>
                            <label htmlFor={`${id}-${o.key}-${l}`} className="text-sm text-foreground">
                              {site.locales.length > 1 ? t('labelIn', { language: languageName(l, ui) }) : t('label')}
                            </label>
                            <TextInput id={`${id}-${o.key}-${l}`} maxLength={80} value={o.label[l] ?? ''} onChange={(e) => setOpt(o.key, { label: { ...o.label, [l]: e.target.value } })} />
                          </div>
                        ))}
                      </div>
                      <IconButton aria-label={t('up')} disabled={n === 0} onClick={() => saveOptions(moveIndex(options, n, n - 1))}>
                        {CAT_ICONS.up}
                      </IconButton>
                      <IconButton aria-label={t('down')} disabled={n === options.length - 1} onClick={() => saveOptions(moveIndex(options, n, n + 1))}>
                        {CAT_ICONS.down}
                      </IconButton>
                      <IconButton aria-label={t('remove')} onClick={() => saveOptions(options.filter((x) => x.key !== o.key))}>
                        {CAT_ICONS.trash}
                      </IconButton>
                    </div>
                    <div className="mt-3 flex flex-wrap items-end gap-3">
                      <FilterSegmented
                        label={t('kind')}
                        value={o.kind}
                        onChange={(v) => setOpt(o.key, { kind: v === 'remove' ? 'remove' : 'add' })}
                        options={[
                          { value: 'add', label: t('kindAdd') },
                          { value: 'remove', label: t('kindRemove') },
                        ]}
                      />
                      <label className="flex flex-col text-sm text-foreground" htmlFor={`${id}-${o.key}-delta`}>
                        {t('delta')}
                        <TextInput className="w-32" id={`${id}-${o.key}-delta`} inputMode="decimal" placeholder="0.00" value={o.delta} onChange={(e) => setOpt(o.key, { delta: e.target.value })} aria-invalid={delta === null || undefined} />
                      </label>
                      {delta !== null && delta !== 0 ? <span className="pb-3 text-sm text-muted-foreground">{formatPrice(delta, site.config.currency, ui, { signed: true })}</span> : null}
                    </div>
                    {delta === null ? <p className="mt-2 text-sm text-destructive">{t('badDelta')}</p> : null}
                    {offered.length ? (
                      <div className="mt-3">
                        <FilterSelect
                          label={t('linkedItem')}
                          value={o.itemId ?? ''}
                          onChange={(v) => setOpt(o.key, { itemId: v || null })}
                          options={[{ value: '', label: t('noLinkedItem') }, ...offered.map((i) => ({ value: i.id, label: i.isDraft ? t('draftLabel', { name: i.name }) : i.name }))]}
                        />
                      </div>
                    ) : null}
                    {/* ADR-033 D-3a: a free-text "add" choice declares its own allergens (a linked one uses its item's). */}
                    {isFreeTextAdd(o) ? (
                      <div className="mt-4 rounded-xl bg-muted p-3">
                        <p className="mb-2 text-sm text-muted-foreground">{t('allergensHelp')}</p>
                        <AllergenDeclarationField compactHeading withNote={false} declaration={o.declaration} defaultLocale={d} onChange={(declaration) => setOpt(o.key, { declaration })} />
                      </div>
                    ) : o.itemId ? (
                      <p className="mt-3 text-sm text-muted-foreground">{t('allergensFromItem')}</p>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          )}
          {draft.created ? (
            <Button variant="secondary" onClick={() => saveOptions([...options, { key: newKey(), label: {}, kind: 'add', delta: '', itemId: null, declaration: NOT_REVIEWED }])}>
              {CAT_ICONS.plus}
              {t('add')}
            </Button>
          ) : null}
        </FieldBlock>
      </fieldset>

      {primary ? (
        <div className="flex flex-col items-start gap-2 md:hidden">
          {primary}
          {hint}
        </div>
      ) : null}

      <DeletePermanentlyDialog open={confirmDelete} titles={[title]} busy={busy} onConfirm={() => void act(snapshot?.status.status === 'draft' ? 'delete' : 'deletePermanently')} onCancel={() => setConfirmDelete(false)} />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
