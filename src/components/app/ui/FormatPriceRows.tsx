'use client'

import { useId, useMemo, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { ChannelKey, FormatKey, IssueLevel, LocalizedString } from '@/lib/modules/catalogue/commerce/commerce-types'
import { QUANTITY_UNITS, addFormat, isSimple, removeFormat, type Format, type QuantityUnit } from '@/lib/modules/catalogue/commerce/formats'
import type { Price } from '@/lib/modules/catalogue/commerce/prices'
import type { WeeklyWindow } from '@/lib/modules/catalogue/commerce/windows'
import { Button } from './Button'
import { DragGrip, DropLine } from './DragGrip'
import { FieldError, FieldLabel } from './FieldLabel'
import { Panel } from './Panel'
import { Select } from './Select'
import { TextInput } from './TextInput'
import { WeeklyScheduleEditor } from './WeeklyScheduleEditor'
import { dropIndex, usePointerDrag } from './use-pointer-drag'
import { weekdayNames, windowsSummary, type ScheduleT } from './schedule-model'

/** An issue to show: C3 `FormatIssue` (with `formatKey`) or C4 `PriceIssue` (with `formatKey` + its `keys` as `priceKeys`). */
export type FormatPriceIssue = { code: string; level: IssueLevel; formatKey?: FormatKey; priceKeys?: readonly string[] }

export type FormatPriceRowsProps = {
  /** The item's formats in order (C3 `formatsOf`); never empty — one implicit format = a simple item. */
  formats: readonly Format[]
  onChange: (next: Format[]) => void
  /** ISO 4217 code of the project currency (shown, never written). */
  currency: string
  /** The project's ACTIVE channels in order, labels in the viewer's language. [] hides channel prices. */
  channels: readonly { key: ChannelKey; label: string }[]
  /**
   * The format name field — the caller's localized (multi-language) input.
   * Give the control `id`; `invalid` marks a missing required name.
   */
  renderLabelInput: (args: { format: Format; id: string; invalid: boolean; onChange: (label: LocalizedString) => void }) => ReactNode
  /** A format's name in the viewer's language ("" when it has none yet). */
  formatLabelText: (format: Format) => string
  /** Save-time issues to show (formatIssues / priceIssues, mapped). */
  issues?: readonly FormatPriceIssue[]
  /** Key for a new format or price. Default: a random 12-character key. */
  newKey?: () => string
  disabled?: boolean
}

const randomKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14))

/** "12", "12.5", "12,50" → 12.5; "" → null (no price); anything else → undefined (not a price). Two decimals at most. */
export function parseAmount(text: string): number | null | undefined {
  const s = text.replace(/\s/g, '')
  if (s === '') return null
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(s)) return undefined
  return Number(s.replace(',', '.'))
}

/** The amount as the person sees it while editing, in the viewer's decimal separator, no grouping. */
function amountText(amount: number | null, locale: string): string {
  if (amount === null) return ''
  return new Intl.NumberFormat(locale, { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2, useGrouping: false }).format(amount)
}

/** The currency symbol and which side of the number it sits on, in the viewer's language. */
function currencyAffix(locale: string, currency: string): { symbol: string; before: boolean } {
  try {
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency }).formatToParts(1)
    const ci = parts.findIndex((p) => p.type === 'currency')
    const ni = parts.findIndex((p) => p.type === 'integer')
    return { symbol: ci >= 0 ? parts[ci].value : currency, before: ci < ni }
  } catch {
    return { symbol: currency, before: false }
  }
}

function moveIndex<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  if (from < 0 || to < 0 || to >= next.length || from === to) return next
  next.splice(to, 0, ...next.splice(from, 1))
  return next
}

/**
 * Formats and prices of one item (C3 + C4). One implicit format shows one
 * plain "Price" field. "Add another size or format" turns it into named rows
 * (the caller's localized name input), each with its standard price, an
 * optional "Different price per channel" section, optional price windows
 * (WeeklyScheduleEditor in price-window mode) and a "Codes and quantity"
 * disclosure (SKU / ISBN / GTIN, quantity + unit). Rows reorder by drag or
 * ArrowUp / ArrowDown on the grip. No availability here — that is
 * AvailabilitySwitch. Pure UI: formats in, onChange out.
 */
