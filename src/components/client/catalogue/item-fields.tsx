'use client'

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { ChoiceCard, ChoiceCardGrid } from '@/components/app/ui/ChoiceCard'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { ToggleChips } from '@/components/app/ui/ToggleChips'
import { Switch } from '@/components/app/ui/Switch'
import { MediaFrame, Pill } from '@/components/app/ui/list/cells'
import { MediaLibraryPicker } from '@/components/client/media/MediaLibraryPicker'
import { languageName } from '@/components/client/create/StepHeading'
import { checkCatalogueSlugsAction } from '@/app/[locale]/(client)/[tenant]/catalogue/actions'
import { ALLERGENS, type AllergenKey } from '@/lib/modules/catalogue/allergens'
import { WEEKDAYS, type Weekday } from '@/lib/modules/catalogue/availability'
import { formatPrice } from '@/lib/modules/catalogue/resolve'
import { CATALOGUE_LINK_LIMITS } from '@/lib/modules/catalogue/links'
import type { CatalogueTerm } from '@/lib/api/catalogue-drafts'
import type { NamedSlugConflict } from '@/lib/modules/catalogue/validation'
import {
  ITEM_PROFILES,
  attachmentIssues,
  declarationIssues,
  offerFormIssues,
  parsePrice,
  linkFormIssues,
  moveIndex,
  slugFromName,
  slugPreview,
  wrapsMidnight,
  type AttachmentForm,
  type DeclarationForm,
  type ItemProfile,
  type LinkForm,
  type OfferForm,
  type Texts,
  type Visibility,
} from '@/lib/modules/catalogue/dashboard-form'
import { CAT_BUTTON, CAT_ICON_BUTTON, CAT_ICONS, CAT_INPUT, CAT_LABEL, CAT_TEXTAREA, catalogueHref, textIn } from './catalogue-ui'

export type ItemPhoto = { assetId: string; thumbUrl: string | null }
export type OptionListChoice = { id: string; name: string; optionCount: number; isDraft: boolean }

const newKey = () => Math.random().toString(36).slice(2, 14)

/** A titled block of fields (editor tabs); the wizard passes its StepHeading instead. */
export function FieldBlock({ title, helper, children }: { title?: string; helper?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      {title ? <h2 className="text-lg font-semibold text-foreground">{title}</h2> : null}
      {helper ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{helper}</p> : null}
      {children}
    </section>
  )
}

const termLabel = (t: CatalogueTerm, ui: string, d: string) => textIn(t.label, ui, d) || t.value

// ── Profile (ADR-033 D-2: "What are you offering?") ──────────────────────────

export function ProfileField({ value, onChange }: { value: ItemProfile | null; onChange: (v: ItemProfile) => void }) {
  const t = useTranslations('catalogue.dashboard.itemProfiles')
  return (
    <ChoiceCardGrid label={t('label')} kind="radio">
      {ITEM_PROFILES.map((p) => (
        <ChoiceCard key={p} icon={CAT_ICONS[p]} label={t(p)} selected={value === p} onSelect={() => onChange(p)} />
      ))}
    </ChoiceCardGrid>
  )
}

// ── Name ─────────────────────────────────────────────────────────────────────

export function NameFields({ locale, name, byline, description, onName, onByline, onDescription, autoFocus = false }: { locale: string; name: Texts; /** Items only (F-1); collections have no byline. */ byline?: Texts; description: Texts; onName: (l: string, v: string) => void; onByline?: (l: string, v: string) => void; onDescription: (l: string, v: string) => void; autoFocus?: boolean }) {
  const t = useTranslations('catalogue.dashboard.item.fields')
  const id = useId()
  return (
    <div className="space-y-5">
      <div>
        <label htmlFor={`${id}-name`} className={CAT_LABEL}>
          {t('name')}
        </label>
        <input id={`${id}-name`} data-name-locale={locale} data-enter-next autoFocus={autoFocus} maxLength={120} value={name[locale] ?? ''} onChange={(e) => onName(locale, e.target.value)} className={CAT_INPUT} />
      </div>
      {byline && onByline ? (
        <div>
          <label htmlFor={`${id}-byline`} className={CAT_LABEL}>
            {t('byline')}
          </label>
          <input id={`${id}-byline`} data-enter-next maxLength={160} value={byline[locale] ?? ''} onChange={(e) => onByline(locale, e.target.value)} className={CAT_INPUT} />
          <p className="mt-1.5 text-sm text-muted-foreground">{t('bylineHelp')}</p>
        </div>
      ) : null}
      <div>
        <label htmlFor={`${id}-desc`} className={CAT_LABEL}>
          {t('description')}
        </label>
        <textarea id={`${id}-desc`} maxLength={600} value={description[locale] ?? ''} onChange={(e) => onDescription(locale, e.target.value)} className={CAT_TEXTAREA} />
        <p className="mt-1.5 text-sm text-muted-foreground">{t('descriptionHelp')}</p>
      </div>
    </div>
  )
}

