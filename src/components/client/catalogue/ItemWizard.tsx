'use client'

import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link, useRouter } from '@/i18n/navigation'
import { WizardFrame } from '@/components/client/create/WizardFrame'
import { StepHeading } from '@/components/client/create/StepHeading'
import { ChoiceCard, ChoiceCardGrid } from '@/components/app/ui/ChoiceCard'
import { PublicationDateField } from '@/components/app/lifecycle/PublicationDateField'
import { editingZone } from '@/components/app/lifecycle/zoned-time'
import type { CatalogueSite } from '@/lib/api/catalogue-drafts'
import { NOT_REVIEWED, canAdvanceItem, initialItemProfile, itemWizardSteps, type ItemState, type ItemStep } from '@/lib/modules/catalogue/dashboard-form'
import { CAT_BUTTON, CAT_ICONS, CAT_INPUT, CAT_PRIMARY, useCatalogueError } from './catalogue-ui'
import { FoodInfoField, ItemPreview, LanguagesField, NameFields, OptionsField, PageField, PhotoField, PriceField, ProfileField, TermChips, type OptionListChoice } from './item-fields'
import { useCatalogueDraft, type PublishMode } from './use-catalogue-draft'
import { StrayAddressNotice, useStrayAddress } from './stray-address'
import { languageName } from '@/components/client/create/StepHeading'
import { useItemState } from './use-item-state'

type Choice = 'now' | 'schedule' | 'draft'
type Done = { kind: 'live' } | { kind: 'scheduled'; at: string } | { kind: 'draft' }

/**
 * The item wizard (spec §10.3, content-wizard-spec): one decision per
 * screen, cards not dropdowns, autosave with the Saved pill, sticky Back/Next
 * in the shared WizardFrame. "What are you offering?" (ADR-033 D-2) is always
 * the first step, preselected from the module setting `defaultItemProfile`;
 * "Food information" (allergen declaration, D-3) appears for food and drink
 * only; languages only on multilingual sites. Never asked: visibility (public), currency (the project's), the slug
 * (derived from the name, unique across items and collections).
 *
 * Lazy creation: nothing exists until the name is typed; then the URL becomes
 * /catalogue/<id> without a reload, and closing the browser loses nothing.
 */
