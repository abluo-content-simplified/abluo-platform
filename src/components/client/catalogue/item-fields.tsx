'use client'

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { ChoiceCard, ChoiceCardGrid } from '@/components/app/ui/ChoiceCard'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { DragGrip, DropLine } from '@/components/app/ui/DragGrip'
import { dropIndex, usePointerDrag } from '@/components/app/ui/use-pointer-drag'
import { CheckboxCard } from '@/components/app/ui/CheckboxCard'
import { Select } from '@/components/app/ui/Select'
import { applyEditionChange, EDITION_LANGUAGES } from '@/lib/modules/catalogue/editions'
import { RadioList } from '@/components/app/ui/RadioList'
import { ToggleChips } from '@/components/app/ui/ToggleChips'
import { Switch } from '@/components/app/ui/Switch'
import { SegmentedControl } from '@/components/app/ui/SegmentedControl'
import { READING_STATUS_EDIT_ORDER } from '@/lib/modules/catalogue/reading-status'
import { MediaFrame, Pill } from '@/components/app/ui/list/cells'
import { PhotoSource } from '@/components/client/media/PhotoSource'
import { PhotoEditSheet } from '@/components/client/media/PhotoEditSheet'
import { languageName } from '@/components/client/create/StepHeading'
import { checkCatalogueSlugsAction, resolveAmazonLinkAction } from '@/app/[locale]/(client)/[tenant]/catalogue/actions'
import { describeAmazonLink } from '@/lib/affiliate/amazon-tracking'
import { looksLikeAmazon } from '@/lib/affiliate/amazon-links'
import { MAX_MORE_AMAZON_URLS } from '@/lib/modules/catalogue/amazon-delivery'
import type { AmazonTrackingId } from '@/lib/affiliate/amazon-marketplaces'
import { describeAffiliateLink, type AffiliateSettings } from '@/lib/affiliate/affiliate-settings'
import { ALLERGENS, type AllergenKey } from '@/lib/modules/catalogue/allergens'
import { WEEKDAYS, type Weekday } from '@/lib/modules/catalogue/availability'
import { formatPrice } from '@/lib/modules/catalogue/resolve'
import { CATALOGUE_LINK_LIMITS } from '@/lib/modules/catalogue/links'
import type { CatalogueTerm } from '@/lib/api/catalogue-drafts'
import type { NamedSlugConflict } from '@/lib/modules/catalogue/validation'
import {
  ITEM_PROFILES,
  attachmentIssues,
  bookYearInvalid,
  declarationIssues,
  offerFormIssues,
  parsePrice,
  linkFormIssues,
  buyLinkOf,
  withBuyLink,
  moveIndex,
  slugFromName,
  slugPreview,
  wrapsMidnight,
  type AttachmentForm,
  type BookDetailsForm,
  type DeclarationForm,
  type ItemProfile,
  type LinkForm,
  type OfferForm,
  type Texts,
  type Visibility,
} from '@/lib/modules/catalogue/dashboard-form'
import { PROFILES } from '@/lib/modules/catalogue/profiles'
import { bookYearMax, isValidIsbn, normalizeIsbn, parseBookYear } from '@/lib/modules/catalogue/isbn'
import { bookPublisherLine, itemSecondaryLine } from '@/lib/modules/catalogue/list-model'
import { CAT_ICONS, catalogueHref, textIn } from './catalogue-ui'
import { Button, ButtonLink, IconButton } from '@/components/app/ui/Button'
import { Notice } from '@/components/app/ui/Notice'
import { LABEL_CLASS } from '@/components/app/ui/field-styles'
import { FieldError, FieldLabel } from '@/components/app/ui/FieldLabel'
import { Panel } from '@/components/app/ui/Panel'
import { TextArea, TextInput } from '@/components/app/ui/TextInput'

export type ItemPhoto = { assetId: string; thumbUrl: string | null }
export type OptionListChoice = { id: string; name: string; optionCount: number; isDraft: boolean }

/**
 * A photo shown whole (never cropped): natural aspect ratio on a neutral
 * background — a book cover stays a book cover. `tall` caps the height
 * (previews); otherwise a fixed-height tile (the photo grid).
 */
