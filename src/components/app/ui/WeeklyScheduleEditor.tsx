'use client'

import { useId, useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { timeSteps } from '@/lib/client/date-range'
import { scheduleIssues, type ScheduleIssue } from '@/lib/modules/catalogue/commerce/availability-schedule'
import { OVERRIDES_PER_RULE_LIMIT, type ChannelAvailabilityRule, type ChannelAvailabilityState, type IssueLevel, type WeeklyOverride } from '@/lib/modules/catalogue/commerce/commerce-types'
import { hhmmOf, minutesOf, windowIssues, type WeeklyWindow } from '@/lib/modules/catalogue/commerce/windows'
import { Button } from './Button'
import { FieldError, FieldLabel } from './FieldLabel'
import { Panel } from './Panel'
import { SegmentedControl } from './SegmentedControl'
import { Select } from './Select'
import { ToggleChips } from './ToggleChips'
import { SCHEDULE_ISSUE_KEYS, WEEKDAYS, isOvernight, issueMessageKey, ruleSummary, weekdayNames, windowsSummary, type ScheduleT } from './schedule-model'

/** An issue to show: C5a `ScheduleIssue` (availability) or C4 `PriceIssue` (price windows) — only `code`, `level` and the override `keys` are read. */
export type ScheduleEditorIssue = { code: string; level: IssueLevel; keys?: readonly string[] }

type Common = {
  /** The group's name (legend), e.g. "Delivery hours" or "When this price applies". */
  label: string
  /** Quiet text under the legend. */
  hint?: string
  disabled?: boolean
  className?: string
}

export type WeeklyScheduleEditorProps = Common &
  (
    | {
        /** Availability (C5a): a baseline state plus weekly overrides. */
        mode?: 'availability'
        value: ChannelAvailabilityRule
        onChange: (next: ChannelAvailabilityRule) => void
        /** Validation to show. Omitted = computed with C5a `scheduleIssues(value)`. */
        issues?: readonly ScheduleEditorIssue[]
        /** Hide the baseline control when the caller shows it (AvailabilitySwitch does). */
        showBaseline?: boolean
        /** Key for a new override. Default: a random 12-character key. */
        newKey?: () => string
      }
    | {
        /** Price windows (C4): when ONE price applies; [] = always. No baseline, no state. */
        mode: 'priceWindow'
        value: readonly WeeklyWindow[]
        onChange: (next: WeeklyWindow[]) => void
        /** Validation to show. Omitted = computed with C4 `windowIssues` per window. Price issues are per price, so they show under the whole list. */
        issues?: readonly ScheduleEditorIssue[]
      }
  )

type Row = { key: string; days: readonly string[]; from: string | null; to: string | null; state?: ChannelAvailabilityState }

/** An error is announced in the error style; a warning (e.g. hours that change nothing) is quiet. */
function IssueLine({ level, children }: { level: IssueLevel; children: string }) {
  if (level === 'error') return <FieldError>{children}</FieldError>
  return <p className="mt-1.5 text-sm text-muted-foreground">{children}</p>
}

const randomKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14))

/** Seven chosen days are stored as [] ("every day", A1); otherwise Monday-first order. */
const normaliseDays = (days: readonly string[]) => (days.length === 7 ? [] : WEEKDAYS.filter((d) => days.includes(d)))

/** C4 window issue kinds → the PriceIssueCode words (same table as priceIssues). */
const PRICE_WINDOW_CODE = { invalidTime: 'price.windowInvalidTime', incompleteWindow: 'price.windowIncomplete', zeroLengthWindow: 'price.windowZeroLength', unknownDay: 'price.windowUnknownDay' } as const

/**
 * Weekly hours: availability schedules (baseline + overrides, C5a) or, with
 * mode="priceWindow", the windows of one price (C4). Days are chips Monday to
 * Sunday in the viewer's language (none chosen = every day); from / until are
 * 24-hour times in 15-minute steps (a stored off-grid time stays selectable);
 * an until at or before from is overnight and says so. A human summary sits
 * at the top ("Available 18:00–23:00 every day"). Validation comes from the
 * C5a / C4 issue codes — passed in, or computed with the existing validators.
 * Pure UI: value in, onChange out.
 */