export function ItemWizard({ projectSlug, site, optionLists, listHref }: { projectSlug: string; site: CatalogueSite; optionLists: OptionListChoice[]; listHref: string }) {
  const t = useTranslations('catalogue.dashboard.item.wizard')
  const tc = useTranslations('clientDashboard.create')
  const tl = useTranslations('app.lifecycle')
  const ui = useLocale()
  const router = useRouter()
  const errorText = useCatalogueError()
  const d = site.defaultLocale
  const zone = editingZone(site.timeZone)
  const channels = site.config.channels.map((c) => c.value)
  const optionCounts = useMemo(() => new Map(optionLists.map((l) => [l.id, l.optionCount])), [optionLists])
  const initial: ItemState = useMemo(
    () => ({ itemProfile: initialItemProfile(site.config.defaultItemProfile), name: {}, description: {}, categories: [], imageIds: [], offers: [], allergenDeclaration: NOT_REVIEWED, dietary: [], options: [], hasPage: false, slug: {}, visibility: 'public' }),
    [site.config.defaultItemProfile]
  )
  const profileRef = useRef(initial.itemProfile)
  const createExtra = useCallback(() => (profileRef.current ? { itemProfile: profileRef.current } : {}), [])
  const draft = useCatalogueDraft({ projectSlug, kind: 'item', initialId: '', initialRev: '', hasDraft: false, defaultLocale: d, create: createExtra })
  const item = useItemState({ initial, initialPhotos: [], channels, optionCounts, update: draft.update })
  const { s } = item
  const stray = useStrayAddress(item.setSlug)
  const setName = (l: string, v: string) => {
    item.setText('name', l, v)
    stray.onNameChange(l, v, s.slug[l])
  }

  const steps = itemWizardSteps({ itemProfile: s.itemProfile, categoryCount: site.config.categories.length, locales: site.locales })
  const [step, setStep] = useState<ItemStep | 'done'>(steps[0])
  const [choice, setChoice] = useState<Choice>('now')
  const [publishAt, setPublishAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const mainRef = useRef<HTMLDivElement>(null)
  const index = step === 'done' ? steps.length : Math.max(0, steps.indexOf(step))

  const go = (next: ItemStep | 'done') => {
    setStep(next)
    setError(null)
    mainRef.current?.scrollTo?.({ top: 0 })
  }
  const ctx = { channels, optionCounts }
  const canNext = step !== 'done' && canAdvanceItem(step, s, d, ctx)
  const goNext = () => {
    if (step === 'done' || !canNext) return
    if (step === 'publish') return void finish()
    const next = steps[index + 1]
    if (next) go(next)
  }
  const goBack = () => {
    const prev = steps[index - 1]
    if (prev) go(prev)
  }
  const exit = async () => {
    await draft.flush()
    router.push(draft.created ? `/${projectSlug}/catalogue/${draft.id}` : listHref)
  }

  async function finish() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (choice === 'draft') {
        const ok = await draft.flush()
        if (!ok) return setError(errorText(draft.state === 'conflict' ? 'conflict' : 'offline'))
        setDone({ kind: 'draft' })
        return go('done')
      }
      if (choice === 'schedule' && !publishAt) return setError(tl('dates.mustBeFuture'))
      const mode: PublishMode = choice === 'schedule' ? 'schedule' : 'now'
      const r = await draft.publish(mode, mode === 'schedule' ? { publishAt } : {})
      if (!r.ok) {
        const named = r.detail?.conflicts?.[0]
        if (named) return setError(t('slugTaken', { slug: named.slug, name: named.owner.label }))
        // D-4: name what is still unpublished; the item editor offers "Publish item and dependencies".
        if (r.error === 'slug_without_name' && r.detail?.locales?.length) return setError(t('slugWithoutName', { language: languageName(r.detail.locales[0], ui) }))
        const names = r.detail?.dependencies?.map((x) => x.label).join(', ')
        if (names && r.error === 'option_allergens_not_reviewed') return setError(t('optionAllergens', { names }))
        if (names) return setError(t('dependencies', { names }))
        return setError(errorText(r.error))
      }
      setDone(mode === 'schedule' && publishAt ? { kind: 'scheduled', at: publishAt } : { kind: 'live' })
      go('done')
    } catch {
      setError(errorText('offline'))
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (e.defaultPrevented || target.closest('dialog')) return
    if (e.key === 'Escape' && step !== 'done') {
      e.preventDefault()
      void exit()
    } else if (e.key === 'Enter' && !e.shiftKey && target.matches('[data-enter-next]') && canNext) {
      e.preventDefault()
      goNext()
    }
  }

  const heading = (id: string, key: string, helper = true) => <StepHeading id={id} title={t(`${key}.title`)} helper={helper ? t(`${key}.helper`) : undefined} />
  const optional = step !== 'done' && step !== 'name' && step !== 'profile' && step !== 'preview' && step !== 'publish'
  const primaryLabel = step === 'publish' ? (busy ? t('working') : t(`publish.${choice}`)) : tc('shell.next')

  return (
    <WizardFrame
      onKeyDown={onKeyDown}
      mainRef={mainRef}
      exit={step === 'done' ? null : draft.created ? { kind: 'save', onPress: () => void exit() } : { kind: 'close', onPress: () => router.push(listHref) }}
      saveState={draft.state}
      onReload={() => void draft.reload()}
      onRetry={draft.retry}
      rejected={draft.rejected}
      footer={
        step === 'done'
          ? null
          : {
              hint: error ?? (step === 'name' && !canNext ? t('name.needed') : step === 'profile' && !canNext ? t('profile.needed') : optional ? t('optional') : null),
              progress: { current: index + 1, total: steps.length },
              back: index > 0 ? { onPress: goBack, disabled: busy } : null,
              primary: { label: primaryLabel, onPress: goNext, disabled: !canNext || busy || (step === 'publish' && !draft.created), busy },
            }
      }
    >
      <section aria-labelledby={`item-step-${step}`}>
        {step === 'profile' ? (
          <>
            {heading('item-step-profile', 'profile')}
            <div className="mt-8">
              <ProfileField
                value={s.itemProfile}
                onChange={(v) => {
                  profileRef.current = v
                  item.setProfile(v)
                }}
              />
            </div>
          </>
        ) : step === 'name' ? (
          <>
            {heading('item-step-name', 'name')}
            <div className="mt-8">
              <NameFields autoFocus locale={d} name={s.name} description={s.description} onName={setName} onDescription={(l, v) => item.setText('description', l, v)} />
            </div>
          </>
        ) : step === 'category' ? (
          <>
            {heading('item-step-category', 'category')}
            <div className="mt-8">
              <TermChips label={t('category.title')} terms={site.config.categories} value={s.categories} onChange={item.setCategories} defaultLocale={d} />
            </div>
          </>
        ) : step === 'photo' ? (
          <>
            {heading('item-step-photo', 'photo')}
            <div className="mt-8">
              <PhotoField projectSlug={projectSlug} defaultLocale={d} photos={item.photos} onChange={item.setPhotos} />
            </div>
          </>
        ) : step === 'price' ? (
          <>
            {heading('item-step-price', 'price')}
            <div className="mt-8">
              <PriceField offers={s.offers} channels={site.config.channels} currency={site.config.currency} defaultLocale={d} onChange={item.setOffers} />
            </div>
          </>
        ) : step === 'details' ? (
          <>
            {heading('item-step-details', 'details')}
            <div className="mt-8">
              <FoodInfoField declaration={s.allergenDeclaration} dietary={s.dietary} dietaryTerms={site.config.dietaryTags} defaultLocale={d} onDeclaration={item.setDeclaration} onDietary={item.setDietary} />
            </div>
          </>
        ) : step === 'options' ? (
          <>
            {heading('item-step-options', 'options')}
            <div className="mt-8">
              <OptionsField projectSlug={projectSlug} options={s.options} lists={optionLists} onChange={item.setOptions} />
            </div>
          </>
        ) : step === 'page' ? (
          <>
            {heading('item-step-page', 'page')}
            <div className="mt-8">
              <PageField
                projectSlug={projectSlug}
                docId={draft.id}
                hasPage={s.hasPage}
                slug={s.slug}
                name={s.name}
                segment={site.config.segment}
                locales={site.locales}
                defaultLocale={d}
                onHasPage={item.setHasPage}
                onSlug={item.setSlug}
              />
            </div>
          </>
        ) : step === 'languages' ? (
          <>
            {heading('item-step-languages', 'languages')}
            <div className="mt-8">
              <StrayAddressNotice state={stray} />
              <LanguagesField locales={site.locales} defaultLocale={d} name={s.name} description={s.description} onName={setName} onDescription={(l, v) => item.setText('description', l, v)} />
            </div>
          </>
        ) : step === 'preview' ? (
          <>
            {heading('item-step-preview', 'preview')}
            <div className="mt-8">
              <ItemPreview name={s.name} description={s.description} photo={item.photos[0]?.thumbUrl ?? null} offers={s.offers} channels={site.config.channels} currency={site.config.currency} declaration={s.itemProfile === 'foodOrDrink' ? s.allergenDeclaration : null} locale={ui} defaultLocale={d} />
            </div>
          </>
        ) : step === 'publish' ? (
          <>
            {heading('item-step-publish', 'publish', false)}
            <div className="mt-8">
              <ChoiceCardGrid label={t('publish.title')} kind="radio">
                <ChoiceCard icon={CAT_ICONS.check} label={t('publish.choiceNow')} selected={choice === 'now'} onSelect={() => setChoice('now')} />
                <ChoiceCard icon={CAT_ICONS.list} label={t('publish.choiceSchedule')} selected={choice === 'schedule'} onSelect={() => setChoice('schedule')} />
                <ChoiceCard icon={CAT_ICONS.cards} label={t('publish.choiceDraft')} selected={choice === 'draft'} onSelect={() => setChoice('draft')} />
              </ChoiceCardGrid>
              {choice === 'schedule' ? <PublicationDateField id="item-publish-on" className="mt-6" label={tl('dates.publishOn')} value={publishAt} onChange={setPublishAt} zone={zone} inputClassName={CAT_INPUT} /> : null}
            </div>
          </>
        ) : done ? (
          <div className="flex flex-col items-start pt-10">
            <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-muted text-success">
              {CAT_ICONS.check}
            </span>
            <h1 id="item-step-done" className="mt-6 text-[1.875rem] leading-9 font-semibold tracking-tight text-foreground">
              {t(`done.${done.kind}`)}
            </h1>
            <p className="mt-3 text-[1.0625rem] leading-7 text-muted-foreground">
              {done.kind === 'scheduled' ? t('done.scheduledBody', { date: new Intl.DateTimeFormat(ui, { dateStyle: 'full', timeStyle: 'short', timeZone: zone }).format(new Date(done.at)) }) : t(`done.${done.kind}Body`)}
            </p>
            <div className="mt-10 flex w-full flex-col gap-3 sm:flex-row">
              <Link href={`/${projectSlug}/catalogue/${draft.id}`} className={CAT_PRIMARY}>
                {t('done.open')}
              </Link>
              <button type="button" className={CAT_BUTTON} onClick={() => window.location.assign(window.location.pathname.replace(/\/[^/]+\/?$/, '/new'))}>
                {t('done.another')}
              </button>
              <Link href={listHref} className={CAT_BUTTON}>
                {t('done.list')}
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </WizardFrame>
  )
}