function WholeImage({ src, tile = false }: { src: string | null; tile?: boolean }) {
  if (!src) return <MediaFrame src={null} alt="" size={{ width: '100%', height: tile ? '8rem' : '10rem' }} />
  return (
    <span className={`flex w-full items-center justify-center bg-muted ${tile ? 'h-32' : ''}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- Sanity CDN image, shown uncropped */}
      <img src={src} alt="" loading="lazy" className={`block w-auto max-w-full object-contain ${tile ? 'h-full' : 'max-h-80'}`} />
    </span>
  )
}

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

export function ProfileField({ value, onChange, suggested = null, currentLabel }: { value: ItemProfile | null; onChange: (v: ItemProfile) => void; /** Marks the selected card ("Current") when changing an existing item's type. */ currentLabel?: string; /** The preset's default profile: listed first and marked "Suggested". Never restricts the others (D7). */ suggested?: ItemProfile | null }) {
  const t = useTranslations('catalogue.dashboard.itemProfiles')
  const ordered = suggested ? [suggested, ...ITEM_PROFILES.filter((p) => p !== suggested)] : ITEM_PROFILES
  return (
    <ChoiceCardGrid label={t('label')} kind="radio">
      {ordered.map((p) => (
        <ChoiceCard key={p} icon={CAT_ICONS[PROFILES[p].icon]} label={t(PROFILES[p].labelKey)} description={t(PROFILES[p].descriptionKey)} badge={p === suggested ? t('suggested') : currentLabel && p === value ? currentLabel : undefined} selected={value === p} onSelect={() => onChange(p)} />
      ))}
    </ChoiceCardGrid>
  )
}

// ── Name ─────────────────────────────────────────────────────────────────────

export function NameFields({ locale, name, profile = null, afterName, byline, description, onName, onByline, onDescription, autoFocus = false }: { locale: string; name: Texts; /** Picks the label ("Title" for a book). */ profile?: ItemProfile | null; /** Rendered right under the name (book details). */ afterName?: ReactNode; /** Items only (F-1); collections have no byline. */ byline?: Texts; description: Texts; onName: (l: string, v: string) => void; onByline?: (l: string, v: string) => void; onDescription: (l: string, v: string) => void; autoFocus?: boolean }) {
  const t = useTranslations('catalogue.dashboard.item.fields')
  const id = useId()
  return (
    <div className="space-y-5">
      <div>
        <FieldLabel htmlFor={`${id}-name`}>
          {t(profile ? PROFILES[profile].nameLabelKey : 'name')}
        </FieldLabel>
        <TextInput id={`${id}-name`} data-name-locale={locale} data-enter-next autoFocus={autoFocus} maxLength={120} value={name[locale] ?? ''} onChange={(e) => onName(locale, e.target.value)} />
      </div>
      {afterName}
      {byline && onByline ? (
        <div>
          <FieldLabel htmlFor={`${id}-byline`}>
            {t('byline')}
          </FieldLabel>
          <TextInput id={`${id}-byline`} data-enter-next maxLength={160} value={byline[locale] ?? ''} onChange={(e) => onByline(locale, e.target.value)} />
          <p className="mt-1.5 text-sm text-muted-foreground">{t('bylineHelp')}</p>
        </div>
      ) : null}
      <div>
        <FieldLabel htmlFor={`${id}-desc`}>
          {t('description')}
        </FieldLabel>
        <TextArea id={`${id}-desc`} maxLength={600} value={description[locale] ?? ''} onChange={(e) => onDescription(locale, e.target.value)} />
        <p className="mt-1.5 text-sm text-muted-foreground">{t('descriptionHelp')}</p>
      </div>
    </div>
  )
}

// ── Book details (Amendment I-3): author, year, ISBN — all optional, not localized ──

export function BookDetailsFields({ value, onChange }: { value: BookDetailsForm; onChange: (next: BookDetailsForm) => void }) {
  const t = useTranslations('catalogue.dashboard.item.fields.book')
  const id = useId()
  const yearBad = bookYearInvalid(value)
  const isbnBad = value.isbn.trim() !== '' && !isValidIsbn(value.isbn)
  return (
    <div className="space-y-5">
      <div>
        <FieldLabel htmlFor={`${id}-author`}>
          {t('author')}
        </FieldLabel>
        <TextInput id={`${id}-author`} data-book-author data-enter-next maxLength={120} value={value.author} onChange={(e) => onChange({ ...value, author: e.target.value })} />
        <p className="mt-1.5 text-sm text-muted-foreground">{t('authorHelp')}</p>
      </div>
      <div>
        <FieldLabel htmlFor={`${id}-publisher`}>
          {t('publisher')}
        </FieldLabel>
        <TextInput id={`${id}-publisher`} data-book-publisher data-enter-next maxLength={120} value={value.publisher} onChange={(e) => onChange({ ...value, publisher: e.target.value })} />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel htmlFor={`${id}-year`}>
            {t('year')}
          </FieldLabel>
          <TextInput
            id={`${id}-year`}
            data-book-year
            data-enter-next
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            value={value.year}
            aria-invalid={yearBad || undefined}
            aria-describedby={yearBad ? `${id}-year-err` : undefined}
            onChange={(e) => onChange({ ...value, year: e.target.value.replace(/\D/g, '') })} />
        </div>
        <div>
          <FieldLabel htmlFor={`${id}-isbn`}>
            {t('isbn')}
          </FieldLabel>
          <TextInput id={`${id}-isbn`} data-book-isbn data-enter-next inputMode="numeric" autoComplete="off" maxLength={32} value={value.isbn} onChange={(e) => onChange({ ...value, isbn: e.target.value })} />
        </div>
      </div>
      {yearBad ? (
        <FieldError id={`${id}-year-err`}>{t('yearInvalid', { max: bookYearMax() })}</FieldError>
      ) : null}
      {isbnBad ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('isbnAdvice')}
        </p>
      ) : null}
      {/* Reading status: where the book stands for the owner; groups the books on the website. */}
      <div>
        <FieldLabel as="p">{t('readingStatus')}</FieldLabel>
        <SegmentedControl
          label={t('readingStatus')}
          value={value.readingStatus}
          onChange={(v) => onChange({ ...value, readingStatus: v === value.readingStatus ? '' : v })}
          options={READING_STATUS_EDIT_ORDER.map((s) => ({ value: s, label: t(`readingStatusOptions.${s}`) }))}
        />
        <p className="mt-1.5 text-sm text-muted-foreground">{t('readingStatusHelp')}</p>
      </div>
    </div>
  )
}

// ── Links (Amendment F-2) — add, remove, reorder; label per language + address ─

/**
 * Amendment K — "Link / Buy link" and, for a buy link, the affiliate tick.
 * Shared by the item editor's Links tab and the wizard's book screen, so both
 * write the same `links[]` entry (D9).
 */
export function LinkKindFields({ link, onChange, hideAffiliate = false }: { link: Pick<LinkForm, 'kind' | 'affiliate'>; onChange: (next: Pick<LinkForm, 'kind' | 'affiliate'>) => void; /** An Amazon address is an affiliate link by itself (the tracking ID decides): no tick to set. */ hideAffiliate?: boolean }) {
  const t = useTranslations('catalogue.dashboard.item.fields.links')
  return (
    <div className="space-y-3">
      <ChoiceCardGrid label={t('kind')} kind="radio">
        <ChoiceCard icon={CAT_ICONS.list} label={t('kindInfo')} selected={link.kind === 'info'} onSelect={() => onChange({ kind: 'info', affiliate: false })} />
        <ChoiceCard icon={CAT_ICONS.product} label={t('kindBuy')} description={t('kindBuyHelp')} selected={link.kind === 'buy'} onSelect={() => onChange({ kind: 'buy', affiliate: link.affiliate })} />
      </ChoiceCardGrid>
      {link.kind === 'buy' && !hideAffiliate ? (
        <CheckboxCard label={t('affiliate')} description={t('affiliateHelp')} checked={link.affiliate} onChange={(on) => onChange({ kind: 'buy', affiliate: on })} />
      ) : null}
    </div>
  )
}

// ── Amazon links — preview, status and extra stores under a pasted Amazon address ──

/** What the editor needs to explain an Amazon link: the project's IDs and whether this person may open Settings. */
export type AmazonEditorContext = {
  projectSlug: string
  trackingIds: readonly AmazonTrackingId[]
  canOpenSettings: boolean
  /** The project's full affiliate settings (Awin ID + approved shops); absent = Amazon only. */
  affiliate?: AffiliateSettings
}

/** "✓ amazon.de · your ID added" / "amazon.de · no ID yet — add it in Settings". */
function AmazonStatus({ url, amazon }: { url: string; amazon: AmazonEditorContext }) {
  const t = useTranslations('catalogue.dashboard.item.fields.amazon')
  const info = describeAmazonLink(url, amazon.trackingIds)
  if (info.state !== 'ok') return null
  const store = info.marketplace
  if (info.idSource === 'settings') return <Notice tone="info" layout="row">{t('idAdded', { store })}</Notice>
  if (info.idSource === 'pasted') return <Notice tone="info" layout="row">{t('idFromLink', { store })}</Notice>
  return (
    <Notice
      tone="dashed"
      layout="row"
      action={amazon.canOpenSettings ? <ButtonLink variant="quiet" href={`/${amazon.projectSlug}/settings`}>{t('openSettings')}</ButtonLink> : undefined}
    >
      {amazon.canOpenSettings ? t('noIdYet', { store }) : t('noIdAskAdmin', { store })}
    </Notice>
  )
}

/**
 * Under a buy link's address, when it is a known Awin shop (IBS, laFeltrinelli, …): the final link and
 * a one-line status of the tracking. Renders nothing for any other address (Amazon has its own block).
 */
export function ShopLinkBlock({ url, amazon }: { url: string; amazon: AmazonEditorContext }) {
  const t = useTranslations('catalogue.dashboard.item.fields.shop')
  const id = useId()
  const info = describeAffiliateLink(url, amazon.affiliate ?? { amazonTrackingIds: amazon.trackingIds })
  if (info.provider !== 'awin') return null
  const shop = info.shop.name
  const settings = amazon.canOpenSettings ? <ButtonLink variant="quiet" href={`/${amazon.projectSlug}/settings`}>{t('openSettings')}</ButtonLink> : undefined
  let status: ReactNode
  if (info.status === 'tracked') status = <Notice tone="info" layout="row">{t('tracked', { shop })}</Notice>
  else if (info.status === 'pasted') status = <Notice tone="info" layout="row">{t('pasted', { shop })}</Notice>
  else if (info.status === 'shop_not_ready') status = <Notice tone="dashed" layout="row">{t('notReady', { shop })}</Notice>
  else if (info.status === 'not_approved') status = <Notice tone="dashed" layout="row" action={settings}>{amazon.canOpenSettings ? t('notApproved', { shop }) : t('notApprovedAskAdmin', { shop })}</Notice>
  else status = <Notice tone="dashed" layout="row" action={settings}>{amazon.canOpenSettings ? t('noPublisherId', { shop }) : t('noPublisherIdAskAdmin', { shop })}</Notice>
  return (
    <div className="space-y-3" data-shop-block="">
      <div>
        <FieldLabel htmlFor={`${id}-final`}>{t('finalLink')}</FieldLabel>
        <TextInput id={`${id}-final`} readOnly value={info.href} onFocus={(e) => e.currentTarget.select()} />
      </div>
      {status}
    </div>
  )
}

/**
 * Looks up an Amazon app link (amzn.eu/d/…) on the server once typing stops and swaps in the product
 * address it opens. When that fails the address is kept and `failed` says so.
 */
function useShortLinkLookup(projectSlug: string, url: string, onResolved: (next: string) => void) {
  const [failed, setFailed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const short = describeAmazonLink(url, []).state === 'short'
  useEffect(() => {
    if (!short) {
      setBusy(false)
      return
    }
    let live = true
    const timer = setTimeout(async () => {
      setBusy(true)
      const r = await resolveAmazonLinkAction({ projectSlug, url: url.trim() }).catch(() => null)
      if (!live) return
      setBusy(false)
      if (r && r.ok && r.url) onResolved(r.url)
      else setFailed(url)
    }, 700)
    return () => {
      live = false
      clearTimeout(timer)
    }
    // onResolved changes every render; the lookup is keyed on the address only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, short, projectSlug])
  return { busy: short && busy, failed: short && failed === url }
}

/** One extra-store row: its own address, resolved the same way, with its status line. */
function MoreAmazonRow({ value, amazon, id, onChange, onRemove }: { value: string; amazon: AmazonEditorContext; id: string; onChange: (next: string) => void; onRemove: () => void }) {
  const t = useTranslations('catalogue.dashboard.item.fields.amazon')
  const lookup = useShortLinkLookup(amazon.projectSlug, value, onChange)
  const info = describeAmazonLink(value, amazon.trackingIds)
  const bad = value.trim() !== '' && info.state !== 'ok' && info.state !== 'short'
  return (
    <div className="space-y-2" data-amazon-more="">
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <FieldLabel htmlFor={id}>{t('otherLabel')}</FieldLabel>
          <TextInput id={id} type="url" inputMode="url" autoComplete="off" placeholder="https://" maxLength={2048} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={bad || undefined} />
        </div>
        <IconButton aria-label={t('removeOther')} onClick={onRemove}>
          {CAT_ICONS.trash}
        </IconButton>
      </div>
      {bad ? <FieldError>{t('notAmazon')}</FieldError> : null}
      {lookup.busy ? <Notice tone="info" layout="row">{t('checking')}</Notice> : null}
      {lookup.failed ? <Notice tone="dashed" layout="row">{t('shortFailed')}</Notice> : null}
      <AmazonStatus url={value} amazon={amazon} />
    </div>
  )
}

/**
 * Under a buy link's address, when it is an Amazon address: the final link (read-only), the status of the
 * tracking ID, and optional addresses for other Amazon stores. Renders nothing for any other address.
 */
export function AmazonLinkBlock({ url, moreUrls, amazon, onUrl, onMoreUrls }: { url: string; moreUrls: string[]; amazon: AmazonEditorContext; onUrl: (next: string) => void; onMoreUrls: (next: string[]) => void }) {
  const t = useTranslations('catalogue.dashboard.item.fields.amazon')
  const id = useId()
  const lookup = useShortLinkLookup(amazon.projectSlug, url, onUrl)
  if (!looksLikeAmazon(url)) return null
  const info = describeAmazonLink(url, amazon.trackingIds)
  return (
    <div className="space-y-3" data-amazon-block="">
      {lookup.busy ? <Notice tone="info" layout="row">{t('checking')}</Notice> : null}
      {lookup.failed ? <Notice tone="dashed" layout="row">{t('shortFailed')}</Notice> : null}
      {info.state === 'unreadable' ? <Notice tone="dashed" layout="row">{t('unreadable')}</Notice> : null}
      {info.state === 'ok' ? (
        <>
          <div>
            <FieldLabel htmlFor={`${id}-final`}>{t('finalLink')}</FieldLabel>
            <TextInput id={`${id}-final`} readOnly value={info.href} onFocus={(e) => e.currentTarget.select()} />
          </div>
          <AmazonStatus url={url} amazon={amazon} />
          {moreUrls.map((u, n) => (
            <MoreAmazonRow key={n} id={`${id}-more-${n}`} value={u} amazon={amazon} onChange={(next) => onMoreUrls(moreUrls.map((x, i) => (i === n ? next : x)))} onRemove={() => onMoreUrls(moreUrls.filter((_, i) => i !== n))} />
          ))}
          {moreUrls.length < MAX_MORE_AMAZON_URLS ? (
            <Button variant="quiet" onClick={() => onMoreUrls([...moreUrls, ''])}>
              {CAT_ICONS.plus}
              {t('addStore')}
            </Button>
          ) : null}
          <Notice tone="info">{t('priceHint')}</Notice>
        </>
      ) : null}
    </div>
  )
}

export function LinksField({ links, locales, defaultLocale, onChange, amazon }: { links: LinkForm[]; locales: readonly string[]; defaultLocale: string; onChange: (next: LinkForm[]) => void; amazon?: AmazonEditorContext }) {
  const t = useTranslations('catalogue.dashboard.item.fields.links')
  const ui = useLocale()
  const id = useId()
  const issues = linkFormIssues(links, defaultLocale)
  const issueOf = (key: string) => issues.find((i) => i.key === key)?.kind
  const setLink = (key: string, next: Partial<LinkForm>) => onChange(links.map((l) => (l.key === key ? { ...l, ...next } : l)))
  // Book editions: one language per buy link; original belongs to a language (all links of that language, or none).
  const setEdition = (key: string, edition: { language: string; original: boolean } | undefined) => onChange(applyEditionChange(links, key, edition))
  const drag = usePointerDrag((key, over) => {
    const to = dropIndex(links.map((x) => x.key), key, over)
    if (to !== null) onChange(moveIndex(links, links.findIndex((x) => x.key === key), to))
  })
  return (
    <div className="space-y-4">
      {links.length ? (
        <ul className="space-y-4">
          {links.map((l, n) => {
            const issue = issueOf(l.key)
            return (
              <Panel as="li" key={l.key} data-link={l.key} {...drag.rowProps(l.key)} className={`relative ${drag.dragging === l.key ? 'opacity-50' : ''}`}>
                <DropLine edge={drag.edge(l.key)} />
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1 space-y-3">
                    {locales.map((loc) => (
                      <div key={loc}>
                        <label htmlFor={`${id}-${l.key}-${loc}`} className="text-sm text-foreground">
                          {locales.length > 1 ? t('labelIn', { language: languageName(loc, ui) }) : t('label')}
                        </label>
                        <TextInput id={`${id}-${l.key}-${loc}`} maxLength={80} value={l.label[loc] ?? ''} onChange={(e) => setLink(l.key, { label: { ...l.label, [loc]: e.target.value } })} />
                      </div>
                    ))}
                    <LinkKindFields link={l} onChange={(next) => setLink(l.key, next)} hideAffiliate={!!amazon && l.kind === 'buy' && looksLikeAmazon(l.url)} />
                    <div>
                      <label htmlFor={`${id}-${l.key}-url`} className="text-sm text-foreground">
                        {t('url')}
                      </label>
                      <TextInput id={`${id}-${l.key}-url`} type="url" inputMode="url" autoComplete="off" placeholder="https://" maxLength={2048} value={l.url} onChange={(e) => setLink(l.key, { url: e.target.value })} aria-invalid={issue === 'badUrl' || undefined} />
                      {issue ? (
                        <FieldError>{issue === 'duplicateShop' ? t('duplicateShop', { shop: issues.find((i) => i.key === l.key)?.shop ?? '' }) : t(issue)}</FieldError>
                      ) : null}
                    </div>
                    {amazon && l.kind === 'buy' ? <AmazonLinkBlock url={l.url} moreUrls={l.moreUrls ?? []} amazon={amazon} onUrl={(next) => setLink(l.key, { url: next })} onMoreUrls={(next) => setLink(l.key, { moreUrls: next })} /> : null}
                    {amazon && l.kind === 'buy' ? <ShopLinkBlock url={l.url} amazon={amazon} /> : null}
                    {l.kind === 'buy' ? (
                      <div className="space-y-3" data-edition-fields="">
                        <div>
                          <FieldLabel htmlFor={`${id}-${l.key}-edition`}>{t('editionLanguage')}</FieldLabel>
                          <Select
                            id={`${id}-${l.key}-edition`}
                            value={l.edition?.language ?? ''}
                            onChange={(e) => setEdition(l.key, e.target.value ? { language: e.target.value, original: l.edition?.original ?? false } : undefined)}
                          >
                            <option value="">{t('editionNone')}</option>
                            {EDITION_LANGUAGES.map((lang) => (
                              <option key={lang.code} value={lang.code}>{lang.name}</option>
                            ))}
                          </Select>
                        </div>
                        {l.edition ? <CheckboxCard label={t('editionOriginal')} checked={l.edition.original} onChange={(on) => setEdition(l.key, { language: l.edition!.language, original: on })} /> : null}
                      </div>
                    ) : null}
                  </div>
                  {links.length > 1 ? (
                    <DragGrip label={t('drag', { position: n + 1, total: links.length })} drag={drag.gripProps(l.key)} onMove={(dir) => onChange(moveIndex(links, n, n + dir))} />
                  ) : null}
                  <IconButton aria-label={t('remove')} onClick={() => onChange(links.filter((x) => x.key !== l.key))}>
                    {CAT_ICONS.trash}
                  </IconButton>
                </div>
              </Panel>
            )
          })}
        </ul>
      ) : null}
      {links.length < CATALOGUE_LINK_LIMITS.links ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onChange([...links, { key: newKey(), label: {}, url: '', kind: 'info', affiliate: false }])}>
            {CAT_ICONS.plus}
            {t('add')}
          </Button>
          <Button variant="secondary" onClick={() => onChange([...links, { key: newKey(), label: {}, url: '', kind: 'buy', affiliate: false }])}>
            {CAT_ICONS.plus}
            {t('addEdition')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Amendment K — the wizard's one "Buy link": address, optional label (main
 * language) and the affiliate tick. It edits the first buy entry of `links[]`,
 * the same entry the editor's Links tab shows.
 */
export function BuyLinkField({ links, defaultLocale, onChange, amazon }: { links: LinkForm[]; defaultLocale: string; onChange: (next: LinkForm[]) => void; amazon?: AmazonEditorContext }) {
  const t = useTranslations('catalogue.dashboard.item.fields.buyLink')
  const tl = useTranslations('catalogue.dashboard.item.fields.links')
  const id = useId()
  const buy = buyLinkOf(links)
  const bad = buy ? linkFormIssues([buy], defaultLocale).find((i) => i.kind === 'badUrl') : undefined
  return (
    <div className="space-y-3" data-buy-link-field>
      <div>
        <FieldLabel htmlFor={`${id}-url`}>
          {t('url')}
        </FieldLabel>
        <TextInput id={`${id}-url`} data-enter-next type="url" inputMode="url" autoComplete="off" placeholder="https://" maxLength={2048} value={buy?.url ?? ''} onChange={(e) => onChange(withBuyLink(links, { url: e.target.value }, newKey))} aria-invalid={bad ? true : undefined} />
        {bad ? (
          <FieldError>{tl('badUrl')}</FieldError>
        ) : (
          <p className="mt-1.5 text-sm text-muted-foreground">{t('help')}</p>
        )}
      </div>
      {buy && amazon ? <ShopLinkBlock url={buy.url} amazon={amazon} /> : null}
      {buy && amazon ? <AmazonLinkBlock url={buy.url} moreUrls={buy.moreUrls ?? []} amazon={amazon} onUrl={(next) => onChange(withBuyLink(links, { url: next }, newKey))} onMoreUrls={(next) => onChange(withBuyLink(links, { moreUrls: next }, newKey))} /> : null}
      {buy ? (
        <>
          <div>
            <FieldLabel htmlFor={`${id}-label`}>
              {t('label')}
            </FieldLabel>
            <TextInput id={`${id}-label`} data-enter-next maxLength={80} value={buy.label[defaultLocale] ?? ''} onChange={(e) => onChange(withBuyLink(links, { label: { ...buy.label, [defaultLocale]: e.target.value } }, newKey))} />
          </div>
          {amazon && looksLikeAmazon(buy.url) ? null : <CheckboxCard label={tl('affiliate')} description={tl('affiliateHelp')} checked={buy.affiliate} onChange={(on) => onChange(withBuyLink(links, { affiliate: on }, newKey))} />}
        </>
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

/**
 * The item's photos (quick win 2.5): the shared PhotoSource (take / upload /
 * Media Library) to add, the shared photo card (description, focus point) to
 * describe — both saved on the Media Library asset, not on the item.
 */
export function PhotoField({
  projectSlug,
  defaultLocale,
  languages,
  photos,
  onChange,
  max = 10,
  uploadOwner,
}: {
  projectSlug: string
  defaultLocale: string
  /** The site's languages (the photo card describes each). */
  languages: readonly string[]
  photos: ItemPhoto[]
  onChange: (next: ItemPhoto[]) => void
  max?: number
  /** The item screen's upload key (useUploadOwner): photos finishing after this field is gone still join the item. */
  uploadOwner?: string
}) {
  const t = useTranslations('catalogue.dashboard.item.photos')
  const [editing, setEditing] = useState<string | null>(null)
  return (
    <div className="space-y-4">
      {photos.length ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p, i) => (
            <li key={p.assetId} className="flex flex-col items-start gap-2">
              <div className="relative w-full overflow-hidden rounded-xl border border-border">
                <WholeImage src={p.thumbUrl} tile />
                {i === 0 ? (
                  <span className="absolute top-2 left-2">
                    <Pill tone="highlight">{t('main')}</Pill>
                  </span>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1">
                <Button variant="secondary" onClick={() => setEditing(p.assetId)}>
                  {t('edit')}
                </Button>
                {i > 0 ? (
                  <Button variant="secondary" onClick={() => onChange([p, ...photos.filter((x) => x.assetId !== p.assetId)])}>
                    {t('makeMain')}
                  </Button>
                ) : null}
                <IconButton aria-label={t('remove')} onClick={() => onChange(photos.filter((x) => x.assetId !== p.assetId))}>
                  {CAT_ICONS.trash}
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[0.9375rem] text-muted-foreground">{t('none')}</p>
      )}
      {photos.length < max ? (
        <PhotoSource
          projectSlug={projectSlug}
          scope="media"
          defaultLocale={defaultLocale}
          exclude={photos.map((p) => p.assetId)}
          room={max - photos.length}
          owner={uploadOwner}
          onAdd={(added) => {
            const known = new Set(photos.map((p) => p.assetId))
            onChange([...photos, ...added.filter((a) => !known.has(a.assetId)).map((a) => ({ assetId: a.assetId, thumbUrl: a.thumbUrl }))].slice(0, max))
          }}
        />
      ) : null}
      <PhotoEditSheet projectSlug={projectSlug} scope="media" site={{ defaultLocale, languages }} assetId={editing} onClose={() => setEditing(null)} />
    </div>
  )
}

// ── Prices (one per channel + everywhere; optional serving times) ────────────

export function PriceField({ offers, channels, currency, defaultLocale, onChange, hiddenByAmazon = false }: { offers: OfferForm[]; channels: readonly CatalogueTerm[]; currency: string; defaultLocale: string; onChange: (next: OfferForm[]) => void; /** The item has an Amazon buy link: the website shows no manual price next to it. */ hiddenByAmazon?: boolean }) {
  const t = useTranslations('catalogue.dashboard.item.price')
  const ta = useTranslations('catalogue.dashboard.item.fields.amazon')
  const td = useTranslations('catalogue.dashboard.days')
  const ui = useLocale()
  const id = useId()
  const channelValues = channels.map((c) => c.value)
  // "More price options" is closed until asked for — unless a price already uses serving times.
  const [moreOpen, setMoreOpen] = useState<ReadonlySet<string>>(new Set())
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
      {hiddenByAmazon ? <Notice tone="info">{ta('priceHint')}</Notice> : null}
      {offers.map((o, n) => {
        const mine = issueFor(o.key)
        const parsed = parsePrice(o.price)
        const firstOfScope = offers.findIndex((x) => x.channel === o.channel) === n
        return (
          <Panel key={o.key}>
            <div className="flex items-start justify-between gap-3">
              <FieldLabel htmlFor={`${id}-${o.key}`}>
                {scopeLabel(o.channel)}
                {!firstOfScope ? <span className="ml-2 text-sm font-normal text-muted-foreground">{t('anotherTime')}</span> : null}
              </FieldLabel>
              {o.price || o.availability.length || !firstOfScope ? (
                <IconButton className="-mt-2 -mr-2" aria-label={t('remove')} onClick={() => remove(o.key)}>
                  {CAT_ICONS.trash}
                </IconButton>
              ) : null}
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <TextInput flush className="max-w-40"
                id={`${id}-${o.key}`}
                data-offer-key={o.key}
                inputMode="decimal"
                autoComplete="off"
                placeholder={t('placeholder')}
                value={o.price}
                onChange={(e) => set(o.key, { price: e.target.value })}
                aria-invalid={mine.some((i) => i.kind === 'invalidPrice') || undefined} />
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
                    <TextInput className="w-36" type="time" value={a.from} onChange={(e) => set(o.key, { availability: o.availability.map((x) => (x.key === a.key ? { ...x, from: e.target.value } : x)) })} />
                  </label>
                  <label className="flex flex-col text-sm text-foreground">
                    {t('to')}
                    <TextInput className="w-36" type="time" value={a.to} onChange={(e) => set(o.key, { availability: o.availability.map((x) => (x.key === a.key ? { ...x, to: e.target.value } : x)) })} />
                  </label>
                  <Button variant="secondary" onClick={() => set(o.key, { availability: o.availability.filter((x) => x.key !== a.key) })}>
                    {t('removeTimes')}
                  </Button>
                </div>
                {wrapsMidnight(a) ? <p className="text-sm text-muted-foreground">{t('overnight')}</p> : null}
              </div>
            ))}
            <div className="mt-3 flex flex-wrap gap-2">
              {firstOfScope ? (
                <Button variant="secondary" onClick={() => addAnother(o.channel)}>
                  {CAT_ICONS.plus}
                  {t('addAnother')}
                </Button>
              ) : null}
              {o.availability.length ? (
                <Button variant="secondary" onClick={() => set(o.key, { availability: [...o.availability, { key: newKey(), days: [], from: '', to: '' }] })}>
                  {t('addMoreTimes')}
                </Button>
              ) : !moreOpen.has(o.key) ? (
                <Button variant="secondary" aria-expanded={false} onClick={() => setMoreOpen(new Set([...moreOpen, o.key]))}>
                  {t('morePriceOptions')}
                </Button>
              ) : null}
            </div>
            {!o.availability.length && moreOpen.has(o.key) ? (
              <div className="mt-3 space-y-2 rounded-xl bg-muted p-3">
                <p className="text-sm text-muted-foreground">{t('timesHelp')}</p>
                <Button variant="secondary" onClick={() => set(o.key, { availability: [{ key: newKey(), days: [], from: '', to: '' }] })}>
                  {t('addTimes')}
                </Button>
              </div>
            ) : null}
          </Panel>
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
      <FieldLabel as="legend">{legend}</FieldLabel>
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
        <p className={compactHeading ? 'text-sm font-medium text-foreground' : LABEL_CLASS}>{t('allergens')}</p>
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
        <CheckboxCard label={t('confirmNone')} checked={declaration.confirmed} onChange={(on) => set({ confirmed: on })} />
      ) : null}
      {/* E-1: "may contain" in BOTH reviewed states (cross-contamination with no listed ingredient). */}
      {declaration.status !== 'notReviewed' ? (
        <AllergenGrid legend={t('mayContainLegend')} help={t('mayContainHelp')} value={declaration.mayContain} onChange={(mayContain) => set({ mayContain })} />
      ) : null}
      {withNote && declaration.status !== 'notReviewed' ? (
        <div>
          <FieldLabel htmlFor={`${id}-note`}>
            {t('note')}
          </FieldLabel>
          <TextArea id={`${id}-note`} maxLength={600} value={declaration.note[defaultLocale] ?? ''} onChange={(e) => set({ note: { ...declaration.note, [defaultLocale]: e.target.value } })} />
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
          <FieldLabel as="p">{t('dietary')}</FieldLabel>
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
          <Panel key={o.key}>
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
              <IconButton className="-mt-2 -mr-2" aria-label={t('remove')} onClick={() => onChange(options.filter((x) => x.key !== o.key))}>
                {CAT_ICONS.trash}
              </IconButton>
            </div>
            {list ? (
              <div className="mt-3 flex flex-wrap gap-3">
                <label className="flex flex-col text-sm text-foreground" htmlFor={`${id}-${o.key}-min`}>
                  {t('min')}
                  <TextInput className="w-28" id={`${id}-${o.key}-min`} data-attachment-key={o.key} type="number" inputMode="numeric" min={0} max={99} value={o.min} onChange={(e) => set(o.key, { min: num(e.target.value) ?? 0 })} />
                </label>
                <label className="flex flex-col text-sm text-foreground" htmlFor={`${id}-${o.key}-max`}>
                  {t('max')}
                  <TextInput className="w-28" id={`${id}-${o.key}-max`} type="number" inputMode="numeric" min={1} max={99} placeholder={t('noLimit')} value={o.max ?? ''} onChange={(e) => set(o.key, { max: num(e.target.value) || null })} />
                </label>
              </div>
            ) : null}
            {mine.map((i) => (
              <p key={i.kind} className={`mt-2 text-sm ${i.kind === 'minAboveMax' ? 'text-destructive' : 'text-muted-foreground'}`} role={i.kind === 'minAboveMax' ? 'alert' : undefined}>
                {i.kind === 'maxAboveOptions' ? t('maxAboveOptions', { count: i.options }) : t(i.kind)}
              </p>
            ))}
          </Panel>
        )
      })}
      {available.length ? (
        <div>
          <FieldLabel as="p">{t('attach')}</FieldLabel>
          <ul className="mt-2 flex flex-wrap gap-2">
            {available.map((l) => (
              <li key={l.id}>
                <Button variant="secondary" onClick={() => onChange([...options, { key: newKey(), listId: l.id, min: 0, max: null }])}>
                  {CAT_ICONS.plus}
                  {l.name}
                  {l.isDraft ? <span className="text-sm font-normal text-muted-foreground">· {t('draft')}</span> : null}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{lists.length ? t('allAttached') : t('noLists')}</p>
      )}
      <ButtonLink variant="secondary" href={`/${projectSlug}/catalogue/option-lists/new`}>
        {t('createList')}
      </ButtonLink>
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
          <FieldLabel as="p" id={`${id}-label`}>
            {t('toggle')}
          </FieldLabel>
          <p className="mt-1 text-sm text-muted-foreground">{t('toggleHelp')}</p>
        </div>
        <Switch checked={hasPage} onChange={onHasPage} labelledBy={`${id}-label`} />
      </div>
      {hasPage ? (
        <div className="space-y-4">
          {!segment ? <p className="text-sm text-muted-foreground">{t('noSegment')}</p> : null}
          {locales.map((l) => (
            <div key={l}>
              <FieldLabel className="flex flex-wrap items-center gap-2" htmlFor={`${id}-${l}`}>
                {locales.length > 1 ? t('addressIn', { language: languageName(l, ui) }) : t('address')}
                {l !== defaultLocale && !name[l]?.trim() ? <Pill tone="outline">{t('notTranslated')}</Pill> : null}
              </FieldLabel>
              <TextInput
                id={`${id}-${l}`}
                data-slug-locale={l}
                value={name[l]?.trim() ? (slug[l] ?? '') : ''}
                disabled={!name[l]?.trim()}
                placeholder={name[l] ? slugFromName(name[l]) : ''}
                onChange={(e) => onSlug(l, e.target.value)}
                
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false} />
              <p className="mt-1.5 text-sm break-all text-muted-foreground">{effective[l] ? slugPreview(segment, effective[l]) : l === defaultLocale ? t('needsName') : t('notInLanguage')}</p>
              {/* E-3: an address left in a language without a name — removed only deliberately. */}
              {!name[l]?.trim() && slug[l]?.trim() ? (
                <p role="alert" className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-destructive">
                  {t('strayAddress', { slug: slug[l] })}
                  <Button variant="secondary" onClick={() => onSlug(l, '')}>
                    {t('removeAddress')}
                  </Button>
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
    <RadioList
      legend={t('label')}
      name={id}
      value={value}
      onChange={onChange}
      options={(['public', 'websiteOnly', 'unlisted'] as const).map((v) => ({ value: v, label: t(`${v}.title`), description: t(`${v}.body`) }))}
    />
  )
}

// ── Other languages (write them now, or later) ───────────────────────────────

export function LanguagesField({ locales, defaultLocale, profile = null, name, byline, description, onName, onByline, onDescription }: { locales: readonly string[]; defaultLocale: string; profile?: ItemProfile | null; name: Texts; byline?: Texts; description: Texts; onName: (l: string, v: string) => void; onByline?: (l: string, v: string) => void; onDescription: (l: string, v: string) => void }) {
  const t = useTranslations('catalogue.dashboard.item.languages')
  const ui = useLocale()
  const others = locales.filter((l) => l !== defaultLocale)
  return (
    <div className="space-y-6">
      <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">{t('fallback', { language: languageName(defaultLocale, ui) })}</p>
      {others.map((l) => (
        <Panel key={l}>
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-[1.0625rem] font-semibold text-foreground">{languageName(l, ui)}</h3>
            <Pill tone={name[l]?.trim() ? 'success' : 'outline'}>{name[l]?.trim() ? t('ready') : t('missing')}</Pill>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t('original', { text: name[defaultLocale] || '—' })}</p>
          <div className="mt-3">
            <NameFields locale={l} profile={profile} name={name} byline={byline} description={description} onName={onName} onByline={onByline} onDescription={onDescription} />
          </div>
        </Panel>
      ))}
    </div>
  )
}

// ── Preview: how it will look ─────────────────────────────────────────────────

export function ItemPreview({
  profile = null,
  bookDetails,
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
  /** Slice 4d: a book shows as a book card (whole 2:3 cover, author · year, ISBN when valid). */
  profile?: ItemProfile | null
  bookDetails?: BookDetailsForm
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
  const isBook = profile === 'book'
  const bylineText = byline ? textIn(byline, locale, defaultLocale) : ''
  const secondary = isBook ? itemSecondaryLine({ itemProfile: 'book', byline: bylineText, author: bookDetails?.author, year: parseBookYear(bookDetails?.year) }) : bylineText
  const publisherLine = isBook ? bookPublisherLine({ publisher: bookDetails?.publisher, year: parseBookYear(bookDetails?.year) }) : null
  const isbn = isBook && bookDetails?.isbn && isValidIsbn(bookDetails.isbn) ? normalizeIsbn(bookDetails.isbn) : ''
  return (
    <Panel as="article" padding="none" className="overflow-hidden">
      {isBook ? (
        <span className="flex w-full justify-center bg-muted p-4">
          <MediaFrame src={photo} alt="" fit="contain" size={{ width: '10rem', height: '15rem' }} className="rounded-lg" />
        </span>
      ) : photo ? <WholeImage src={photo} /> : null}
      <div className="space-y-2 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-semibold text-foreground">{textIn(name, locale, defaultLocale) || t('untitled')}</h3>
          {priced[0] ? <span className="text-lg font-semibold text-foreground">{formatPrice(parsePrice(priced[0].price)!, currency, locale)}</span> : null}
        </div>
        {secondary ? <p className="text-sm text-muted-foreground">{secondary}</p> : null}
        {publisherLine ? <p className="text-sm text-muted-foreground">{publisherLine}</p> : null}
        {isbn ? <p className="text-sm text-muted-foreground">ISBN {isbn}</p> : null}
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
    </Panel>
  )
}
