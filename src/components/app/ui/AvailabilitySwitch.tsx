'use client'

import { useId, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import type { AvailabilitySource } from '@/lib/modules/catalogue/commerce/channel-availability'
import type { AvailabilityRuleValue, ChannelAvailabilityRule } from '@/lib/modules/catalogue/commerce/commerce-types'
import { Button } from './Button'
import { Panel } from './Panel'
import { SegmentedControl } from './SegmentedControl'
import { WeeklyScheduleEditor, type ScheduleEditorIssue } from './WeeklyScheduleEditor'
import { ruleSummary, weekdayNames, type ScheduleT } from './schedule-model'

export type AvailabilityLevel = 'category' | 'item' | 'format'

export type AvailabilitySwitchProps = {
  /** The channel's name in the viewer's language ("Delivery"). */
  channelLabel: string
  /** Where this control writes: the rule of a category, an item or a format. */
  level: AvailabilityLevel
  /** This level's explicit rule for the channel; null = Inherit (no row stored, C5-7). */
  rule: ChannelAvailabilityRule | null
  /**
   * What Inherit gives and where it comes from — C5 `EffectiveRule.inherited`
   * when this level is explicit, or `{ rule, source }` of the EffectiveRule
   * when it already inherits. null = nothing upstream (shown as unavailable).
   */
  inherited: { rule: ChannelAvailabilityRule; source: AvailabilitySource } | null
  /** Full path of the category the inherited rule comes from ("Food › Pizza"), for source level 'category'. */
  inheritedPath?: string
  /** null = Inherit ("Use category default": the row is removed); a rule = the complete explicit rule (D-6.1). */
  onChange: (next: ChannelAvailabilityRule | null) => void
  /** card (default): source lines, "Use category default" and the hours editor. row: one compact line for a list of channels. */
  variant?: 'card' | 'row'
  /** Offer the hours editor (card only). Default true. */
  schedule?: boolean
  /** Schedule issues for the explicit rule (C5a); omitted = computed by WeeklyScheduleEditor. */
  issues?: readonly ScheduleEditorIssue[]
  /** Disabled with the reason shown (e.g. missing permission). */
  disabledReason?: string
  /** Key for a new schedule override. */
  newKey?: () => string
}

const FALLBACK: ChannelAvailabilityRule = { state: 'unavailable', overrides: [] }

/**
 * One channel's availability at one level: Inherit / Available / Unavailable,
 * the effective result in words and where it comes from ("Category default:
 * Available all week, from Food › Pizza"), a "Use category default" action
 * when this level overrides, and optionally the weekly hours
 * (WeeklyScheduleEditor). Explicit rules are complete (D-6.1): choosing
 * Available from Inherit means all week; "Change hours here" copies the
 * inherited hours as a starting point. variant="row" is the compact line for
 * a list of channels. Pure UI: rule in, onChange out.
 */
export function AvailabilitySwitch({
  channelLabel,
  level,
  rule,
  inherited,
  inheritedPath,
  onChange,
  variant = 'card',
  schedule = true,
  issues,
  disabledReason,
  newKey,
}: AvailabilitySwitchProps) {
  const t = useTranslations('app.ui.availability')
  const ts = useTranslations('app.ui.schedule') as unknown as ScheduleT
  const locale = useLocale()
  const names = useMemo(() => weekdayNames(locale), [locale])
  const id = useId()
  const [hoursOpen, setHoursOpen] = useState(() => (rule?.overrides.length ?? 0) > 0)
  const disabled = disabledReason !== undefined

  const upstream = inherited?.rule ?? FALLBACK
  const effective = rule ?? upstream
  const value: AvailabilityRuleValue = rule === null ? 'inherit' : rule.state
  const summary = (r: ChannelAvailabilityRule) => ruleSummary(r, names, ts)

  const inheritedLine = (() => {
    const s = summary(upstream)
    const src = inherited?.source
    if (!src) return t('sourceNone', { summary: s })
    if (src.level === 'category') return inheritedPath ? t('sourceCategoryFrom', { summary: s, path: inheritedPath }) : t('sourceCategory', { summary: s })
    if (src.level === 'projectDefault') return t('sourceChannel', { summary: s })
    if (src.level === 'item') return t('sourceItemSetting', { summary: s })
    if (src.level === 'format') return t('sourceFormatSetting', { summary: s })
    return t('sourceNone', { summary: s })
  })()
  const useDefaultLabel = (() => {
    const lvl = inherited?.source.level
    if (lvl === 'category') return t('useCategoryDefault')
    if (lvl === 'projectDefault') return t('useChannelDefault')
    if (lvl === 'item') return t('useItemSetting')
    return t('useDefault')
  })()
  const explicitLine = rule ? t(level === 'format' ? 'explicitFormat' : level === 'category' ? 'explicitCategory' : 'explicitItem', { summary: summary(rule) }) : null

  const options = [
    { value: 'inherit' as const, label: t('inherit') },
    { value: 'available' as const, label: t('available') },
    { value: 'unavailable' as const, label: t('unavailable') },
  ].map((o) => ({ ...o, disabled }))
  const choose = (v: AvailabilityRuleValue) => {
    if (v === 'inherit') onChange(null)
    else onChange({ state: v, overrides: rule?.overrides ?? [] })
  }
  const control = (
    <SegmentedControl label={t('stateFor', { channel: channelLabel })} appearance="soft" value={value} onChange={choose} options={options} />
  )
  const reason = disabledReason ? (
    <p id={`${id}-reason`} className="text-sm text-muted-foreground">
      {disabledReason}
    </p>
  ) : null

  if (variant === 'row') {
    return (
      <div role="group" aria-labelledby={`${id}-name`} aria-describedby={`${id}-effective`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-2">
        <div className="min-w-0 flex-1">
          <p id={`${id}-name`} className="text-[0.9375rem] font-medium text-foreground">
            {channelLabel}
          </p>
          <p id={`${id}-effective`} className="text-sm text-muted-foreground">
            {rule ? explicitLine : inheritedLine}
          </p>
          {reason}
        </div>
        {control}
      </div>
    )
  }

  return (
    <Panel as="section" padding="md" aria-labelledby={`${id}-name`} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 id={`${id}-name`} className="pt-2 text-[0.9375rem] font-semibold text-foreground">
          {channelLabel}
        </h3>
        {control}
      </div>
      {reason}
      <div aria-live="polite" className="space-y-1">
        {explicitLine ? <p className="text-[0.9375rem] leading-6 text-foreground">{explicitLine}</p> : null}
        <p className={rule ? 'text-sm text-muted-foreground' : 'text-[0.9375rem] leading-6 text-foreground'}>{inheritedLine}</p>
      </div>
      {rule && !disabled ? (
        <Button variant="link" className="-ml-1 px-1" onClick={() => onChange(null)}>
          {useDefaultLabel}
        </Button>
      ) : null}
      {schedule && !disabled ? (
        <div className="space-y-3">
          <Button variant="link" className="-ml-1 px-1" aria-expanded={hoursOpen} aria-controls={`${id}-hours`} onClick={() => setHoursOpen((o) => !o)}>
            {hoursOpen ? t('hideHours') : t('showHours')}
          </Button>
          <div id={`${id}-hours`} hidden={!hoursOpen}>
            {hoursOpen ? (
              rule ? (
                <WeeklyScheduleEditor
                  label={t('hoursFor', { channel: channelLabel })}
                  value={rule}
                  onChange={onChange}
                  showBaseline={false}
                  issues={issues}
                  newKey={newKey}
                />
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">{t('hoursInherited', { summary: summary(effective) })}</p>
                  <Button variant="secondary" onClick={() => onChange({ state: upstream.state, overrides: upstream.overrides })}>
                    {t(level === 'format' ? 'changeHoursFormat' : level === 'category' ? 'changeHoursCategory' : 'changeHoursItem')}
                  </Button>
                </div>
              )
            ) : null}
          </div>
        </div>
      ) : null}
    </Panel>
  )
}