// ── Links (Amendment F-2) — add, remove, reorder; label per language + address ─

export function LinksField({ links, locales, defaultLocale, onChange }: { links: LinkForm[]; locales: readonly string[]; defaultLocale: string; onChange: (next: LinkForm[]) => void }) {
  const t = useTranslations('catalogue.dashboard.item.fields.links')
  const ui = useLocale()
  const id = useId()
  const issues = linkFormIssues(links, defaultLocale)
  const issueOf = (key: string) => issues.find((i) => i.key === key)?.kind
  const setLink = (key: string, next: Partial<LinkForm>) => onChange(links.map((l) => (l.key === key ? { ...l, ...next } : l)))
  return (
    <div className="space-y-4">
      {links.length ? (
        <ul className="space-y-4">
          {links.map((l, n) => {
            const issue = issueOf(l.key)
            return (
              <li key={l.key} className="rounded-2xl border border-border p-4" data-link={l.key}>
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1 space-y-3">
                    {locales.map((loc) => (
                      <div key={loc}>
                        <label htmlFor={`${id}-${l.key}-${loc}`} className="text-sm text-foreground">
                          {locales.length > 1 ? t('labelIn', { language: languageName(loc, ui) }) : t('label')}
                        </label>
                        <input id={`${id}-${l.key}-${loc}`} maxLength={80} value={l.label[loc] ?? ''} onChange={(e) => setLink(l.key, { label: { ...l.label, [loc]: e.target.value } })} className={CAT_INPUT} />
                      </div>
                    ))}
                    <div>
                      <label htmlFor={`${id}-${l.key}-url`} className="text-sm text-foreground">
                        {t('url')}
                      </label>
                      <input id={`${id}-${l.key}-url`} type="url" inputMode="url" autoComplete="off" placeholder="https://" maxLength={2048} value={l.url} onChange={(e) => setLink(l.key, { url: e.target.value })} aria-invalid={issue === 'badUrl' || undefined} className={CAT_INPUT} />
                      {issue ? (
                        <p role="alert" className="mt-1.5 text-sm text-foreground">
                          {t(issue)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <button type="button" aria-label={t('up')} disabled={n === 0} onClick={() => onChange(moveIndex(links, n, n - 1))} className={CAT_ICON_BUTTON}>
                    {CAT_ICONS.up}
                  </button>
                  <button type="button" aria-label={t('down')} disabled={n === links.length - 1} onClick={() => onChange(moveIndex(links, n, n + 1))} className={CAT_ICON_BUTTON}>
                    {CAT_ICONS.down}
                  </button>
                  <button type="button" aria-label={t('remove')} onClick={() => onChange(links.filter((x) => x.key !== l.key))} className={CAT_ICON_BUTTON}>
                    {CAT_ICONS.trash}
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}
      {links.length < CATALOGUE_LINK_LIMITS.links ? (
        <button type="button" onClick={() => onChange([...links, { key: newKey(), label: {}, url: '' }])} className={CAT_BUTTON}>
          {CAT_ICONS.plus}
          {t('add')}
        </button>
      ) : null}
    </div>
  )
}

// ── Categories / dietary ─────────────────────────────────────────────────────

export function TermChips({ label, terms, value, onChange, defaultLocale }: { label: string; terms: readonly CatalogueTerm[]; value: string[]; onChange: (v: string[]) => void; defaultLocale: string }) {
  const ui = useLocale()
  return <ToggleChips label={label} options={terms.map((c) => ({ value: c.value, label: termLabel(c, ui, defaultLocale) }))} value={value} onChange={onChange} />
}

// ── Photos (Media Library first — every image is an asset before it is used) ─

export function PhotoField({ projectSlug, defaultLocale, photos, onChange, max = 10 }: { projectSlug: string; defaultLocale: string; photos: ItemPhoto[]; onChange: (next: ItemPhoto[]) => void; max?: number }) {
  const t = useTranslations('catalogue.dashboard.item.photos')
  const [picking, setPicking] = useState(false)
  return (
    <div className="space-y-4">
      {photos.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.assetId} className="flex flex-col items-start gap-2">
              <div className="relative w-full overflow-hidden rounded-xl border border-border">
                <MediaFrame src={p.thumbUrl} alt="" size={{ width: '100%', height: '8rem' }} />
                {i === 0 ? (
                  <span className="absolute top-2 left-2">
                    <Pill tone="highlight">{t('main')}</Pill>
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1">
                {i > 0 ? (
                  <button type="button" onClick={() => onChange([p, ...photos.filter((x) => x.assetId !== p.assetId)])} className={CAT_BUTTON}>
                    {t('makeMain')}
                  </button>
                ) : null}
                <button type="button" aria-label={t('remove')} onClick={() => onChange(photos.filter((x) => x.assetId !== p.assetId))} className={CAT_ICON_BUTTON}>
                  {CAT_ICONS.trash}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.9375rem] text-muted-foreground">{t('none')}</p>
      )}
      {photos.length < max ? (
        <button type="button" onClick={() => setPicking(true)} className={CAT_BUTTON}>
          {CAT_ICONS.photo}
          {t('choose')}
        </button>
      ) : null}
      {picking ? (
        <MediaLibraryPicker
          projectSlug={projectSlug}
          scope="media"
          defaultLocale={defaultLocale}
          exclude={photos.map((p) => p.assetId)}
          room={max - photos.length}
          onClose={() => setPicking(false)}
          onAdd={(added) => {
            setPicking(false)
            onChange([...photos, ...added.map((a) => ({ assetId: a.assetId, thumbUrl: a.thumbUrl }))].slice(0, max))
          }}
        />
      ) : null}
    </div>
  )
}

// ── Prices (one per channel + everywhere; optional serving times) ────────────

export function PriceField({ offers, channels, currency, defaultLocale, onChange }: { offers: OfferForm[]; channels: readonly CatalogueTerm[]; currency: string; defaultLocale: string; onChange: (next: OfferForm[]) => void }) {
  const t = useTranslations('catalogue.dashboard.item.price')
  const td = useTranslations('catalogue.dashboard.days')
  const ui = useLocale()
  const id = useId()
  const channelValues = channels.map((c) => c.value)
  const issues = offerFormIssues(offers, channelValues)
  const issueFor = (key: string) => issues.filter((i) => ('key' in i && i.key === key) || (i.kind === 'overlappingOffers' && i.keys.includes(key)))
  const scopeLabel = (ch: string | null) => {
    if (ch === null) return channels.length ? t('everywhere') : t('price')
    const term = channels.find((c) => c.value === ch)
    return term ? termLabel(term, ui, defaultLocale) : t('unknownChannel', { channel: ch })
  }
  const set = (key: string, patch: Partial<OfferForm>) => onChange(offers.map((o) => (o.key === key ? { ...o, ...patch } : o)))
  const addAnother = (channel: string | null) => {
    const lastIndex = offers.map((o) => o.channel).lastIndexOf(channel)
    const row: OfferForm = { key: newKey(), channel, price: '', availability: [{ key: newKey(), days: [], from: '', to: '' }] }
    onChange([...offers.slice(0, lastIndex + 1), row, ...offers.slice(lastIndex + 1)])
  }
  const remove = (key: string) => {
    const row = offers.find((o) => o.key === key)
    const sameScope = offers.filter((o) => o.channel === row?.channel)
    // The last row of a scope stays (emptied): an empty price means "not sold that way".
    if (sameScope.length <= 1) set(key, { price: '', availability: [] })
    else onChange(offers.filter((o) => o.key !== key))
  }
  const dayOptions = WEEKDAYS.map((d) => ({ value: d, label: td(d) }))
  return (
    <div className="space-y-4">
      {offers.map((o, n) => {
        const mine = issueFor(o.key)
        const parsed = parsePrice(o.price)
        const firstOfScope = offers.findIndex((x) => x.channel === o.channel) === n
        return (
          <div key={o.key} className="rounded-2xl border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <label htmlFor={`${id}-${o.key}`} className={CAT_LABEL}>
                {scopeLabel(o.channel)}
                {!firstOfScope ? <span className="ml-2 text-sm font-normal text-muted-foreground">{t('anotherTime')}</span> : null}
              </label>
              {o.price || o.availability.length || !firstOfScope ? (
                <button type="button" aria-label={t('remove')} onClick={() => remove(o.key)} className={`-mt-2 -mr-2 ${CAT_ICON_BUTTON}`}>
                  {CAT_ICONS.trash}
                </button>
              ) : null}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id={`${id}-${o.key}`}
                inputMode="decimal"
                autoComplete="off"
                placeholder={t('placeholder')}
                value={o.price}
                onChange={(e) => set(o.key, { price: e.target.value })}
                aria-invalid={mine.some((i) => i.kind === 'invalidPrice') || undefined}
                className={`${CAT_INPUT} mt-0 max-w-40`}
              />
              <span className="text-[0.9375rem] text-muted-foreground">{currency}</span>
              {parsed !== null && o.price ? <span className="text-sm text-muted-foreground">{formatPrice(parsed, currency, ui)}</span> : null}
            </div>
            {mine.some((i) => i.kind === 'invalidPrice' || i.kind === 'negativePrice' || i.kind === 'tooManyDecimals') ? <p className="mt-2 text-sm text-destructive">{t('invalidPrice')}</p> : null}
            {mine.some((i) => i.kind === 'overlappingOffers') ? <p className="mt-2 text-sm text-destructive">{t('overlap')}</p> : null}
            {mine.some((i) => i.kind === 'zeroLength' || i.kind === 'incompleteWindow' || i.kind === 'invalidTime') ? <p className="mt-2 text-sm text-destructive">{t('badTimes')}</p> : null}

            {o.availability.map((a) => (
              <div key={a.key} className="mt-4 space-y-3 rounded-xl bg-muted p-3">
                <ToggleChips
                  label={t('days')}
                  size="compact"
                  options={dayOptions}
                  value={a.days}
                  onChange={(days) => set(o.key, { availability: o.availability.map((x) => (x.key === a.key ? { ...x, days: days as Weekday[] } : x)) })}
                />
                <p className="text-sm text-muted-foreground">{a.days.length ? null : t('everyDay')}</p>
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col text-sm text-foreground">
                    {t('from')}
                    <input type="time" value={a.from} onChange={(e) => set(o.key, { availability: o.availability.map((x) => (x.key === a.key ? { ...x, from: e.target.value } : x)) })} className={`${CAT_INPUT} w-36`} />
                  </label>
                  <label className="flex flex-col text-sm text-foreground">
                    {t('to')}
                    <input type="time" value={a.to} onChange={(e) => set(o.key, { availability: o.availability.map((x) => (x.key === a.key ? { ...x, to: e.target.value } : x)) })} className={`${CAT_INPUT} w-36`} />
                  </label>
                  <button type="button" onClick={() => set(o.key, { availability: o.availability.filter((x) => x.key !== a.key) })} className={CAT_BUTTON}>
                    {t('removeTimes')}
                  </button>
                </div>
                {wrapsMidnight(a) ? <p className="text-sm text-muted-foreground">{t('overnight')}</p> : null}
              </div>
            ))}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => set(o.key, { availability: [...o.availability, { key: newKey(), days: [], from: '', to: '' }] })} className={CAT_BUTTON}>
                {o.availability.length ? t('addMoreTimes') : t('addTimes')}
              </button>
              {firstOfScope && o.price ? (
                <button type="button" onClick={() => addAnother(o.channel)} className={CAT_BUTTON}>
                  {t('addAnother')}
                </button>
              ) : null}
            </div>
          </div>
        )
      })}
      {channels.length ? <p className="text-sm text-muted-foreground">{t('everywhereHelp')}</p> : null}
    </div>
  )
}

// ── Food information (ADR-033 D-3): allergen declaration + dietary ───────────
//
// An explicit declaration, never inferred: "Contains" (all fourteen EU
// allergens listed, none can be hidden; "May contain" kept separate) or "No
// allergens from the EU list declared" with an explicit confirmation. Until one
// is complete the item cannot be published.

function AllergenGrid({ legend, help, value, onChange }: { legend: string; help?: string; value: AllergenKey[]; onChange: (v: AllergenKey[]) => void }) {
  const ta = useTranslations('catalogue.allergens')
  return (
    <fieldset>
      <legend className={CAT_LABEL}>{legend}</legend>
      {help ? <p className="mt-1 text-sm text-muted-foreground">{help}</p> : null}
      <ul className="mt-3 grid gap-x-4 sm:grid-cols-2">
        {ALLERGENS.map((a) => (
          <li key={a}>
            <label className="flex cursor-pointer items-start gap-2">
              <Checkbox aria-label={ta(a)} checked={value.includes(a)} onChange={(on) => onChange(on ? ALLERGENS.filter((x) => x === a || value.includes(x)) : value.filter((x) => x !== a))} />
              <span aria-hidden="true" className="pt-2.5 text-[0.9375rem] leading-6 text-foreground">
                {ta(a)}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  )
}

/**
 * The allergen declaration control (D-3), shared by the item's Food
 * information step and each free-text "add" choice of an option list (D-3a,
 * `withNote={false}`: choices carry no note).
 */
export function AllergenDeclarationField({
  declaration,
  defaultLocale,
  onChange,
  withNote = true,
  compactHeading = false,
}: {
  declaration: DeclarationForm
  defaultLocale: string
  onChange: (v: DeclarationForm) => void
  withNote?: boolean
  /** Inside an option row: a smaller heading. */
  compactHeading?: boolean
}) {
  const t = useTranslations('catalogue.dashboard.item.details')
  const id = useId()
  const issues = declarationIssues(declaration)
  const set = (patch: Partial<DeclarationForm>) => onChange({ ...declaration, ...patch })
  return (
    <div className="space-y-6">
      <div>
        <p className={compactHeading ? 'text-sm font-medium text-foreground' : CAT_LABEL}>{t('allergens')}</p>
        {!compactHeading ? <p className="mt-1 text-sm text-muted-foreground">{t('allergensHelp')}</p> : null}
        {declaration.status === 'notReviewed' ? (
          <p className="mt-2">
            <Pill tone="outline">{t('notReviewed')}</Pill>
          </p>
        ) : null}
        <div className="mt-3">
          <ChoiceCardGrid label={t('allergens')} kind="radio">
            <ChoiceCard icon={CAT_ICONS.list} label={t('contains')} selected={declaration.status === 'containsListedAllergens'} onSelect={() => set({ status: 'containsListedAllergens' })} />
            <ChoiceCard icon={CAT_ICONS.check} label={t('noneDeclared')} selected={declaration.status === 'noneDeclared'} onSelect={() => set({ status: 'noneDeclared' })} />
          </ChoiceCardGrid>
        </div>
      </div>
      {declaration.status === 'containsListedAllergens' ? (
        <AllergenGrid legend={t('containsLegend')} help={t('containsHelp')} value={declaration.allergens} onChange={(allergens) => set({ allergens })} />
      ) : null}
      {declaration.status === 'noneDeclared' ? (
        <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-border p-3">
          <Checkbox aria-label={t('confirmNone')} checked={declaration.confirmed} onChange={(on) => set({ confirmed: on })} />
          <span aria-hidden="true" className="pt-2.5 text-[0.9375rem] leading-6 text-foreground">
            {t('confirmNone')}
          </span>
        </label>
      ) : null}
      {/* E-1: "may contain" in BOTH reviewed states (cross-contamination with no listed ingredient). */}
      {declaration.status !== 'notReviewed' ? (
        <AllergenGrid legend={t('mayContainLegend')} help={t('mayContainHelp')} value={declaration.mayContain} onChange={(mayContain) => set({ mayContain })} />
      ) : null}
      {withNote && declaration.status !== 'notReviewed' ? (
        <div>
          <label htmlFor={`${id}-note`} className={CAT_LABEL}>
            {t('note')}
          </label>
          <textarea id={`${id}-note`} maxLength={600} value={declaration.note[defaultLocale] ?? ''} onChange={(e) => set({ note: { ...declaration.note, [defaultLocale]: e.target.value } })} className={CAT_TEXTAREA} />
          <p className="mt-1.5 text-sm text-muted-foreground">{t('noteHelp')}</p>
        </div>
      ) : null}
      {issues.length ? (
        <p className="text-sm text-muted-foreground" role="status">
          {t(`issues.${issues[0]}`)}
        </p>
      ) : null}
    </div>
  )
}

export function FoodInfoField({
  declaration,
  dietary,
  dietaryTerms,
  defaultLocale,
  onDeclaration,
  onDietary,
}: {
  declaration: DeclarationForm
  dietary: string[]
  dietaryTerms: readonly CatalogueTerm[]
  defaultLocale: string
  onDeclaration: (v: DeclarationForm) => void
  onDietary: (v: string[]) => void
}) {
  const t = useTranslations('catalogue.dashboard.item.details')
  return (
    <div className="space-y-6">
      <AllergenDeclarationField declaration={declaration} defaultLocale={defaultLocale} onChange={onDeclaration} />
      {dietaryTerms.length ? (
        <div>
          <p className={CAT_LABEL}>{t('dietary')}</p>
          <div className="mt-3">
            <TermChips label={t('dietary')} terms={dietaryTerms} value={dietary} onChange={onDietary} defaultLocale={defaultLocale} />
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ── Option lists (attachments with min/max) ──────────────────────────────────

export function OptionsField({ projectSlug, options, lists, onChange }: { projectSlug: string; options: AttachmentForm[]; lists: readonly OptionListChoice[]; onChange: (next: AttachmentForm[]) => void }) {
  const t = useTranslations('catalogue.dashboard.item.options')
  const id = useId()
  const byId = useMemo(() => new Map(lists.map((l) => [l.id, l])), [lists])
  const counts = useMemo(() => new Map(lists.map((l) => [l.id, l.optionCount])), [lists])
  const issues = attachmentIssues(options, counts)
  const available = lists.filter((l) => !options.some((o) => o.listId === l.id))
  const set = (key: string, patch: Partial<AttachmentForm>) => onChange(options.map((o) => (o.key === key ? { ...o, ...patch } : o)))
  const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.min(99, Math.floor(Number(v)) || 0)))
  return (
    <div className="space-y-4">
      {options.map((o) => {
        const list = byId.get(o.listId)
        const mine = issues.filter((i) => i.key === o.key)
        return (
          <div key={o.key} className="rounded-2xl border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {list ? (
                  <Link href={catalogueHref(projectSlug, 'optionList', o.listId)} className="text-[0.9375rem] font-semibold text-foreground underline-offset-4 hover:underline">
                    {list.name}
                  </Link>
                ) : (
                  <span className="text-[0.9375rem] font-semibold text-foreground">{t('missingName')}</span>
                )}
                {list ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    {t('optionCount', { count: list.optionCount })}
                    {list.isDraft ? <Pill tone="outline">{t('draft')}</Pill> : null}
                  </p>
                ) : null}
              </div>
              <button type="button" aria-label={t('remove')} onClick={() => onChange(options.filter((x) => x.key !== o.key))} className={`-mt-2 -mr-2 ${CAT_ICON_BUTTON}`}>
                {CAT_ICONS.trash}
              </button>
            </div>
            {list ? (
              <div className="mt-3 flex flex-wrap gap-3">
                <label className="flex flex-col text-sm text-foreground" htmlFor={`${id}-${o.key}-min`}>
                  {t('min')}
                  <input id={`${id}-${o.key}-min`} type="number" inputMode="numeric" min={0} max={99} value={o.min} onChange={(e) => set(o.key, { min: num(e.target.value) ?? 0 })} className={`${CAT_INPUT} w-28`} />
                </label>
                <label className="flex flex-col text-sm text-foreground" htmlFor={`${id}-${o.key}-max`}>
                  {t('max')}
                  <input id={`${id}-${o.key}-max`} type="number" inputMode="numeric" min={1} max={99} placeholder={t('noLimit')} value={o.max ?? ''} onChange={(e) => set(o.key, { max: num(e.target.value) || null })} className={`${CAT_INPUT} w-28`} />
                </label>
              </div>
            ) : null}
            {mine.map((i) => (
              <p key={i.kind} className={`mt-2 text-sm ${i.kind === 'minAboveMax' ? 'text-destructive' : 'text-muted-foreground'}`} role={i.kind === 'minAboveMax' ? 'alert' : undefined}>
                {i.kind === 'maxAboveOptions' ? t('maxAboveOptions', { count: i.options }) : t(i.kind)}
              </p>
            ))}
          </div>
        )
      })}
      {available.length ? (
        <div>
          <p className={CAT_LABEL}>{t('attach')}</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {available.map((l) => (
              <li key={l.id}>
                <button type="button" onClick={() => onChange([...options, { key: newKey(), listId: l.id, min: 0, max: null }])} className={CAT_BUTTON}>
                  {CAT_ICONS.plus}
                  {l.name}
                  {l.isDraft ? <span className="text-sm font-normal text-muted-foreground">· {t('draft')}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{lists.length ? t('allAttached') : t('noLists')}</p>
      )}
      <Link href={`/${projectSlug}/catalogue/option-lists/new`} className={CAT_BUTTON}>
        {t('createList')}
      </Link>
    </div>
  )
}

// ── Own page (toggle → slug preview under the project's segment) ─────────────

export function PageField({
  projectSlug,
  docId,
  hasPage,
  slug,
  name,
  segment,
  locales,
  defaultLocale,
  onHasPage,
  onSlug,
}: {
  projectSlug: string
  docId: string
  hasPage: boolean
  slug: Texts
  name: Texts
  segment: string | null
  locales: readonly string[]
  defaultLocale: string
  onHasPage: (v: boolean) => void
  onSlug: (locale: string, v: string) => void
}) {
  const t = useTranslations('catalogue.dashboard.item.page')
  const ui = useLocale()
  const id = useId()
  const effective = useMemo(() => {
    const out: Record<string, string> = {}
    for (const l of locales) {
      // D-7: no address in a language the name is not written in.
      if (!name[l]?.trim()) continue
      const s = slug[l]?.trim() ? slugFromName(slug[l]) : slugFromName(name[l])
      if (s) out[l] = s
    }
    return out
  }, [locales, slug, name])
  const [conflicts, setConflicts] = useState<NamedSlugConflict[]>([])
  const key = JSON.stringify(effective)
  useEffect(() => {
    if (!hasPage || !Object.keys(effective).length) return
    let live = true
    const timer = setTimeout(async () => {
      const r = await checkCatalogueSlugsAction({ projectSlug, id: docId, slugs: effective }).catch(() => null)
      if (live && r?.ok) setConflicts(r.conflicts)
    }, 400)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for `effective`
  }, [key, hasPage, projectSlug, docId])
  const shownConflicts = hasPage ? conflicts : []
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p id={`${id}-label`} className={CAT_LABEL}>
            {t('toggle')}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{t('toggleHelp')}</p>
        </div>
        <Switch checked={hasPage} onChange={onHasPage} labelledBy={`${id}-label`} />
      </div>
      {hasPage ? (
        <div className="space-y-4">
          {!segment ? <p className="text-sm text-muted-foreground">{t('noSegment')}</p> : null}
          {locales.map((l) => (
            <div key={l}>
              <label htmlFor={`${id}-${l}`} className={`${CAT_LABEL} flex flex-wrap items-center gap-2`}>
                {locales.length > 1 ? t('addressIn', { language: languageName(l, ui) }) : t('address')}
                {l !== defaultLocale && !name[l]?.trim() ? <Pill tone="outline">{t('notTranslated')}</Pill> : null}
              </label>
              <input
                id={`${id}-${l}`}
                value={name[l]?.trim() ? (slug[l] ?? '') : ''}
                disabled={!name[l]?.trim()}
                placeholder={name[l] ? slugFromName(name[l]) : ''}
                onChange={(e) => onSlug(l, e.target.value)}
                className={CAT_INPUT}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <p className="mt-1.5 text-sm break-all text-muted-foreground">{effective[l] ? slugPreview(segment, effective[l]) : l === defaultLocale ? t('needsName') : t('notInLanguage')}</p>
              {/* E-3: an address left in a language without a name — removed only deliberately. */}
              {!name[l]?.trim() && slug[l]?.trim() ? (
                <p role="alert" className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-destructive">
                  {t('strayAddress', { slug: slug[l] })}
                  <button type="button" onClick={() => onSlug(l, '')} className={CAT_BUTTON}>
                    {t('removeAddress')}
                  </button>
                </p>
              ) : null}
              {shownConflicts
                .filter((c) => c.locale === l)
                .map((c) => (
                  <p key={c.owner.id} role="alert" className="mt-1.5 text-sm text-destructive">
                    {t.rich('taken', {
                      name: c.owner.label,
                      link: (chunks) => (
                        <Link href={catalogueHref(projectSlug, c.owner.type === 'collection' ? 'collection' : 'item', c.owner.id)} className="underline underline-offset-4">
                          {chunks}
                        </Link>
                      ),
                    })}
                  </p>
                ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

// ── Visibility (stays in the Content tab — ADR-033 C8; events copy) ──────────

export function VisibilityField({ value, onChange }: { value: Visibility; onChange: (v: Visibility) => void }) {
  const t = useTranslations('catalogue.dashboard.visibility')
  const id = useId()
  return (
    <fieldset>
      <legend className={CAT_LABEL}>{t('label')}</legend>
      <div className="mt-2 flex flex-col gap-2">
        {(['public', 'websiteOnly', 'unlisted'] as const).map((v) => (
          <label key={v} htmlFor={`${id}-${v}`} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-xl border border-border px-3 py-2.5">
            <input id={`${id}-${v}`} type="radio" name={id} checked={value === v} onChange={() => onChange(v)} className="mt-1 size-5 shrink-0" />
            <span>
              <span className="block text-[0.9375rem] font-medium text-foreground">{t(`${v}.title`)}</span>
              <span className="block text-sm text-muted-foreground">{t(`${v}.body`)}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

// ── Other languages (write them now, or later) ───────────────────────────────

export function LanguagesField({ locales, defaultLocale, name, byline, description, onName, onByline, onDescription }: { locales: readonly string[]; defaultLocale: string; name: Texts; byline?: Texts; description: Texts; onName: (l: string, v: string) => void; onByline?: (l: string, v: string) => void; onDescription: (l: string, v: string) => void }) {
  const t = useTranslations('catalogue.dashboard.item.languages')
  const ui = useLocale()
  const others = locales.filter((l) => l !== defaultLocale)
  return (
    <div className="space-y-6">
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">{t('fallback', { language: languageName(defaultLocale, ui) })}</p>
      {others.map((l) => (
        <div key={l} className="rounded-2xl border border-border p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[1.0625rem] font-semibold text-foreground">{languageName(l, ui)}</h3>
            <Pill tone={name[l]?.trim() ? 'success' : 'outline'}>{name[l]?.trim() ? t('ready') : t('missing')}</Pill>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('original', { text: name[defaultLocale] || '—' })}</p>
          <div className="mt-3">
            <NameFields locale={l} name={name} byline={byline} description={description} onName={onName} onByline={onByline} onDescription={onDescription} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Preview: how it will look ─────────────────────────────────────────────────

export function ItemPreview({
  name,
  byline,
  description,
  photo,
  offers,
  channels,
  currency,
  declaration,
  locale,
  defaultLocale,
}: {
  name: Texts
  byline?: Texts
  description: Texts
  photo: string | null
  offers: OfferForm[]
  channels: readonly CatalogueTerm[]
  currency: string
  /** null for a product or service (no allergen interface). */
  declaration: DeclarationForm | null
  locale: string
  defaultLocale: string
}) {
  const t = useTranslations('catalogue.dashboard.item.preview')
  const ta = useTranslations('catalogue.allergens')
  const tp = useTranslations('catalogue.dashboard.item.price')
  // The preview shows the website's own wording (pending legal copy — one source, the website messages).
  const tw = useTranslations('catalogue.website')
  const ui = useLocale()
  const priced = offers.filter((o) => parsePrice(o.price) !== null)
  const label = (ch: string | null) => (ch === null ? (channels.length ? tp('everywhere') : tp('price')) : termLabel(channels.find((c) => c.value === ch) ?? { value: ch, label: {}, color: null }, ui, defaultLocale))
  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      {photo ? <MediaFrame src={photo} alt="" size={{ width: '100%', height: '14rem' }} /> : null}
      <div className="space-y-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-semibold text-foreground">{textIn(name, locale, defaultLocale) || t('untitled')}</h3>
          {priced[0] ? <span className="text-lg font-semibold text-foreground">{formatPrice(parsePrice(priced[0].price)!, currency, locale)}</span> : null}
        </div>
        {byline && textIn(byline, locale, defaultLocale) ? <p className="text-sm text-muted-foreground">{textIn(byline, locale, defaultLocale)}</p> : null}
        {textIn(description, locale, defaultLocale) ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{textIn(description, locale, defaultLocale)}</p> : null}
        {priced.length > 1 ? (
          <ul className="space-y-1 pt-1">
            {priced.map((o) => (
              <li key={o.key} className="flex justify-between gap-3 text-sm text-foreground">
                <span>{label(o.channel)}</span>
                <span>{formatPrice(parsePrice(o.price)!, currency, locale)}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {declaration?.status === 'containsListedAllergens' && declaration.allergens.length ? (
          <p className="pt-1 text-sm text-muted-foreground">
            {t('allergens', { list: declaration.allergens.map((a) => ta(a)).join(', ') })}
            {declaration.mayContain.length ? ` · ${t('mayContain', { list: declaration.mayContain.map((a) => ta(a)).join(', ') })}` : ''}
          </p>
        ) : declaration?.status === 'noneDeclared' && declaration.confirmed ? (
          <p className="pt-1 text-sm text-muted-foreground">
            {tw('allergensNoneDeclared')}
            {declaration.mayContain.length ? <span className="block">{t('mayContain', { list: declaration.mayContain.map((a) => ta(a)).join(', ') })}</span> : null}
          </p>
        ) : null}
      </div>
    </article>
  )
}
