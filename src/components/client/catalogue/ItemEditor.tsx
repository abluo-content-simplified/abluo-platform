'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { timedAction } from '@/lib/perf/client-log'
import { TermPicker } from '@/components/client/taxonomy/TermPicker'
import { useUploadOwner } from '@/components/client/media/use-media-uploads'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { PageHeader } from '@/components/app/ui/PageHeader'
import { CardMenu, type CardMenuItem } from '@/components/app/ui/CardMenu'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { Toast } from '@/components/app/ui/Toast'
import { useUndo } from '@/components/app/ui/use-undo'
import { SavePill } from '@/components/client/create/SavePill'
import { SaveNotice } from '@/components/client/create/SaveNotice'
import { LifecycleBadge } from '@/components/app/lifecycle/LifecycleBadge'
import { lifecycleMenu, type LifecycleAction } from '@/components/app/lifecycle/lifecycle-menu'
import { DeletePermanentlyDialog } from '@/components/app/lifecycle/DeletePermanentlyDialog'
import { PublicationDateField } from '@/components/app/lifecycle/PublicationDateField'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import { catalogueLifecycleAction } from '@/app/[locale]/(client)/[tenant]/catalogue/actions'
import type { CatalogueAbilities, CatalogueSite, CatalogueSnapshot } from '@/lib/api/catalogue-drafts'
import type { Referrer } from '@/lib/lifecycle/service'
import { PROFILES, can as profileCan } from '@/lib/modules/catalogue/profiles'
import { attachmentIssues, declarationIssues, itemGaps, itemOptionsRelevant, itemStateFromDoc, type ItemState } from '@/lib/modules/catalogue/dashboard-form'
import { adviceTabs, issueCountByTab, itemIssues, publishBlockers, type ItemIssue, type ItemTab } from '@/lib/modules/catalogue/item-issues'
import { CAT_ICONS, CAT_INPUT, CAT_PRIMARY, GapBadges, InUseNotice, ItemIssueList, SegmentTabs, TabLabel, UnpublishDateSheet, focusField, textIn, useCatalogueError } from './catalogue-ui'
import { BookDetailsFields, FieldBlock, FoodInfoField, ItemPreview, LanguagesField, LinksField, NameFields, OptionsField, PageField, PhotoField, PriceField, VisibilityField, type OptionListChoice } from './item-fields'
import { ChangeTypeSheet } from './ChangeTypeSheet'
import { usePublishTogether } from './publish-dependencies'
import { languageName } from '@/components/client/create/StepHeading'
import { StrayAddressNotice, focusNameField, useStrayAddress } from './stray-address'
import { useCatalogueDraft } from './use-catalogue-draft'
import { useItemState } from './use-item-state'

type Tab = ItemTab
type PublishResult = { kind: 'published' } | { kind: 'scheduled'; at: string | null }
const RESULT_KEY = (id: string) => `catalogue-item-published:${id}`

/**
 * The item editor (spec §10.2): the wizard's fields in tabs, on the same
 * autosaved draft. Publishing writes the draft to the website ("Publish" /
 * "Publish changes"); Unpublish · Archive · Restore · Delete come from the
 * shared lifecycle menu (ADR-032 slice 6), and an archive or delete that is
 * refused names — and links — the collections still using the item.
 */
