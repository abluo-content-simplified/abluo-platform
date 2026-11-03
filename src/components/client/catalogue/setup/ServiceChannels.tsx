'use client'

import { useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { BottomSheet } from '@/components/app/ui/BottomSheet'
import { Button } from '@/components/app/ui/Button'
import { CheckboxCard } from '@/components/app/ui/CheckboxCard'
import { ConfirmDialog } from '@/components/app/ui/ConfirmDialog'
import { EmptyState } from '@/components/app/ui/EmptyState'
import { ImpactPreview } from '@/components/app/ui/ImpactPreview'
import { Notice } from '@/components/app/ui/Notice'
import { TreeEditor } from '@/components/app/ui/TreeEditor'
import { WeeklyScheduleEditor } from '@/components/app/ui/WeeklyScheduleEditor'
import { Pill } from '@/components/app/ui/list/cells'
import type { CardMenuItem } from '@/components/app/ui/CardMenu'
import { ruleSummary, weekdayNames, type ScheduleT } from '@/components/app/ui/schedule-model'
import { scheduleIssues } from '@/lib/modules/catalogue/commerce/availability-schedule'
import type { ChannelUsage } from '@/lib/modules/catalogue/commerce/channels'
import { CHANNEL_LIMIT, type ChannelAvailabilityRule } from '@/lib/modules/catalogue/commerce/commerce-types'
import type { CatalogueSettingsView, ChannelChange } from '@/lib/modules/catalogue/settings/service'
import {
  loadCatalogueSettingsAction,
  previewCatalogueChannelRemovalAction,
  removeCatalogueChannelAction,
  saveCatalogueChannelsAction,
} from '@/app/[locale]/(client)/[tenant]/catalogue/setup/settings-actions'
import { channelDefaultRuleOf, channelDraftsOf, channelInputs, channelsNeedMigration, flatTree, keyFromLabel, labelText, previewImpact, reorderedList, sumImpact, withChannel, type ChannelDraft, type Labels } from './setup-model'
import { LabelFields, SetupHeader, useFailText, useSetupToast, type SetupFail } from './setup-ui'

type Pending = { next: ChannelDraft[]; changes: ChannelChange[]; ok: string }
type Removal = { key: string; usage: ChannelUsage; changed: boolean }
type Editing = { mode: 'add' } | { mode: 'edit'; key: string }

/**
 * Catalogue → Setup → Service Channels (spec §10.4, C2): the ordered list of ways an item is
 * offered (dine-in, takeaway, delivery …), each with a name per language, on/off, and a default
 * availability with optional weekly hours. Switching a channel on or off and changing its default
 * are rule changes: when they change any item, the impact is shown first and the save needs a
 * confirmation. Removing a channel shows the counted cleanup (prices and rules removed with it).
 * Keys are made from the first name and never shown or renamed.
 */
export function ServiceChannels({ projectSlug, initial, backHref }: { projectSlug: string; initial: CatalogueSettingsView; backHref: string }) {
  const t = useTranslations('catalogue.setup.channels')
  const ts = useTranslations('app.ui.schedule') as unknown as ScheduleT
  const ui = useLocale()
  const names = useMemo(() => weekdayNames(ui), [ui])
  const [view, setView] = useState(initial)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [removal, setRemoval] = useState<Removal | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useSetupToast()
  const list = useMemo(() => channelDraftsOf(view.channels, view.locales), [view.channels, view.locales])
  const nameOf = (key: string) => labelText(list.find((c) => c.key === key)?.label, view.defaultLocale, view.defaultLocale) || t('unnamed')
  const failText = useFailText()
  const migrationPending = channelsNeedMigration(list)
  const manage = view.can.manage && !migrationPending

  const reload = async () => {
    const r = await loadCatalogueSettingsAction({ projectSlug })
    if (r.ok) setView(r.settings)
  }
  const fail = async (r: SetupFail) => {
    if (r.error === 'conflict') await reload()
    toast.show(failText(r), 'error')
  }

  /** Saves the whole list; a change with impact comes back unsaved with its counts, to confirm. */
  async function save(next: ChannelDraft[], ok: string, confirmImpact = false): Promise<boolean> {
    setBusy(true)
    const r = await saveCatalogueChannelsAction({ projectSlug, rev: view.rev, channels: channelInputs(next), confirmImpact })
    setBusy(false)
    if (!r.ok) {
      setPending(null)
      await fail(r)
      return false
    }
    if (!r.saved) {
      setPending({ next, changes: r.changes, ok })
      return false
    }
    setPending(null)
    await reload()
    toast.show(ok)
    return true
  }

  async function askRemove(key: string) {
    const r = await previewCatalogueChannelRemovalAction({ projectSlug, key })
    if (!r.ok) return void (await fail(r))
    setError(null)
    setRemoval({ key, usage: r.usage, changed: false })
  }

  async function remove() {
    if (!removal) return
    setBusy(true)
    const r = await removeCatalogueChannelAction({ projectSlug, rev: view.rev, key: removal.key, expected: removal.usage })
    setBusy(false)
    if (!r.ok) {
      // The counts changed meanwhile: show the new ones and ask again.
      if (r.error === 'channel_usage_changed' && r.detail?.usage) return setRemoval({ ...removal, usage: r.detail.usage, changed: true })
      setError(failText(r))
      if (r.error === 'conflict') await reload()
      return
    }
    const name = nameOf(removal.key)
    setRemoval(null)
    await reload()
    toast.show(t('removed', { name }))
  }

  const menuItems = (key: string): CardMenuItem[] => {
    if (!manage) return []
    const c = list.find((x) => x.key === key)!
    return [
      { key: 'edit', label: t('edit'), onSelect: () => setEditing({ mode: 'edit', key }) },
      c.active
        ? { key: 'off', label: t('switchOff'), onSelect: () => void save(withChannel(list, { ...c, active: false }), t('switchedOff', { name: nameOf(key) })) }
        : { key: 'on', label: t('switchOn'), onSelect: () => void save(withChannel(list, { ...c, active: true }), t('switchedOn', { name: nameOf(key) })) },
      { key: 'remove', label: t('remove'), destructive: true, separated: true, onSelect: () => void askRemove(key) },
    ]
  }

  const full = list.length >= CHANNEL_LIMIT
  const addReason = !view.can.manage ? t('needsSetup') : migrationPending ? t('migrationPending') : full ? t('limitReached', { max: CHANNEL_LIMIT }) : null
  const total = pending ? sumImpact(pending.changes.map((c) => c.impact)) : null
  const single = pending && pending.changes.length === 1 ? pending.changes[0] : null
  const usage = removal?.usage
  const usageTotal = usage ? usage.prices + usage.itemRules + usage.formatRules + usage.categoryRules : 0

  return (
    <div className="space-y-5">
      <SetupHeader
        title={t('title')}
        backHref={backHref}
        intro={t('intro')}
        actions={
          <Button variant="primary" disabled={!!addReason} onClick={() => setEditing({ mode: 'add' })}>
            {t('add')}
          </Button>
        }
      />
      {addReason ? <p className="-mt-3 text-sm text-muted-foreground">{addReason}</p> : null}
      {migrationPending ? <Notice tone="info">{t('migrationNotice')}</Notice> : null}
      {list.length === 0 ? (
        <EmptyState title={t('emptyTitle')} body={t('emptyBody')} />
      ) : (
        <TreeEditor
          label={t('title')}
          tree={flatTree(list.map((c) => c.key))}
          labelOf={nameOf}
          onMove={(req) => void save(list.length ? reorderedList(list.map((c) => c.key), req).map((k) => list.find((c) => c.key === k)!) : list, t('reordered'))}
          reorderable={manage}
          reorderDisabledReason={manage ? undefined : migrationPending ? t('migrationPending') : t('needsSetup')}
          parentChangeDisabledReason={t('flat')}
          renderMeta={(key) => {
            const c = list.find((x) => x.key === key)
            if (!c) return null
            return (
              <div className="mt-1 flex flex-wrap items-start gap-1.5 text-sm text-muted-foreground">
                <Pill tone={c.active ? 'success' : 'outline'}>{c.active ? t('on') : t('off')}</Pill>
                <span className="py-0.5">{t('defaultIs', { summary: ruleSummary(channelDefaultRuleOf(c), names, ts) })}</span>
              </div>
            )
          }}
          menuItems={menuItems}
        />
      )}

      <ChannelSheet
        editing={editing}
        list={list}
        locales={view.locales}
        defaultLocale={view.defaultLocale}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={async (next, ok) => {
          if (await save(next, ok)) setEditing(null)
        }}
      />

      {pending && total ? (
        <ImpactPreview
          open
          title={single ? t(`confirm.${single.kind.replace('channel.', '')}`, { name: nameOf(single.channelKey) }) : t('confirm.several')}
          impact={previewImpact(total)}
          channelLabel={single ? nameOf(single.channelKey) : undefined}
          confirmLabel={t('confirm.apply')}
          busy={busy}
          onConfirm={() => void save(pending.next, pending.ok, true).then((saved) => saved && setEditing(null))}
          onCancel={() => setPending(null)}
        >
          <ul className="list-disc space-y-1 pl-5 text-[0.9375rem] leading-6 text-muted-foreground">
            {pending.changes.map((c) => (
              <li key={`${c.kind}-${c.channelKey}`}>{t(`change.${c.kind.replace('channel.', '')}`, { name: nameOf(c.channelKey) })}</li>
            ))}
          </ul>
        </ImpactPreview>
      ) : null}

      <ConfirmDialog
        open={!!removal}
        title={removal ? t('removeTitle', { name: nameOf(removal.key) }) : ''}
        body={
          !usage
            ? ''
            : usageTotal === 0
              ? t('removeUnused')
              : t('removeCounts', { prices: usage.prices, itemRules: usage.itemRules + usage.formatRules, categoryRules: usage.categoryRules })
        }
        confirmLabel={usageTotal === 0 ? t('removeConfirm') : t('removeWithCleanup')}
        busy={busy}
        error={removal?.changed ? t('removeCountsChanged') : error}
        onConfirm={() => void remove()}
        onCancel={() => setRemoval(null)}
      />
      {toast.node}
    </div>
  )
}

/** Add or edit one channel: names per language, default availability with optional weekly hours, and (new channel) whether it is on now. */
function ChannelSheet({
  editing,
  list,
  locales,
  defaultLocale,
  busy,
  onClose,
  onSave,
}: {
  editing: Editing | null
  list: ChannelDraft[]
  locales: string[]
  defaultLocale: string
  busy: boolean
  onClose: () => void
  onSave: (next: ChannelDraft[], ok: string) => Promise<void>
}) {
  const t = useTranslations('catalogue.setup.channels')
  const current = editing?.mode === 'edit' ? list.find((c) => c.key === editing.key) : undefined
  const [labels, setLabels] = useState<Labels>({})
  const [rule, setRule] = useState<ChannelAvailabilityRule>({ state: 'available', overrides: [] })
  const [active, setActive] = useState(false)
  const [opened, setOpened] = useState<Editing | null>(null)
  if (editing !== opened) {
    setOpened(editing)
    setLabels(Object.fromEntries(locales.map((l) => [l, current?.label[l] ?? ''])))
    setRule(current ? channelDefaultRuleOf(current) : { state: 'available', overrides: [] })
    setActive(current?.active ?? false)
  }
  if (!editing) return <BottomSheet open={false} title="" onClose={onClose}>{null}</BottomSheet>

  const main = (labels[defaultLocale] ?? '').trim()
  const errors = scheduleIssues(rule).filter((i) => i.level === 'error')
  const reason = !main ? t('nameRequired') : errors.length ? t('fixHours') : null

  function submit() {
    if (reason) return
    const draft: ChannelDraft = {
      key: current?.key ?? keyFromLabel(main, list.map((c) => c.key), 'channel'),
      label: labels,
      active,
      defaultAvailability: rule.state,
      defaultSchedule: rule.overrides,
      explicitDefault: true,
    }
    const next = current ? withChannel(list, draft) : [...list, draft]
    void onSave(next, current ? t('saved', { name: main }) : t('added', { name: main }))
  }

  return (
    <BottomSheet open title={current ? t('editTitle', { name: labelText(current.label, defaultLocale, defaultLocale) }) : t('addTitle')} onClose={onClose} size="lg">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <LabelFields locales={locales} defaultLocale={defaultLocale} value={labels} onChange={setLabels} label={t('name')} />
        <WeeklyScheduleEditor label={t('defaultHours')} hint={t('defaultHoursHint')} value={rule} onChange={setRule} />
        {current ? null : <CheckboxCard label={t('activeNow')} description={t('activeNowHint')} checked={active} onChange={setActive} />}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="submit" variant="primary" disabled={busy || !!reason}>
            {current ? t('save') : t('add')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
        </div>
        {reason ? <p className="text-sm text-muted-foreground">{reason}</p> : null}
      </form>
    </BottomSheet>
  )
}
