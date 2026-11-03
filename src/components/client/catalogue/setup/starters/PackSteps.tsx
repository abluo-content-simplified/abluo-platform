'use client'

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { Checkbox } from '@/components/app/ui/Checkbox'
import { CheckboxCard } from '@/components/app/ui/CheckboxCard'
import { Field } from '@/components/app/ui/Field'
import { useImpactSentence } from '@/components/app/ui/ImpactPreview'
import { Notice } from '@/components/app/ui/Notice'
import { Panel } from '@/components/app/ui/Panel'
import { SectionHeading } from '@/components/app/ui/SectionHeading'
import { Select } from '@/components/app/ui/Select'
import { Pill } from '@/components/app/ui/list/cells'
import { ruleSummary, weekdayNames, type ScheduleT } from '@/components/app/ui/schedule-model'
import type { PackPlan, PackSelection, PlanConflict, PlanItem } from '@/lib/modules/catalogue/packs/plan'
import type { PackPreview } from '@/lib/modules/catalogue/packs/service'
import type { PackDeclaration } from '@/lib/modules/catalogue/packs/types'
import type { Localized } from '@/lib/modules/catalogue/taxonomy/types'
import { previewPackAction, type PackActionFail } from '@/app/[locale]/(client)/[tenant]/catalogue/setup/starters/pack-actions'
import { cleanLabels, labelsOf, type Labels } from '../setup-model'
import { LabelFields } from '../setup-ui'
import {
  availabilityRows,
  categoryRows,
  isExtra,
  itemText,
  planCounts,
  rowsOf,
  withChannel,
  withExtraCategory,
  withExtraTag,
  withIncluded,
  withRename,
  withResolution,
  withSchedules,
  withSetting,
  withoutExtra,
  type PlanCounts,
} from './starters-model'

export type StepProps = {
  pack: PackDeclaration
  preview: PackPreview
  selection: PackSelection
  onChange: (next: PackSelection) => void
  defaultLocale: string
  locales: readonly string[]
}

// ── the live preview ──────────────────────────────────────────────────────────

/**
 * The exact server preview for a pack and a selection (C7.4 "exact preview"): re-read whenever the
 * selection changes; the last answer wins. Nothing is written.
 */