export function WeeklyScheduleEditor(props: WeeklyScheduleEditorProps) {
  const { label, hint, disabled, className = '' } = props
  const t = useTranslations('app.ui.schedule')
  const tt = t as unknown as ScheduleT
  const locale = useLocale()
  const names = useMemo(() => weekdayNames(locale), [locale])
  const baseId = useId()
  const isPrice = props.mode === 'priceWindow'

  const rows: Row[] = isPrice
    ? props.value.map((w, i) => ({ key: `w${i}`, days: w.days ?? [], from: w.from ?? null, to: w.to ?? null }))
    : props.value.overrides.map((o) => ({ key: o.key, days: o.days, from: o.from, to: o.to, state: o.state }))

  const issues: readonly ScheduleEditorIssue[] = isPrice
    ? (props.issues ?? props.value.flatMap((w) => windowIssues(w).map((i) => ({ code: PRICE_WINDOW_CODE[i.kind], level: 'error' as const }))))
    : (props.issues ?? (scheduleIssues(props.value) as readonly ScheduleIssue[]))

  const summary = isPrice ? windowsSummary(props.value, names, tt) : ruleSummary(props.value, names, tt)
  const issueText = (code: string) => {
    const k = issueMessageKey(code)
    return (SCHEDULE_ISSUE_KEYS as readonly string[]).includes(k) ? t(`issues.${k}` as 'issues.scheduleOverlap') : t('issues.generic')
  }

  function commit(next: Row[]) {
    if (props.mode === 'priceWindow') {
      props.onChange(next.map((r) => ({ days: normaliseDays(r.days), from: r.from, to: r.to })))
    } else {
      const overrides: WeeklyOverride[] = next.map((r) => ({ kind: 'weekly', key: r.key, days: normaliseDays(r.days) as WeeklyOverride['days'], from: r.from, to: r.to, state: r.state ?? 'available' }))
      props.onChange({ state: props.value.state, overrides })
    }
  }
  const update = (key: string, patch: Partial<Row>) => commit(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const remove = (key: string) => commit(rows.filter((r) => r.key !== key))
  function add() {
    if (props.mode === 'priceWindow') {
      commit([...rows, { key: `w${rows.length}`, days: [], from: '18:00', to: '23:00' }])
    } else {
      const opposite: ChannelAvailabilityState = props.value.state === 'available' ? 'unavailable' : 'available'
      commit([...rows, { key: (props.newKey ?? randomKey)(), days: [], from: '18:00', to: '23:00', state: opposite }])
    }
  }
  const atLimit = !isPrice && rows.length >= OVERRIDES_PER_RULE_LIMIT
  const stateOptions = [
    { value: 'available' as const, label: t('stateAvailableTitle') },
    { value: 'unavailable' as const, label: t('stateUnavailableTitle') },
  ]
  const general = issues.filter((i) => !i.keys?.length || isPrice)
  const showBaseline = props.mode === 'priceWindow' ? false : props.showBaseline !== false
  const rule = props.mode === 'priceWindow' ? null : props.value
  const onRule = props.mode === 'priceWindow' ? null : props.onChange

  return (
    <fieldset className={`min-w-0 space-y-3 ${className}`} disabled={disabled} aria-describedby={`${baseId}-summary`}>
      <legend className="text-[0.9375rem] font-medium text-foreground">{label}</legend>
      {hint ? <p className="-mt-2 text-sm text-muted-foreground">{hint}</p> : null}
      <p id={`${baseId}-summary`} aria-live="polite" className="text-[0.9375rem] leading-6 text-foreground">
        {summary}
      </p>

      {showBaseline && rule && onRule ? (
        <div>
          <FieldLabel as="p" id={`${baseId}-baseline`}>
            {t('baseline')}
          </FieldLabel>
          <SegmentedControl
            label={t('baseline')}
            appearance="soft"
            className="mt-1.5"
            value={rule.state}
            onChange={(state) => onRule({ state, overrides: rule.overrides })}
            options={stateOptions}
          />
        </div>
      ) : null}

      {rows.length ? (
        <ul className="space-y-3">
          {rows.map((r, n) => {
            const rowId = `${baseId}-${n}`
            const rowIssues = isPrice ? [] : issues.filter((i) => i.keys?.includes(r.key))
            const overnight = isOvernight(r.from, r.to)
            const allDay = r.from === null && r.to === null
            const name = t(isPrice ? 'windowName' : 'hoursName', { n: n + 1 })
            return (
              <Panel as="li" key={r.key} padding="md" tone="muted" aria-label={name} className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="pt-2.5 text-sm font-medium text-foreground">{name}</p>
                  <Button variant="quiet" aria-label={t('removeNamed', { name })} onClick={() => remove(r.key)}>
                    {t('remove')}
                  </Button>
                </div>
                <div>
                  <ToggleChips
                    label={t('daysNamed', { name })}
                    size="compact"
                    value={r.days}
                    onChange={(days) => update(r.key, { days })}
                    options={WEEKDAYS.map((d) => ({ value: d, label: names[d] }))}
                  />
                  {r.days.length === 0 ? <p className="mt-1.5 text-sm text-muted-foreground">{t('daysEveryDay')}</p> : null}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel htmlFor={`${rowId}-from`}>{t('from')}</FieldLabel>
                    <Select
                      id={`${rowId}-from`}
                      value={r.from ?? ''}
                      aria-invalid={rowIssues.some((i) => i.level === 'error') || undefined}
                      onChange={(e) => {
                        const from = e.target.value || null
                        if (!from) return update(r.key, { from: null, to: null })
                        const to = r.to ?? hhmmOf((minutesOf(from) ?? 0) + 60)
                        update(r.key, { from, to })
                      }}
                    >
                      <option value="">{t('allDay')}</option>
                      {timeSteps(r.from ?? undefined).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <FieldLabel htmlFor={`${rowId}-to`}>{t('to')}</FieldLabel>
                    <Select
                      id={`${rowId}-to`}
                      value={r.to ?? ''}
                      disabled={allDay}
                      aria-describedby={overnight ? `${rowId}-overnight` : undefined}
                      onChange={(e) => update(r.key, { to: e.target.value || null })}
                    >
                      {allDay ? <option value="">{t('allDay')}</option> : null}
                      {timeSteps(r.to ?? undefined).map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>
                {overnight ? (
                  <p id={`${rowId}-overnight`} className="text-sm text-muted-foreground">
                    {t('overnight', { to: r.to ?? '' })}
                  </p>
                ) : null}
                {!isPrice ? (
                  <div>
                    <FieldLabel as="p">{t('duringHours')}</FieldLabel>
                    <SegmentedControl
                      label={t('duringHoursNamed', { name })}
                      appearance="soft"
                      className="mt-1.5"
                      value={r.state ?? 'available'}
                      onChange={(state) => update(r.key, { state })}
                      options={stateOptions}
                    />
                  </div>
                ) : null}
                {rowIssues.map((i, k) => (
                  <IssueLine key={`${i.code}-${k}`} level={i.level}>
                    {issueText(i.code)}
                  </IssueLine>
                ))}
              </Panel>
            )
          })}
        </ul>
      ) : null}

      {general.map((i, k) => (
        <IssueLine key={`${i.code}-${k}`} level={i.level}>
          {issueText(i.code)}
        </IssueLine>
      ))}

      <div>
        <Button variant="secondary" onClick={add} disabled={atLimit} aria-describedby={atLimit ? `${baseId}-limit` : undefined}>
          {t(isPrice ? 'addWindow' : 'addHours')}
        </Button>
        {atLimit ? (
          <p id={`${baseId}-limit`} className="mt-1.5 text-sm text-muted-foreground">
            {t('limitReached', { limit: OVERRIDES_PER_RULE_LIMIT })}
          </p>
        ) : null}
      </div>
    </fieldset>
  )
}