export function ItemEditor({
  projectSlug,
  site,
  snapshot,
  optionLists,
  can,
  canAddCategory = false,
  listHref,
}: {
  projectSlug: string
  site: CatalogueSite
  snapshot: CatalogueSnapshot
  optionLists: OptionListChoice[]
  can: CatalogueAbilities['item']
  /** Holds catalogue.taxonomy.write: the category field offers "+ Add category" (and shows even with no category yet). */
  canAddCategory?: boolean
  listHref: string
}) {
  const t = useTranslations('catalogue.dashboard.item.editor')
  const tty = useTranslations('catalogue.dashboard.item.editor.type')
  const tf = useTranslations('catalogue.dashboard.item.wizard')
  const tfl = useTranslations('catalogue.dashboard.item.fields.links')
  const tl = useTranslations('app.lifecycle')
  const ui = useLocale()
  const router = useRouter()
  const errorText = useCatalogueError()
  const d = site.defaultLocale
  const zone = editingZone(site.timeZone)
  const channels = site.config.channels.map((c) => c.value)
  const optionCounts = useMemo(() => new Map(optionLists.map((l) => [l.id, l.optionCount])), [optionLists])
  const initial: ItemState = useMemo(() => itemStateFromDoc(snapshot.doc, null), [snapshot.doc])
  const archived = snapshot.status.status === 'archived'
  const readOnly = archived || !can.write
  const draft = useCatalogueDraft({ projectSlug, kind: 'item', initialId: snapshot.id, initialRev: snapshot.rev, liveRev: snapshot.live?.rev, hasDraft: snapshot.hasDraft, defaultLocale: d })
  const item = useItemState({ initial, initialPhotos: snapshot.photos.map((p) => ({ assetId: p.assetId, thumbUrl: p.thumbUrl })), channels, optionCounts, defaultLocale: d, update: readOnly ? () => undefined : draft.update })
  // ADR-035: photos still uploading when the person switches tab join the item when ready; Publish waits for them.
  const uploadOwner = `catalogue-item:${useId()}`
  const photosRef = useRef(item.photos)
  useEffect(() => {
    photosRef.current = item.photos
  }, [item.photos])
  const { inFlight: photosInFlight } = useUploadOwner(uploadOwner, (p) => {
    const current = photosRef.current
    if (current.length >= 10 || current.some((x) => x.assetId === p.assetId)) return
    item.setPhotos([...current, { assetId: p.assetId, thumbUrl: p.thumbUrl }])
  })
  const tu = useTranslations('clientDashboard.media.uploads')
  const { s } = item
  const stray = useStrayAddress(item.setSlug)
  const setName = (l: string, v: string) => {
    item.setText('name', l, v)
    stray.onNameChange(l, v, s.slug[l])
  }
  const [tab, setTab] = useState<Tab>('content')
  const [busy, setBusy] = useState(false)
  const [inUse, setInUse] = useState<Referrer[] | null>(null)
  const [confirm, setConfirm] = useState<'delete' | 'discard' | null>(null)
  const [dateOpen, setDateOpen] = useState(false)
  const [typeOpen, setTypeOpen] = useState(false)
  const [publishAt, setPublishAt] = useState<string | null>(snapshot.status.publishOn)
  // The result of the last publish stays on the page (a toast alone disappears). The refresh that follows
  // re-mounts this editor, so the line is handed over through sessionStorage and read back after mounting.
  const [result, setResult] = useState<PublishResult | null>(null)
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(RESULT_KEY(snapshot.id))
      if (raw) {
        window.sessionStorage.removeItem(RESULT_KEY(snapshot.id))
        const restored = JSON.parse(raw) as PublishResult
        queueMicrotask(() => setResult(restored))
      }
    } catch {
      /* storage can be unavailable: the toast still told them */
    }
  }, [snapshot.id])
  const { toast, show } = useUndo()

  const hasFoodInfo = !!s.itemProfile && profileCan(s.itemProfile, 'foodInformation')
  const hasBookInfo = !!s.itemProfile && profileCan(s.itemProfile, 'bookDetails')
  // D7: Options appear when relevant — food, option lists already attached, or any option list in the project.
  const showOptions = itemOptionsRelevant({ itemProfile: s.itemProfile, attachedCount: s.options.length, projectListCount: optionLists.length })
  const tabs: Tab[] = ['content', 'photos', 'prices', ...(hasFoodInfo ? (['details'] as Tab[]) : []), ...(showOptions ? (['options'] as Tab[]) : []), 'page', ...(site.locales.length > 1 ? (['languages'] as Tab[]) : []), 'publishing']
  const name = textIn(s.name, ui, d) || t('untitled')
  const current: Tab = tabs.includes(tab) ? tab : 'content'
  const issues = itemIssues(s, { defaultLocale: d, locales: site.locales, channels, optionCounts })
  const issueCounts = issueCountByTab(issues)
  const adviceOn = adviceTabs(issues)
  // Advice (an ISBN that does not check out) is shown beside its field and never blocks anything.
  const blockers = publishBlockers(issues)
  const canPublish = blockers.length === 0
  const fix = (issue: ItemIssue) => {
    if (issue.id === 'profile') return setTypeOpen(true)
    setTab(tabs.includes(issue.tab) ? issue.tab : 'content')
    focusField(issue.focus)
  }
  const missingLists = attachmentIssues(s.options, optionCounts).filter((i) => i.kind === 'missingList')
  const isLive = Boolean(snapshot.live)
  const tt = useTranslations('catalogue.dashboard.together')
  const afterPublish = (message: string, notLive: Referrer[], outcome: PublishResult = { kind: 'published' }) => {
    setResult(outcome)
    try {
      window.sessionStorage.setItem(RESULT_KEY(snapshot.id), JSON.stringify(outcome))
    } catch {
      /* ignore */
    }
    show({ message: notLive.length ? `${message} ${tt('notLiveAfter', { names: notLive.map((r) => r.label).join(', ') })}` : message, tone: 'status' })
    router.refresh()
  }
  const together = usePublishTogether({
    projectSlug,
    kind: 'item',
    draft,
    isLive,
    // The schedule chosen on the Publishing tab; the hook decides at click time whether it is still in the future.
    publishAt: !isLive ? publishAt : null,
    zone,
    onPublished: (notLive) => afterPublish(tt('published'), notLive),
    onError: (e) => show({ message: errorText(e), tone: 'error' }),
  })

  async function publish(mode: 'now' | 'schedule' | 'keep') {
    if (busy) return
    setBusy(true)
    together.clear()
    try {
      const r = await draft.publish(mode, mode === 'schedule' ? { publishAt } : {}, { keepEditing: true })
      if (!r.ok) {
        if (together.handleRefusal(r)) return
        // E-3: an address without a name in its language — say which, and go to that name.
        const stray = r.error === 'slug_without_name' ? r.detail?.locales?.[0] : undefined
        if (stray) {
          show({ message: tf('slugWithoutName', { language: languageName(stray, ui) }), tone: 'error' })
          setTab(stray === d ? 'content' : site.locales.length > 1 ? 'languages' : 'content')
          focusNameField(stray)
          return
        }
        const named = r.detail?.conflicts?.[0]
        show({ message: named ? tf('slugTaken', { slug: named.slug, name: named.owner.label }) : errorText(r.error), tone: 'error' })
        return
      }
      afterPublish(mode === 'schedule' ? t('scheduled') : t('published'), r.notLive, mode === 'schedule' ? { kind: 'scheduled', at: publishAt } : { kind: 'published' })
    } finally {
      setBusy(false)
    }
  }

  async function act(action: LifecycleAction, expiresAt?: string | null) {
    if (busy) return false
    setBusy(true)
    setInUse(null)
    try {
      await draft.flush()
      const r = await timedAction(`catalogue.lifecycle.${action}`, () => catalogueLifecycleAction({ projectSlug, kind: 'item', op: action, id: snapshot.id, expiresAt }))
      if (!r.ok) {
        if (r.error === 'in_use' && r.detail?.referrers?.length) setInUse(r.detail.referrers)
        else show({ message: errorText(r.error), tone: 'error' })
        return false
      }
      if (action === 'delete' || action === 'deletePermanently') {
        router.push(listHref)
        return true
      }
      // Archive / restore / dates also touch the draft's revision: start again from what is stored.
      window.location.reload()
      return true
    } finally {
      setBusy(false)
    }
  }

  const menu: CardMenuItem[] = [
    ...(!readOnly ? [{ key: 'publishTogether', label: tt('publishItem'), onSelect: () => void draft.flush().then(() => together.openSheet()) }] : []),
    ...(isLive && draft.hasDraft && can.write ? [{ key: 'discard', label: t('discard'), onSelect: () => setConfirm('discard') }] : []),
    ...lifecycleMenu(snapshot.status.status, can).map((e) => ({
      key: e.action,
      label: tl(`actions.${e.action}`),
      destructive: e.destructive,
      separated: e.separated,
      onSelect: () => (e.action === 'delete' || e.action === 'deletePermanently' ? setConfirm('delete') : e.action === 'setUnpublishDate' ? setDateOpen(true) : void act(e.action)),
    })),
  ]

  const primary = !readOnly ? (
    <button type="button" disabled={busy || !canPublish || photosInFlight > 0} onClick={() => void publish(isLive ? 'keep' : 'now')} className={CAT_PRIMARY}>
      {photosInFlight > 0 ? tu('stillUploading', { count: photosInFlight }) : isLive ? t('publishChanges') : t('publish')}
    </button>
  ) : null

  return (
    <div className="space-y-5">
      <Link
        href={listHref}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {CAT_ICONS.back}
        {t('back')}
      </Link>
      <PageHeader
        title={name}
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-2 text-[0.9375rem] text-muted-foreground">
          {s.itemProfile ? <span className="[&>svg]:size-4">{CAT_ICONS[PROFILES[s.itemProfile].icon]}</span> : null}
          <span>{s.itemProfile ? tty(`names.${PROFILES[s.itemProfile].labelKey}`) : tty('notChosen')}</span>
        </span>
        {!readOnly ? (
          <button type="button" onClick={() => setTypeOpen(true)} className="min-h-11 text-[0.9375rem] font-medium text-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {s.itemProfile ? tty('change') : tty('choose')}
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-start gap-2">
        <LifecycleBadge status={snapshot.status.status} changes={draft.hasDraft && isLive} />
        <GapBadges gaps={itemGaps({ imageCount: item.photos.length, offerCount: s.offers.filter((o) => o.price.trim()).length, allergensNotReviewed: hasFoodInfo && declarationIssues(s.allergenDeclaration).length > 0 })} />
      </div>
      {result && !draft.hasDraft ? (
        <p role="status" className="rounded-2xl bg-muted px-4 py-3 text-[0.9375rem] text-foreground">
          {result.kind === 'scheduled' && result.at ? t('resultScheduled', { date: new Intl.DateTimeFormat(ui, { dateStyle: 'full', timeStyle: 'short', timeZone: zone }).format(new Date(result.at)) }) : result.kind === 'scheduled' ? t('scheduled') : t('resultPublished')}
        </p>
      ) : null}
      {!readOnly && !canPublish ? <ItemIssueList issues={blockers} onFix={fix} /> : null}
      <SaveNotice state={draft.state} rejected={draft.rejected} onRetry={draft.retry} onReload={() => void draft.reload()} />
      {archived ? <p className="rounded-2xl bg-muted px-4 py-3 text-[0.9375rem] text-foreground">{t('archivedNotice')}</p> : null}
      {missingLists.length ? (
        <p role="alert" className="rounded-2xl border border-border px-4 py-3 text-[0.9375rem] text-foreground">
          {t('missingList')}
        </p>
      ) : null}
      {inUse ? <InUseNotice projectSlug={projectSlug} referrers={inUse} onClose={() => setInUse(null)} /> : null}
      {together.ui}
      <StrayAddressNotice state={stray} />

      <SegmentTabs label={t('tabsLabel')} value={current} onChange={setTab} options={tabs.map((v) => ({ value: v, label: <TabLabel label={t(`tabs.${v}`)} count={issueCounts[v]} advice={adviceOn.has(v)} /> }))} />

      <fieldset disabled={readOnly} className="min-w-0 space-y-8">
        {current === 'content' ? (
          <>
            <FieldBlock title={hasBookInfo ? tf('nameBook.title') : tf('name.title')}>
              <NameFields locale={d} profile={s.itemProfile} afterName={hasBookInfo ? <BookDetailsFields value={s.bookDetails} onChange={item.setBookDetails} /> : null} name={s.name} byline={s.byline} description={s.description} onName={setName} onByline={(l, v) => item.setText('byline', l, v)} onDescription={(l, v) => item.setText('description', l, v)} />
            </FieldBlock>
            {site.config.categories.length || (canAddCategory && can.write) ? (
              <FieldBlock title={tf('category.title')}>
                <TermPicker projectSlug={projectSlug} module="catalogue" kind="category" label={tf('category.title')} terms={site.config.categories} value={s.categories} onChange={item.setCategories} defaultLocale={d} canAdd={canAddCategory && can.write} />
              </FieldBlock>
            ) : null}
            {site.config.tags.length || (canAddCategory && can.write) ? (
              <FieldBlock title={tf('tag.title')}>
                <TermPicker projectSlug={projectSlug} module="catalogue" kind="tag" label={tf('tag.title')} terms={site.config.tags} value={s.tags} onChange={item.setTags} defaultLocale={d} canAdd={canAddCategory && can.write} />
              </FieldBlock>
            ) : null}
            <FieldBlock title={tfl('title')} helper={tfl('helper')}>
              <LinksField links={s.links} locales={site.locales} defaultLocale={d} onChange={item.setLinks} />
            </FieldBlock>
            <FieldBlock>
              <VisibilityField value={s.visibility} onChange={item.setVisibility} />
            </FieldBlock>
          </>
        ) : current === 'photos' ? (
          <FieldBlock title={tf('photo.title')} helper={tf('photo.helper')}>
            <PhotoField projectSlug={projectSlug} defaultLocale={d} languages={site.locales} photos={item.photos} onChange={item.setPhotos} uploadOwner={uploadOwner} />
          </FieldBlock>
        ) : current === 'prices' ? (
          <FieldBlock title={tf('price.title')} helper={tf('price.helper')}>
            <PriceField offers={s.offers} channels={site.config.channels} currency={site.config.currency} defaultLocale={d} onChange={item.setOffers} />
          </FieldBlock>
        ) : current === 'details' ? (
          <FieldBlock title={tf('details.title')}>
            <FoodInfoField declaration={s.allergenDeclaration} dietary={s.dietary} dietaryTerms={site.config.dietaryTags} defaultLocale={d} onDeclaration={item.setDeclaration} onDietary={item.setDietary} />
          </FieldBlock>
        ) : current === 'options' ? (
          <FieldBlock title={tf('options.title')} helper={tf('options.helper')}>
            <OptionsField projectSlug={projectSlug} options={s.options} lists={optionLists} onChange={item.setOptions} />
          </FieldBlock>
        ) : current === 'page' ? (
          <FieldBlock title={tf('page.title')}>
            <PageField projectSlug={projectSlug} docId={snapshot.id} hasPage={s.hasPage} slug={s.slug} name={s.name} segment={site.config.segment} locales={site.locales} defaultLocale={d} onHasPage={item.setHasPage} onSlug={item.setSlug} />
          </FieldBlock>
        ) : current === 'languages' ? (
          <FieldBlock title={tf('languages.title')}>
            <LanguagesField locales={site.locales} defaultLocale={d} profile={s.itemProfile} name={s.name} byline={s.byline} description={s.description} onName={setName} onByline={(l, v) => item.setText('byline', l, v)} onDescription={(l, v) => item.setText('description', l, v)} />
          </FieldBlock>
        ) : (
          <>
            <FieldBlock title={t('preview')}>
              <div className="max-w-md">
                <ItemPreview profile={s.itemProfile} bookDetails={s.bookDetails} name={s.name} byline={s.byline} description={s.description} photo={item.photos[0]?.thumbUrl ?? null} offers={s.offers} channels={site.config.channels} currency={site.config.currency} declaration={hasFoodInfo ? s.allergenDeclaration : null} locale={ui} defaultLocale={d} />
              </div>
            </FieldBlock>
            {!readOnly && !isLive ? (
              <FieldBlock title={tl('dates.publishOn')} helper={t('scheduleHelp')}>
                <PublicationDateField id="item-editor-publish-on" label={tl('dates.publishOn')} value={publishAt} onChange={setPublishAt} zone={zone} inputClassName={CAT_INPUT} />
                <button type="button" disabled={busy || !publishAt || !canPublish || photosInFlight > 0} onClick={() => void publish('schedule')} className={CAT_PRIMARY}>
                  {t('schedule')}
                </button>
              </FieldBlock>
            ) : null}
          </>
        )}
      </fieldset>

      {/* Phones: the primary action sits at the bottom. */}
      {primary ? <div className="md:hidden">{primary}</div> : null}

      <DeletePermanentlyDialog
        open={confirm === 'delete'}
        titles={[name]}
        busy={busy}
        onConfirm={async () => {
          if (await act(snapshot.status.status === 'draft' ? 'delete' : 'deletePermanently')) setConfirm(null)
          else setConfirm(null)
        }}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'discard'}
        title={t('discardTitle')}
        body={t('discardBody', { name })}
        confirmLabel={t('discard')}
        busy={busy}
        onConfirm={async () => {
          setBusy(true)
          const r = await draft.discardChanges()
          setBusy(false)
          setConfirm(null)
          if (r.ok) window.location.reload()
          else show({ message: errorText(r.error), tone: 'error' })
        }}
        onCancel={() => setConfirm(null)}
      />
      <ChangeTypeSheet
        open={typeOpen}
        current={s.itemProfile}
        hasBookDetails={Boolean(s.bookDetails.author.trim() || s.bookDetails.publisher.trim() || s.bookDetails.year.trim() || s.bookDetails.isbn.trim())}
        onClose={() => setTypeOpen(false)}
        onChange={item.setProfile}
      />
      <UnpublishDateSheet
        open={dateOpen}
        busy={busy}
        zone={zone}
        onClose={() => setDateOpen(false)}
        onSave={async (iso) => {
          if (await act('setUnpublishDate', iso)) setDateOpen(false)
        }}
        onRemove={snapshot.status.unpublishOn ? async () => void ((await act('setUnpublishDate', null)) && setDateOpen(false)) : undefined}
      />
      <Toast message={toast?.message ?? null} tone={toast?.tone} />
    </div>
  )
}