export function FormatPriceRows({ formats, onChange, currency, channels, renderLabelInput, formatLabelText, issues = [], newKey = randomKey, disabled }: FormatPriceRowsProps) {
  const t = useTranslations('app.ui.formatPrices')
  const simple = isSimple(formats)
  const keys = formats.map((f) => f.key as string)
  const drag = usePointerDrag((key, over) => {
    const at = dropIndex(keys, key, over)
    if (at !== null) onChange(moveIndex(formats, keys.indexOf(key), at))
  })
  const replace = (key: FormatKey, f: Format) => onChange(formats.map((x) => (x.key === key ? f : x)))
  const add = () => onChange(addFormat(formats, {}, { key: newKey() as FormatKey, label: {} }))

  if (simple) {
    const f = formats[0]
    return (
      <div className="space-y-4">
        <PricesSection format={f} currency={currency} channels={channels} issues={issues} newKey={newKey} onChange={(next) => replace(f.key, next)} disabled={disabled} />
        <Button variant="secondary" onClick={add} disabled={disabled}>
          {t('addFormat')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <ul aria-label={t('formats')} className="flex flex-col gap-3">
        {formats.map((f, n) => {
          const name = formatLabelText(f) || t('formatN', { n: n + 1 })
          const labelMissing = issues.some((i) => i.formatKey === f.key && i.code === 'format.labelRequired')
          const formatIssues = issues.filter((i) => i.formatKey === f.key && !i.priceKeys?.length)
          return (
            <Panel as="li" key={f.key} padding="md" className={`relative space-y-4 ${drag.dragging === f.key ? 'opacity-50' : ''}`} {...drag.rowProps(f.key)}>
              <DropLine edge={drag.edge(f.key)} />
              <div className="flex items-start gap-2">
                <DragGrip
                  label={t('grip', { name, position: n + 1, total: formats.length })}
                  drag={drag.gripProps(f.key)}
                  onMove={(dir) => onChange(moveIndex(formats, n, n + dir))}
                  disabled={disabled}
                />
                <div className="min-w-0 flex-1">
                  <FormatNameField format={f} invalid={labelMissing} renderLabelInput={renderLabelInput} onChange={(label) => replace(f.key, { ...f, label })} />
                </div>
                <Button variant="quiet" className="mt-7" aria-label={t('removeNamed', { name })} onClick={() => onChange(removeFormat(formats, f.key))} disabled={disabled}>
                  {t('remove')}
                </Button>
              </div>
              {formatIssues.map((i, k) => (
                <IssueLine key={`${i.code}-${k}`} level={i.level}>
                  {issueText(t, i.code)}
                </IssueLine>
              ))}
              <PricesSection format={f} formatName={name} currency={currency} channels={channels} issues={issues} newKey={newKey} onChange={(next) => replace(f.key, next)} disabled={disabled} />
              <DetailsSection format={f} formatName={name} onChange={(next) => replace(f.key, next)} />
            </Panel>
          )
        })}
      </ul>
      <Button variant="secondary" onClick={add} disabled={disabled}>
        {t('addFormat')}
      </Button>
    </div>
  )
}

type T = ReturnType<typeof useTranslations<'app.ui.formatPrices'>>

const ISSUE_KEYS = [
  'labelRequired', 'keyDuplicate', 'limitExceeded', 'pricesLimitExceeded', 'skuInvalid', 'skuDuplicateInItem', 'skuDuplicateInProject', 'isbnInvalid', 'isbnConflictsBook', 'gtinInvalid', 'quantityInvalid', 'unitUnknown', 'implicitOverride',
  'amountInvalid', 'tooManyDecimals', 'overlap', 'unknownChannel', 'inactiveChannel', 'windowInvalidTime', 'windowIncomplete', 'windowZeroLength', 'windowUnknownDay', 'ambiguous', 'missing', 'partialCoverage', 'indeterminate',
]
function issueText(t: T, code: string): string {
  const k = code.slice(code.indexOf('.') + 1)
  return ISSUE_KEYS.includes(k) ? t(`issues.${k}` as 'issues.labelRequired') : t('issues.generic')
}

function IssueLine({ level, children }: { level: IssueLevel; children: string }) {
  if (level === 'error') return <FieldError>{children}</FieldError>
  return <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
}

function FormatNameField({ format, invalid, renderLabelInput, onChange }: { format: Format; invalid: boolean; renderLabelInput: FormatPriceRowsProps['renderLabelInput']; onChange: (label: LocalizedString) => void }) {
  const t = useTranslations('app.ui.formatPrices')
  const id = useId()
  return (
    <div>
      <FieldLabel htmlFor={id}>{t('formatName')}</FieldLabel>
      {renderLabelInput({ format, id, invalid, onChange })}
    </div>
  )
}

/** The standard price, then (with channels) one optional price per channel. */
function PricesSection({
  format,
  formatName,
  currency,
  channels,
  issues,
  newKey,
  onChange,
  disabled,
}: {
  format: Format
  formatName?: string
  currency: string
  channels: FormatPriceRowsProps['channels']
  issues: readonly FormatPriceIssue[]
  newKey: () => string
  onChange: (next: Format) => void
  disabled?: boolean
}) {
  const t = useTranslations('app.ui.formatPrices')
  const id = useId()
  const hasChannelPrice = format.prices.some((p) => p.scope !== null)
  const [channelsOpen, setChannelsOpen] = useState(hasChannelPrice)
  const forScope = (scope: ChannelKey | null) => format.prices.filter((p) => p.scope === scope)

  /** Sets (or with null removes) the FIRST price of a scope; later prices of the same scope are kept. */
  function setAmount(scope: ChannelKey | null, existing: Price | undefined, amount: number | null) {
    if (amount === null) return onChange({ ...format, prices: format.prices.filter((p) => p !== existing) })
    if (existing) return onChange({ ...format, prices: format.prices.map((p) => (p === existing ? { ...p, amount } : p)) })
    onChange({ ...format, prices: [...format.prices, { key: newKey(), scope, amount, note: null, windows: [] }] })
  }
  const setWindows = (price: Price, windows: WeeklyWindow[]) => onChange({ ...format, prices: format.prices.map((p) => (p === price ? { ...p, windows } : p)) })
  const priceIssues = (price: Price | undefined) => (price ? issues.filter((i) => i.formatKey === format.key && i.priceKeys?.includes(price.key)) : [])

  const scopeRows = (scope: ChannelKey | null, label: string, placeholder?: string) => {
    const list = forScope(scope)
    const rows = list.length ? list : [undefined]
    return rows.map((price, n) => (
      <PriceField
        // Keyed by place, not price key: the first keystroke creates the price and must not remount (and blur) the field.
        key={`${scope ?? 'standard'}-${n}`}
        label={n === 0 ? label : t('otherTimesPrice', { label })}
        price={price}
        currency={currency}
        placeholder={placeholder}
        issues={priceIssues(price)}
        onAmount={(a) => setAmount(scope, price, a)}
        onWindows={price ? (w) => setWindows(price, w) : undefined}
        disabled={disabled}
      />
    ))
  }

  return (
    <div className="space-y-3">
      {scopeRows(null, formatName ? t('standardPriceNamed', { name: formatName }) : t('price'))}
      {channels.length ? (
        <div className="space-y-3">
          <Button variant="link" className="-ml-1 px-1" aria-expanded={channelsOpen} aria-controls={`${id}-channels`} onClick={() => setChannelsOpen((o) => !o)}>
            {t('channelPrices')}
          </Button>
          <div id={`${id}-channels`} hidden={!channelsOpen} className="space-y-3">
            {channelsOpen ? (
              <>
                <p className="text-sm text-muted-foreground">{t('channelPricesHint')}</p>
                {channels.map((c) => (
                  <div key={c.key}>{scopeRows(c.key, t('channelPrice', { channel: c.label }), t('sameAsStandard'))}</div>
                ))}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PriceField({
  label,
  price,
  currency,
  placeholder,
  issues,
  onAmount,
  onWindows,
  disabled,
}: {
  label: string
  price: Price | undefined
  currency: string
  placeholder?: string
  issues: readonly FormatPriceIssue[]
  onAmount: (amount: number | null) => void
  onWindows?: (windows: WeeklyWindow[]) => void
  disabled?: boolean
}) {
  const t = useTranslations('app.ui.formatPrices')
  const ts = useTranslations('app.ui.schedule') as unknown as ScheduleT
  const locale = useLocale()
  const id = useId()
  const names = useMemo(() => weekdayNames(locale), [locale])
  const amount = price?.amount ?? null
  const [text, setText] = useState(() => amountText(amount, locale))
  const [bad, setBad] = useState(false)
  const [timesOpen, setTimesOpen] = useState(() => (price?.windows.length ?? 0) > 0)
  const affix = currencyAffix(locale, currency)

  // Follow a change made elsewhere (undo, another tab) unless the text already means that amount.
  const [seen, setSeen] = useState(amount)
  if (seen !== amount) {
    setSeen(amount)
    if (parseAmount(text) !== amount) setText(amountText(amount, locale))
  }

  const errorId = `${id}-error`
  const shown = [...(bad ? [t('amountFormat')] : []), ...issues.filter((i) => i.level === 'error').map((i) => issueText(t, i.code))]
  return (
    <div>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="mt-1.5 flex items-start gap-2">
        {affix.before ? <span aria-hidden="true" className="pt-3 text-[0.9375rem] text-muted-foreground">{affix.symbol}</span> : null}
        <TextInput
          id={id}
          flush
          inputMode="decimal"
          autoComplete="off"
          className="max-w-40"
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={shown.length ? true : undefined}
          aria-describedby={[shown.length ? errorId : '', `${id}-currency`].filter(Boolean).join(' ')}
          onChange={(e) => {
            setText(e.target.value)
            const a = parseAmount(e.target.value)
            setBad(a === undefined)
            if (a !== undefined) onAmount(a)
          }}
        />
        {!affix.before ? <span aria-hidden="true" className="pt-3 text-[0.9375rem] text-muted-foreground">{affix.symbol}</span> : null}
        <span id={`${id}-currency`} className="sr-only">
          {t('currency', { currency })}
        </span>
      </div>
      {shown.length ? (
        <div id={errorId}>
          {shown.map((s, k) => (
            <FieldError key={k}>{s}</FieldError>
          ))}
        </div>
      ) : null}
      {issues
        .filter((i) => i.level === 'warning')
        .map((i, k) => (
          <IssueLine key={k} level="warning">
            {issueText(t, i.code)}
          </IssueLine>
        ))}
      {onWindows && price ? (
        <div className="mt-1">
          <Button variant="link" className="-ml-1 px-1" aria-expanded={timesOpen} aria-controls={`${id}-times`} onClick={() => setTimesOpen((o) => !o)}>
            {timesOpen ? t('hideTimes') : price.windows.length ? t('timesSummary', { summary: windowsSummary(price.windows, names, ts) }) : t('times')}
          </Button>
          <div id={`${id}-times`} hidden={!timesOpen} className="mt-2">
            {timesOpen ? <WeeklyScheduleEditor mode="priceWindow" label={t('timesFor', { label })} hint={t('timesHint')} value={price.windows} onChange={onWindows} disabled={disabled} /> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** SKU / ISBN / GTIN and quantity + unit, behind a disclosure. */
function DetailsSection({ format, formatName, onChange }: { format: Format; formatName: string; onChange: (next: Format) => void }) {
  const t = useTranslations('app.ui.formatPrices')
  const id = useId()
  const filled = !!(format.identifiers.sku || format.identifiers.isbn || format.identifiers.gtin || format.quantity)
  const [open, setOpen] = useState(filled)
  const [qty, setQty] = useState(format.quantity ? String(format.quantity.value) : '')
  const setId = (k: 'sku' | 'isbn' | 'gtin', v: string) => {
    const identifiers = { ...format.identifiers }
    if (v.trim()) identifiers[k] = v.trim()
    else delete identifiers[k]
    onChange({ ...format, identifiers })
  }
  const unit: QuantityUnit = format.quantity?.unit ?? 'piece'
  const setQuantity = (text: string, u: QuantityUnit) => {
    setQty(text)
    const n = Number(text.replace(',', '.'))
    if (text.trim() === '') onChange({ ...format, quantity: null })
    else if (Number.isFinite(n) && n > 0) onChange({ ...format, quantity: { value: n, unit: u } })
  }
  return (
    <div>
      <Button variant="link" className="-ml-1 px-1" aria-expanded={open} aria-controls={`${id}-details`} aria-label={t('detailsNamed', { name: formatName })} onClick={() => setOpen((o) => !o)}>
        {t('details')}
      </Button>
      <div id={`${id}-details`} hidden={!open} className="mt-2 grid gap-3 sm:grid-cols-3">
        {open ? (
          <>
            {(['sku', 'isbn', 'gtin'] as const).map((k) => (
              <div key={k}>
                <FieldLabel htmlFor={`${id}-${k}`}>{t(k)}</FieldLabel>
                <TextInput id={`${id}-${k}`} autoComplete="off" defaultValue={format.identifiers[k] ?? ''} onBlur={(e) => setId(k, e.target.value)} />
              </div>
            ))}
            <div>
              <FieldLabel htmlFor={`${id}-qty`}>{t('quantity')}</FieldLabel>
              <TextInput id={`${id}-qty`} inputMode="decimal" autoComplete="off" value={qty} onChange={(e) => setQuantity(e.target.value, unit)} />
            </div>
            <div>
              <FieldLabel htmlFor={`${id}-unit`}>{t('unit')}</FieldLabel>
              <Select id={`${id}-unit`} value={unit} onChange={(e) => setQuantity(qty, e.target.value as QuantityUnit)}>
                {QUANTITY_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {t(`units.${u}`)}
                  </option>
                ))}
              </Select>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