export function usePackPreview(projectSlug: string, packId: string | null, selection: PackSelection | null, update = false) {
  const [preview, setPreview] = useState<PackPreview | null>(null)
  const [error, setError] = useState<PackActionFail | null>(null)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const key = packId && selection ? JSON.stringify({ packId, selection, update }) : null
  useEffect(() => {
    if (!key || !packId || !selection) return
    let live = true
    void previewPackAction({ projectSlug, packId, selection, update }).then((r) => {
      if (!live) return
      setLoadedKey(key)
      if (r.ok) {
        setPreview(r.preview)
        setError(null)
      } else setError(r)
    })
    return () => {
      live = false
    }
    // `key` stands for packId + selection + update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug, key])
  const loading = !!key && key !== loadedKey
  /** A fresh plan the server returned with a refusal (pack_plan_changed / pack_conflict) replaces the preview's plan. */
  const replacePlan = useCallback((plan: PackPlan) => setPreview((p) => (p ? { ...p, plan } : p)), [])
  return { preview: packId && key && preview?.plan.pack.id === packId ? preview : null, error, loading, replacePlan }
}

// ── text helpers ──────────────────────────────────────────────────────────────

/** "2 service channels, 14 categories, 1 menu, 7 sections and 3 option groups". */
export function useSummaryText() {
  const t = useTranslations('catalogue.packs.summary')
  const ui = useLocale()
  return useCallback(
    (c: PlanCounts) => {
      const parts = (['channels', 'categories', 'tags', 'menus', 'lists', 'sections', 'optionGroups', 'formats'] as const).filter((k) => c[k] > 0).map((k) => t(k, { count: c[k] }))
      return parts.length ? new Intl.ListFormat(ui, { type: 'conjunction' }).format(parts) : t('nothing')
    },
    [t, ui],
  )
}

function useNames(plan: PackPlan, pack: PackDeclaration, defaultLocale: string) {
  const ui = useLocale()
  return useCallback(
    (area: string, key: string) => {
      const item = [...plan.add, ...plan.equivalent, ...plan.skipped].find((i) => i.area === area && i.key === key)
      if (item) return itemText(item.label, defaultLocale, defaultLocale) || key
      const channel = pack.channels.find((c) => c.key === key)
      return channel ? (channel.label[ui] ?? channel.label.en) : key
    },
    [plan, pack, defaultLocale, ui],
  )
}

/** The plain-language sentence of one conflict (blocking or info). */
export function useConflictText(plan: PackPlan, pack: PackDeclaration, defaultLocale: string) {
  const t = useTranslations('catalogue.packs.conflicts')
  const nameOf = useNames(plan, pack, defaultLocale)
  return useCallback(
    (c: PlanConflict) => {
      const name = c.area === 'setting' ? c.key : nameOf(c.area, c.key)
      if (c.code === 'segment_clash') return t('segment_clash', { value: pack.suggestedSegment ?? '' })
      if (c.code === 'slug_collision') return t('slug_collision', { slug: c.detail?.slug ?? '', name })
      if (c.code === 'limit_exceeded') return t('limit_exceeded', { max: c.detail?.max ?? '' })
      if (c.code === 'rule_skipped_inactive_channel') return t('rule_skipped_inactive_channel', { channel: nameOf('channelSuggestion', c.detail?.channel ?? '') })
      return t(c.code, { name })
    },
    [t, nameOf, pack.suggestedSegment],
  )
}

function useScheduleText() {
  const ts = useTranslations('app.ui.schedule') as unknown as ScheduleT
  const ui = useLocale()
  const names = useMemo(() => weekdayNames(ui), [ui])
  return useCallback((rule: Parameters<typeof ruleSummary>[0]) => ruleSummary(rule, names, ts), [names, ts])
}

function StatusPill({ status, archived, mappedTo, extra }: { status: 'add' | 'equivalent' | 'skipped'; archived?: boolean; mappedTo?: string; extra?: boolean }) {
  const t = useTranslations('catalogue.packs.status')
  if (extra) return <Pill tone="highlight">{t('extra')}</Pill>
  if (mappedTo) return <Pill tone="outline">{t('mapped', { name: mappedTo })}</Pill>
  if (status === 'equivalent') return <Pill>{archived ? t('archived') : t('equivalent')}</Pill>
  return null
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-3">
      <SectionHeading id={id} title={title} />
      {children}
    </section>
  )
}

// ── rename / add sheet ────────────────────────────────────────────────────────

type SheetTarget = { mode: 'rename'; ref: string; name: string; labels: Localized } | { mode: 'addCategory' } | { mode: 'addTag' }

function NameSheet({ target, locales, defaultLocale, parents, onSave, onClose }: { target: SheetTarget | null; locales: readonly string[]; defaultLocale: string; parents: { key: string; name: string }[]; onSave: (labels: Localized, parent: string | null) => void; onClose: () => void }) {
  const t = useTranslations('catalogue.packs')
  const [labels, setLabels] = useState<Labels>({})
  const [parent, setParent] = useState('')
  const [opened, setOpened] = useState<SheetTarget | null>(null)
  if (target !== opened) {
    setOpened(target)
    if (target) {
      setLabels(labelsOf(target.mode === 'rename' ? target.labels : {}, locales))
      setParent('')
    }
  }
  const title = !target ? '' : target.mode === 'rename' ? t('renameTitle', { name: target.name }) : target.mode === 'addCategory' ? t('addCategory') : t('addTag')
  const main = (labels[defaultLocale] ?? '').trim()
  return (
    <BottomSheet open={!!target} title={title} onClose={onClose} size="lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!main) return
          onSave(cleanLabels(labels), parent || null)
        }}
      >
        <LabelFields locales={locales} defaultLocale={defaultLocale} value={labels} onChange={setLabels} label={t('name')} />
        {target?.mode === 'addCategory' ? (
          <Field label={t('place')}>
            {(p) => (
              <Select {...p} value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">{t('topLevel')}</option>
                {parents.map((x) => (
                  <option key={x.key} value={x.key}>
                    {x.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="submit" variant="primary" disabled={!main}>
            {target?.mode === 'rename' ? t('save') : t('add')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
        </div>
        {!main ? <p className="text-sm text-muted-foreground">{t('nameRequired')}</p> : null}
      </form>
    </BottomSheet>
  )
}

// ── step blocks ───────────────────────────────────────────────────────────────

/** Website settings the pack fills only when empty (C7.4): each can be declined. */
export function PackSettingsStep({ pack, preview, selection, onChange, defaultLocale }: StepProps) {
  const t = useTranslations('catalogue.packs')
  const tp = useTranslations('catalogue.dashboard.itemProfiles')
  const plan = preview.plan
  const rows = [...plan.add, ...plan.equivalent, ...plan.skipped].filter((i) => i.area === 'setting')
  const kept = plan.conflicts.filter((c) => c.code === 'setting_differs' && c.area === 'setting').map((c) => c.key)
  if (!rows.length && !kept.length) return null
  const text = (i: PlanItem) => {
    const v = i.value
    if (i.key === 'publicName') return t('settingPublicName', { value: itemText(v as Localized, defaultLocale, defaultLocale) })
    if (i.key === 'defaultItemProfile') return t('settingDefaultItemProfile', { value: tp.has(String(v)) ? tp(String(v)) : String(v) })
    return t('settingPublicSegment', { value: String(v) })
  }
  const keys = [pack.suggestedPublicName && 'publicName', pack.suggestedDefaultProfile && 'defaultItemProfile', pack.suggestedSegment && 'publicSegment'].filter(Boolean) as ('publicName' | 'defaultItemProfile' | 'publicSegment')[]
  return (
    <Block id="pack-settings" title={t('areas.settings')}>
      <div className="space-y-2">
        {keys.map((k) => {
          const item = rows.find((r) => r.key === k)
          if (!item) return kept.includes(k) ? <p key={k} className="text-[0.9375rem] leading-6 text-muted-foreground">{t('settingKept')}</p> : null
          if (item.note === 'already_set') return null
          return <CheckboxCard key={k} label={text(item)} checked={selection.acceptSettings.includes(k)} onChange={(on) => onChange(withSetting(selection, k, on))} />
        })}
      </div>
    </Block>
  )
}

/** Suggested channels: never switched on unless ticked (K-6); the suggested hours can be declined as a whole. */
export function PackChannelsStep({ pack, preview, selection, onChange }: StepProps) {
  const t = useTranslations('catalogue.packs')
  const ui = useLocale()
  const schedule = useScheduleText()
  const plan = preview.plan
  const rows = rowsOf(plan, 'channelSuggestion')
  const hasHours = pack.channels.some((c) => c.defaultSchedule?.length) || pack.categories.some((c) => Object.values(c.channelRules ?? {}).some((r) => r.overrides?.length))
  if (!pack.channels.length) return null
  return (
    <Block id="pack-channels" title={t('areas.channels')}>
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('channelNote')}</p>
      <div className="space-y-2">
        {pack.channels.map((c) => {
          const row = rows.find((r) => r.key === c.key)
          const label = c.label[ui] ?? c.label.en
          if (row?.status === 'equivalent')
            return (
              <Panel key={c.key} padding="md">
                <p className="text-[0.9375rem] leading-6 font-medium">{label}</p>
                <p className="text-sm text-muted-foreground">{t('channelExisting')}</p>
              </Panel>
            )
          const withHours = selection.channelRules === 'apply' && c.defaultSchedule?.length
          const description = withHours
            ? schedule({ state: c.defaultAvailability, overrides: c.defaultSchedule!.map((o) => ({ kind: 'weekly' as const, ...o })) })
            : (c.defaultSchedule?.length ? (c.defaultAvailabilityWithoutSchedule ?? c.defaultAvailability) : c.defaultAvailability) === 'available'
              ? t('channelAllWeek')
              : schedule({ state: 'unavailable', overrides: [] })
          return <CheckboxCard key={c.key} label={label} description={description} checked={selection.acceptChannels.includes(c.key)} onChange={(on) => onChange(withChannel(selection, c.key, on))} />
        })}
      </div>
      {hasHours ? <CheckboxCard label={t('schedules')} description={t('schedulesHelp')} checked={selection.channelRules === 'apply'} onChange={(on) => onChange(withSchedules(selection, on))} /> : null}
    </Block>
  )
}

/** Review (brief §6 step 3): categories, tags, menus and sections, formats and option lists — untick, rename, add your own; label matches are proposals. */
export function PackReviewStep({ pack, preview, selection, onChange, defaultLocale, locales }: StepProps) {
  const t = useTranslations('catalogue.packs')
  const [sheet, setSheet] = useState<SheetTarget | null>(null)
  const plan = preview.plan
  const name = (l: PlanItem['label']) => itemText(l, defaultLocale, defaultLocale)
  const existingName = (area: 'category' | 'tag', key: string) => {
    const list = area === 'category' ? preview.existing.categories : preview.existing.tags
    return itemText(list.find((x) => x.key === key)?.label ?? {}, defaultLocale, defaultLocale) || key
  }
  const cats = categoryRows(plan)
  const excluded = new Set(selection.exclude)
  const parentOf = (k: string) => [...plan.add, ...plan.skipped].find((i) => i.area === 'category' && i.key === k)?.parentKey ?? null
  const ancestorExcluded = (key: string) => {
    for (let k = parentOf(key); k; k = parentOf(k)) if (excluded.has(`category:${k}`)) return true
    return false
  }
  const included = (ref: string, status: string) => status !== 'skipped' || !excluded.has(ref)
  const rename = (ref: string, label: PlanItem['label']) => setSheet({ mode: 'rename', ref, name: name(label), labels: label as Localized })

  const row = (r: { key: string; ref: string; label: PlanItem['label']; status: 'add' | 'equivalent' | 'skipped'; depth?: number; archived?: boolean; mappedTo?: string }, area: 'category' | 'tag' | 'collection' | 'section' | 'formatSuggestion' | 'optionGroup', extra?: ReactNode) => {
    const label = name(r.label)
    const mine = (area === 'category' || area === 'tag') && isExtra(selection, area, r.key)
    const proposal = (area === 'category' || area === 'tag') && r.status === 'add' ? plan.proposals.find((p) => p.area === area && p.packKey === r.key) : undefined
    const blockedByParent = area === 'category' && ancestorExcluded(r.key)
    return (
      <li key={r.ref} className="flex flex-col gap-2 py-2.5" style={r.depth ? { paddingInlineStart: `${r.depth * 1.5}rem` } : undefined}>
        <div className="flex items-start gap-2">
          {r.status === 'equivalent' || mine ? (
            <span className="w-11 shrink-0" aria-hidden="true" />
          ) : (
            <Checkbox aria-label={t('include', { name: label })} checked={included(r.ref, r.status) && !blockedByParent} disabled={blockedByParent} onChange={(on) => onChange(withIncluded(selection, r.ref, on))} />
          )}
          <div className="min-w-0 flex-1 pt-2.5">
            <div className="flex flex-wrap items-start gap-2">
              <span className="text-[0.9375rem] leading-6 [overflow-wrap:anywhere]">{label}</span>
              <StatusPill status={r.status} archived={r.archived} mappedTo={r.mappedTo ? existingName(area as 'category', r.mappedTo) : undefined} extra={mine} />
            </div>
            {extra}
          </div>
          {r.status === 'add' && !mine ? (
            <Button variant="link" onClick={() => rename(r.ref, r.label)} aria-label={t('rename', { name: label })}>
              {t('renameShort')}
            </Button>
          ) : null}
          {mine ? (
            <Button variant="link" onClick={() => onChange(withoutExtra(selection, area as 'category' | 'tag', r.key))} aria-label={t('remove', { name: label })}>
              {t('removeShort')}
            </Button>
          ) : null}
        </div>
        {proposal ? (
          <Notice tone="dashed" layout="row" action={<span className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => onChange(withResolution(selection, proposal.area, proposal.packKey, { use: 'existing', key: proposal.existingKey }))}>{t('useYours')}</Button><Button variant="quiet" onClick={() => onChange(withResolution(selection, proposal.area, proposal.packKey, { use: 'add' }))}>{t('addAnyway')}</Button></span>}>
            {t('proposal', { existing: existingName(proposal.area, proposal.existingKey) })}
          </Notice>
        ) : null}
        {r.mappedTo && selection.resolutions[r.ref]?.use === 'existing' ? (
          <Notice tone="dashed" layout="row" action={<Button variant="quiet" onClick={() => onChange(withResolution(selection, area as 'category', r.key, { use: 'add' }))}>{t('undo')}</Button>}>
            {t('usingYours', { existing: existingName(area as 'category', r.mappedTo) })}
          </Notice>
        ) : null}
      </li>
    )
  }

  const collections = rowsOf(plan, 'collection')
  const sections = rowsOf(plan, 'section')
  const formats = rowsOf(plan, 'formatSuggestion')
  const groups = rowsOf(plan, 'optionGroup')
  const tags = rowsOf(plan, 'tag')
  const parents = cats.filter((c) => c.status !== 'skipped').map((c) => ({ key: c.mappedTo ?? c.key, name: name(c.label) }))

  return (
    <div className="space-y-8">
      {cats.length || pack.categories.length ? (
        <Block id="pack-categories" title={t('areas.categories')}>
          <Panel padding="none">
            <ul className="divide-y divide-border px-3">{cats.map((r) => row(r, 'category'))}</ul>
          </Panel>
          <Button variant="secondary" onClick={() => setSheet({ mode: 'addCategory' })}>
            {t('addCategory')}
          </Button>
        </Block>
      ) : null}
      {tags.length || pack.tags.length ? (
        <Block id="pack-tags" title={t('areas.tags')}>
          <Panel padding="none">
            <ul className="divide-y divide-border px-3">{tags.map((r) => row(r, 'tag'))}</ul>
          </Panel>
          <Button variant="secondary" onClick={() => setSheet({ mode: 'addTag' })}>
            {t('addTag')}
          </Button>
        </Block>
      ) : null}
      {collections.length ? (
        <Block id="pack-collections" title={t('areas.collections')}>
          <Panel padding="none">
            <ul className="divide-y divide-border px-3">
              {collections.map((c) => (
                <Fragment key={c.ref}>
                  {row(c, 'collection')}
                  {sections.filter((s) => s.parentKey === c.key && c.status !== 'skipped').map((s) => row({ ...s, depth: 1 }, 'section'))}
                </Fragment>
              ))}
            </ul>
          </Panel>
        </Block>
      ) : null}
      {formats.length ? (
        <Block id="pack-formats" title={t('areas.formats')}>
          <Panel padding="none">
            <ul className="divide-y divide-border px-3">{formats.map((r) => row(r, 'formatSuggestion'))}</ul>
          </Panel>
        </Block>
      ) : null}
      {groups.length ? (
        <Block id="pack-option-groups" title={t('areas.optionGroups')}>
          <Panel padding="none">
            <ul className="divide-y divide-border px-3">
              {groups.map((r) => {
                const g = pack.optionGroups.find((x) => x.key === r.key)
                return row(r, 'optionGroup', g ? <p className="text-sm text-muted-foreground">{t('choices', { count: g.choices.length })}</p> : null)
              })}
            </ul>
          </Panel>
        </Block>
      ) : null}
      {pack.policySuggestions.length ? <p className="text-sm text-muted-foreground">{t('laterStandards')}</p> : null}
      <NameSheet
        target={sheet}
        locales={locales}
        defaultLocale={defaultLocale}
        parents={parents}
        onClose={() => setSheet(null)}
        onSave={(labels, parent) => {
          if (!sheet) return
          if (sheet.mode === 'rename') onChange(withRename(selection, sheet.ref, labels))
          else if (sheet.mode === 'addCategory') onChange(withExtraCategory(selection, pack, plan, labels, parent, defaultLocale))
          else onChange(withExtraTag(selection, pack, labels, defaultLocale))
          setSheet(null)
        }}
      />
    </div>
  )
}

/** Category tree × active channels (brief §6 step 4): the complete rule each NEW category gets; each suggestion can be unticked. */
export function PackAvailabilityStep({ pack, preview, selection, onChange, defaultLocale }: StepProps) {
  const t = useTranslations('catalogue.packs')
  const ui = useLocale()
  const schedule = useScheduleText()
  const plan = preview.plan
  const channels = [...plan.add, ...plan.equivalent].filter((i) => i.area === 'channelSuggestion').map((i) => i.key)
  const rows = availabilityRows(plan, channels).filter((r) => r.cells.some((c) => c.rule))
  const channelName = (k: string) => {
    const c = pack.channels.find((x) => x.key === k)
    return c ? (c.label[ui] ?? c.label.en) : k
  }
  return (
    <Block id="pack-availability" title={t('areas.availability')}>
      <p className="text-[0.9375rem] leading-6 text-muted-foreground">{channels.length ? t('availabilityIntro') : t('availabilityNoChannels')}</p>
      {channels.length && rows.length === 0 ? <p className="text-[0.9375rem] leading-6">{t('availabilityNone')}</p> : null}
      {rows.length ? (
        <Panel padding="none">
          <ul className="divide-y divide-border px-3">
            {rows.map((r) => {
              const label = itemText(r.label, defaultLocale, defaultLocale)
              return (
                <li key={r.key} className="space-y-2 py-3" style={r.depth ? { paddingInlineStart: `${r.depth * 1.5}rem` } : undefined}>
                  <p className="text-[0.9375rem] leading-6 font-medium">{label}</p>
                  <ul className="space-y-1">
                    {r.cells.map((c) => (
                      <li key={c.channel} className="flex items-start gap-2">
                        {c.rule ? (
                          <Checkbox aria-label={t('applyRule', { name: label, channel: channelName(c.channel) })} checked={c.included} disabled={selection.channelRules !== 'apply'} onChange={(on) => onChange(withIncluded(selection, c.ref, on))} />
                        ) : (
                          <span className="w-11 shrink-0" aria-hidden="true" />
                        )}
                        <p className="min-w-0 pt-2.5 text-[0.9375rem] leading-6">
                          <span className="font-medium">{channelName(c.channel)}</span>
                          {': '}
                          {c.rule && c.included ? schedule(c.rule) : t('inherits')}
                        </p>
                      </li>
                    ))}
                  </ul>
                </li>
              )
            })}
          </ul>
        </Panel>
      ) : null}
    </Block>
  )
}

/** Review & create (brief §6 step 5): the counts, what stays as it is, what blocks, the impact on existing items, the currency read-only. */
export function PackSummaryStep({ pack, preview, defaultLocale }: Pick<StepProps, 'pack' | 'preview' | 'defaultLocale'>) {
  const t = useTranslations('catalogue.packs')
  const summary = useSummaryText()
  const impact = useImpactSentence()
  const conflictText = useConflictText(preview.plan, pack, defaultLocale)
  const plan = preview.plan
  const counts = planCounts(plan, pack)
  const blocking = plan.conflicts.filter((c) => c.blocking)
  const info = plan.conflicts.filter((c) => !c.blocking)
  const removed = (plan as { removedByTenant?: unknown[] }).removedByTenant?.length ?? 0
  const dropped = (plan as { noLongerInPack?: unknown[] }).noLongerInPack?.length ?? 0
  return (
    <div className="space-y-4" data-testid="pack-summary">
      <p className="text-[1.0625rem] leading-7 font-medium">{plan.add.length ? summary(counts) : t('nothingToAdd')}</p>
      {counts.equivalent ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('summary.equivalent', { count: counts.equivalent })}</p> : null}
      {removed ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('removedByTenant', { count: removed })}</p> : null}
      {dropped ? <p className="text-[0.9375rem] leading-6 text-muted-foreground">{t('noLongerInPack', { count: dropped })}</p> : null}
      {blocking.length ? (
        <Notice tone="error" title={t('blockedTitle')}>
          <ul className="list-disc space-y-1 ps-5">
            {blocking.map((c, i) => (
              <li key={i}>{conflictText(c)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {info.length ? (
        <Notice tone="neutral">
          <ul className="list-disc space-y-1 ps-5">
            {info.map((c, i) => (
              <li key={i}>{conflictText(c)}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      {preview.impact.itemsChanged || preview.impact.formatsChanged ? (
        <Notice tone="info" title={t('impactTitle')}>
          {impact(preview.impact)}
        </Notice>
      ) : null}
      <p className="text-sm text-muted-foreground">{preview.currency ? t('currency', { currency: preview.currency }) : t('currencyNone')}</p>
    </div>
  )
}
